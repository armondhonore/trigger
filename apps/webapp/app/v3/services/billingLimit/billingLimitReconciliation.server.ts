import { EnvironmentPauseSource } from "@trigger.dev/database";
import { prisma } from "~/db.server";
import type { BillingLimitResult } from "~/services/billingLimit.schemas";
import { getActiveBillingLimits, getBillingLimit } from "~/services/platform.v3.server";
import type { BillingLimitConvergeTargetState } from "./billingLimitConstants";
import {
  readBillingLimitReconcileQueue,
  removeFromBillingLimitReconcileQueue,
} from "./billingLimitReconcileQueue.server";

export type OrgReconcileTarget = {
  organizationId: string;
  targetState: BillingLimitConvergeTargetState;
};

export function resolveConvergeTargetFromBillingLimit(
  billingLimit: BillingLimitResult | undefined
): BillingLimitConvergeTargetState {
  if (!billingLimit?.isConfigured) {
    return "ok";
  }

  if (billingLimit.limitState.status === "grace") {
    return "grace";
  }

  if (billingLimit.limitState.status === "rejected") {
    return "rejected";
  }

  return "ok";
}

export async function getOrgIdsWithBillingPauseSource(): Promise<string[]> {
  const rows = await prisma.runtimeEnvironment.findMany({
    where: {
      pauseSource: EnvironmentPauseSource.BILLING_LIMIT,
    },
    select: {
      organizationId: true,
    },
    distinct: ["organizationId"],
  });

  return rows.map((row) => row.organizationId);
}

export async function collectOrgsToReconcile(options?: {
  excludeOrgIds?: Set<string>;
}): Promise<{
  targets: OrgReconcileTarget[];
  queuedOrgIds: string[];
}> {
  const excludeOrgIds = options?.excludeOrgIds ?? new Set<string>();
  const targetByOrgId = new Map<string, BillingLimitConvergeTargetState>();

  const activeLimits = await getActiveBillingLimits();
  if (activeLimits) {
    for (const org of activeLimits.orgs) {
      if (excludeOrgIds.has(org.orgId)) {
        continue;
      }
      targetByOrgId.set(org.orgId, org.limitState);
    }
  }

  const staleOrgIds = await getOrgIdsWithBillingPauseSource();
  for (const organizationId of staleOrgIds) {
    if (excludeOrgIds.has(organizationId) || targetByOrgId.has(organizationId)) {
      continue;
    }

    const billingLimit = await getBillingLimit(organizationId);
    targetByOrgId.set(organizationId, resolveConvergeTargetFromBillingLimit(billingLimit));
  }

  const queuedOrgIds = await readBillingLimitReconcileQueue();
  for (const organizationId of queuedOrgIds) {
    if (excludeOrgIds.has(organizationId) || targetByOrgId.has(organizationId)) {
      continue;
    }

    const billingLimit = await getBillingLimit(organizationId);
    targetByOrgId.set(organizationId, resolveConvergeTargetFromBillingLimit(billingLimit));
  }

  return {
    targets: Array.from(targetByOrgId.entries()).map(([organizationId, targetState]) => ({
      organizationId,
      targetState,
    })),
    queuedOrgIds,
  };
}

export async function clearProcessedReconcileQueueEntries(
  queuedOrgIds: string[],
  processedOrgIds: string[]
): Promise<void> {
  const processed = new Set(processedOrgIds);
  const toRemove = queuedOrgIds.filter((orgId) => processed.has(orgId));
  await removeFromBillingLimitReconcileQueue(toRemove);
}
