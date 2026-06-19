import {
  EnvironmentPauseSource,
  type Organization,
  type PrismaClient,
  type Project,
  type RuntimeEnvironment,
} from "@trigger.dev/database";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.server";
import { updateEnvConcurrencyLimits } from "~/v3/runQueue.server";
import {
  BILLABLE_ENVIRONMENT_TYPES,
  BILLING_LIMIT_CONVERGE_BATCH_SIZE,
  type BillingLimitConvergeTargetState,
} from "./billingLimitConstants";

export type ConvergeOrgResult = {
  paused: number;
  unpaused: number;
};

type EnvironmentWithRelations = RuntimeEnvironment & {
  organization: Organization;
  project: Project;
};

type UpdateEnvConcurrency = (
  environment: EnvironmentWithRelations,
  maximumConcurrencyLimit?: number
) => Promise<void>;

export async function convergeBillingLimitEnvironmentsForOrg(
  organizationId: string,
  targetState: BillingLimitConvergeTargetState,
  options?: {
    batchSize?: number;
    prismaClient?: PrismaClient;
    updateConcurrency?: UpdateEnvConcurrency;
  }
): Promise<ConvergeOrgResult> {
  const db = options?.prismaClient ?? prisma;
  const batchSize = options?.batchSize ?? BILLING_LIMIT_CONVERGE_BATCH_SIZE;
  const updateConcurrency = options?.updateConcurrency ?? updateEnvConcurrencyLimits;

  if (targetState === "ok") {
    return unpauseBillingLimitEnvironments(organizationId, db, batchSize, updateConcurrency);
  }

  return pauseBillingLimitEnvironments(organizationId, db, batchSize, updateConcurrency);
}

async function pauseBillingLimitEnvironments(
  organizationId: string,
  db: PrismaClient,
  batchSize: number,
  updateConcurrency: UpdateEnvConcurrency
): Promise<ConvergeOrgResult> {
  let paused = 0;
  let cursor: string | undefined;

  while (true) {
    const environments = await db.runtimeEnvironment.findMany({
      where: {
        organizationId,
        type: { in: [...BILLABLE_ENVIRONMENT_TYPES] },
        paused: false,
      },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: {
        organization: true,
        project: true,
      },
    });

    if (environments.length === 0) {
      break;
    }

    for (const environment of environments) {
      await pauseEnvironmentForBillingLimit(environment, db, updateConcurrency);
      paused++;
    }

    cursor = environments[environments.length - 1]?.id;
    if (environments.length < batchSize) {
      break;
    }
  }

  logger.info("Billing limit converge paused environments", {
    organizationId,
    paused,
  });

  return { paused, unpaused: 0 };
}

async function unpauseBillingLimitEnvironments(
  organizationId: string,
  db: PrismaClient,
  batchSize: number,
  updateConcurrency: UpdateEnvConcurrency
): Promise<ConvergeOrgResult> {
  let unpaused = 0;
  let cursor: string | undefined;

  while (true) {
    const environments = await db.runtimeEnvironment.findMany({
      where: {
        organizationId,
        pauseSource: EnvironmentPauseSource.BILLING_LIMIT,
      },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: {
        organization: true,
        project: true,
      },
    });

    if (environments.length === 0) {
      break;
    }

    for (const environment of environments) {
      await resumeEnvironmentFromBillingLimit(environment, db, updateConcurrency);
      unpaused++;
    }

    cursor = environments[environments.length - 1]?.id;
    if (environments.length < batchSize) {
      break;
    }
  }

  logger.info("Billing limit converge unpaused environments", {
    organizationId,
    unpaused,
  });

  return { paused: 0, unpaused };
}

async function pauseEnvironmentForBillingLimit(
  environment: EnvironmentWithRelations,
  db: PrismaClient,
  updateConcurrency: UpdateEnvConcurrency
) {
  const updated = await db.runtimeEnvironment.update({
    where: { id: environment.id },
    data: {
      paused: true,
      pauseSource: EnvironmentPauseSource.BILLING_LIMIT,
    },
    include: {
      organization: true,
      project: true,
    },
  });

  await updateConcurrency(updated, 0);
}

async function resumeEnvironmentFromBillingLimit(
  environment: EnvironmentWithRelations,
  db: PrismaClient,
  updateConcurrency: UpdateEnvConcurrency
) {
  const updated = await db.runtimeEnvironment.update({
    where: { id: environment.id },
    data: {
      paused: false,
      pauseSource: null,
    },
    include: {
      organization: true,
      project: true,
    },
  });

  await updateConcurrency(updated);
}
