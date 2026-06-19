import { Logger } from "@trigger.dev/core/logger";
import { Worker as RedisWorker } from "@trigger.dev/redis-worker";
import { z } from "zod";
import { env } from "~/env.server";
import { logger } from "~/services/logger.server";
import { singleton } from "~/utils/singleton";
import { BillingLimitConvergeEnvironmentsService } from "./services/billingLimit/billingLimitConvergeEnvironmentsService.server";
import type { BillingLimitConvergeTargetState } from "./services/billingLimit/billingLimitConstants";
import { buildBillingLimitInProgressCancelJobId } from "./services/billingLimit/billingLimitConstants";
import { runBillingLimitCancelInProgressRuns } from "./services/billingLimit/billingLimitCancelInProgressRuns.server";

function initializeWorker() {
  const redisOptions = {
    keyPrefix: "billing-limit:worker:",
    host: env.BILLING_LIMIT_WORKER_REDIS_HOST,
    port: env.BILLING_LIMIT_WORKER_REDIS_PORT,
    username: env.BILLING_LIMIT_WORKER_REDIS_USERNAME,
    password: env.BILLING_LIMIT_WORKER_REDIS_PASSWORD,
    enableAutoPipelining: true,
    ...(env.BILLING_LIMIT_WORKER_REDIS_TLS_DISABLED === "true" ? {} : { tls: {} }),
  };

  logger.debug(`👨‍🏭 Initializing billing limit worker at host ${env.BILLING_LIMIT_WORKER_REDIS_HOST}`);

  const worker = new RedisWorker({
    name: "billing-limit-worker",
    redisOptions,
    catalog: {
      "billingLimit.convergeEnvironments": {
        schema: z.object({
          organizationId: z.string(),
          targetState: z.enum(["grace", "rejected", "ok"]),
        }),
        visibilityTimeoutMs: 60_000 * 10,
        retry: {
          maxAttempts: 5,
        },
      },
      "billingLimit.reconcileTick": {
        schema: z.object({}),
        visibilityTimeoutMs: 60_000 * 5,
        retry: {
          maxAttempts: 3,
        },
      },
      "billingLimit.cancelInProgressRuns": {
        schema: z.object({
          organizationId: z.string(),
          hitAt: z.string(),
        }),
        visibilityTimeoutMs: 60_000 * 10,
        retry: {
          maxAttempts: 5,
        },
      },
    },
    concurrency: {
      workers: env.BILLING_LIMIT_WORKER_CONCURRENCY_WORKERS,
      tasksPerWorker: env.BILLING_LIMIT_WORKER_CONCURRENCY_TASKS_PER_WORKER,
      limit: env.BILLING_LIMIT_WORKER_CONCURRENCY_LIMIT,
    },
    pollIntervalMs: env.BILLING_LIMIT_WORKER_POLL_INTERVAL,
    immediatePollIntervalMs: env.BILLING_LIMIT_WORKER_IMMEDIATE_POLL_INTERVAL,
    shutdownTimeoutMs: env.BILLING_LIMIT_WORKER_SHUTDOWN_TIMEOUT_MS,
    logger: new Logger("BillingLimitWorker", env.BILLING_LIMIT_WORKER_LOG_LEVEL),
    jobs: {
      "billingLimit.convergeEnvironments": async ({ payload }) => {
        await BillingLimitConvergeEnvironmentsService.runConverge(payload);
      },
      "billingLimit.reconcileTick": async () => {
        await BillingLimitConvergeEnvironmentsService.runReconcileTick();
        await scheduleBillingLimitReconcileTick(worker);
      },
      "billingLimit.cancelInProgressRuns": async ({ payload }) => {
        await runBillingLimitCancelInProgressRuns(payload.organizationId, payload.hitAt);
      },
    },
  });

  if (env.BILLING_LIMIT_WORKER_ENABLED === "true") {
    logger.debug(
      `👨‍🏭 Starting billing limit worker at host ${env.BILLING_LIMIT_WORKER_REDIS_HOST}, reconcileIntervalMs = ${env.BILLING_LIMIT_RECONCILE_INTERVAL_MS}`
    );
    worker.start();
    void scheduleBillingLimitReconcileTick(worker);
  }

  return worker;
}

async function scheduleBillingLimitReconcileTick(worker: ReturnType<typeof initializeWorker>) {
  await worker.enqueue({
    id: "billingLimit.reconcileTick",
    job: "billingLimit.reconcileTick",
    payload: {},
    availableAt: new Date(Date.now() + env.BILLING_LIMIT_RECONCILE_INTERVAL_MS),
  });
}

export const billingLimitWorker = singleton("billingLimitWorker", initializeWorker);

export async function enqueueBillingLimitConverge(
  organizationId: string,
  targetState: BillingLimitConvergeTargetState
) {
  return billingLimitWorker.enqueue({
    id: `billingLimit.converge:${organizationId}:${targetState}`,
    job: "billingLimit.convergeEnvironments",
    payload: { organizationId, targetState },
  });
}

export async function enqueueBillingLimitCancelInProgressRuns(
  organizationId: string,
  hitAt: string
) {
  return billingLimitWorker.enqueue({
    id: buildBillingLimitInProgressCancelJobId(organizationId, hitAt),
    job: "billingLimit.cancelInProgressRuns",
    payload: { organizationId, hitAt },
  });
}
