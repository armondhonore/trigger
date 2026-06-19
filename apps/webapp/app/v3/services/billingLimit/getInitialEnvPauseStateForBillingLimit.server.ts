import { EnvironmentPauseSource, type RuntimeEnvironmentType } from "@trigger.dev/database";
import type { Organization, Project, RuntimeEnvironment } from "@trigger.dev/database";
import type { BillingLimitResult } from "~/services/billingLimit.schemas";
import { updateEnvConcurrencyLimits } from "~/v3/runQueue.server";
import { isBillableEnvironmentType } from "./billingLimitConstants";
import { resolveConvergeTargetFromBillingLimit } from "./billingLimitReconciliation.server";

export type InitialEnvPauseState = {
  paused: boolean;
  pauseSource: typeof EnvironmentPauseSource.BILLING_LIMIT | null;
};

export type GetInitialEnvPauseStateDeps = {
  getBillingLimit?: (organizationId: string) => Promise<BillingLimitResult | undefined>;
};

export async function getInitialEnvPauseStateForBillingLimit(
  organizationId: string,
  type: RuntimeEnvironmentType,
  deps: GetInitialEnvPauseStateDeps = {}
): Promise<InitialEnvPauseState> {
  if (!isBillableEnvironmentType(type)) {
    return { paused: false, pauseSource: null };
  }

  const billingLimit = deps.getBillingLimit
    ? await deps.getBillingLimit(organizationId)
    : await (await import("~/services/platform.v3.server")).getBillingLimit(organizationId);
  const targetState = resolveConvergeTargetFromBillingLimit(billingLimit);

  if (targetState === "grace" || targetState === "rejected") {
    return {
      paused: true,
      pauseSource: EnvironmentPauseSource.BILLING_LIMIT,
    };
  }

  return { paused: false, pauseSource: null };
}

export async function applyBillingLimitPauseAfterEnvCreate(
  environment: RuntimeEnvironment & { organization: Organization; project: Project }
): Promise<void> {
  if (!environment.paused || environment.pauseSource !== EnvironmentPauseSource.BILLING_LIMIT) {
    return;
  }

  await updateEnvConcurrencyLimits(environment, 0);
}
