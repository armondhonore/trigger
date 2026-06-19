import { BulkActionId } from "@trigger.dev/core/v3/isomorphic";
import {
  BulkActionNotificationType,
  BulkActionType,
  Prisma,
  type PrismaClient,
  type TaskRunStatus,
} from "@trigger.dev/database";
import { QUEUED_STATUSES, RUNNING_STATUSES } from "~/components/runs/v3/TaskRunStatus";
import { prisma } from "~/db.server";
import type { RunsRepository } from "~/services/runsRepository/runsRepository.server";
import { commonWorker } from "~/v3/commonWorker.server";
import {
  countInProgressRunsForBillableEnvironment,
  countQueuedRunsForBillableEnvironment,
  createBillingLimitRunsRepository,
  getBillableEnvironmentsForBillingLimit,
} from "./billingLimitQueuedRuns.server";

export const BILLING_LIMIT_RESOLVE_CANCEL_SOURCE = "billing_limit_resolve_new_only";
export const BILLING_LIMIT_IN_PROGRESS_CANCEL_SOURCE = "billing_limit_in_progress";

type BulkCancelSource =
  | typeof BILLING_LIMIT_RESOLVE_CANCEL_SOURCE
  | typeof BILLING_LIMIT_IN_PROGRESS_CANCEL_SOURCE;

export type BillingLimitBulkCancelDeps = {
  prismaClient?: PrismaClient;
  createRunsRepository?: (organizationId: string) => Promise<RunsRepository>;
  enqueueProcessBulkAction?: (bulkActionId: string) => Promise<unknown>;
};

function resolveBulkCancelDeps(deps?: BillingLimitBulkCancelDeps) {
  return {
    prismaClient: deps?.prismaClient ?? prisma,
    createRunsRepository: deps?.createRunsRepository ?? createBillingLimitRunsRepository,
    enqueueProcessBulkAction:
      deps?.enqueueProcessBulkAction ??
      (async (bulkActionId: string) => {
        await commonWorker.enqueue({
          id: `processBulkAction-${bulkActionId}`,
          job: "processBulkAction",
          payload: { bulkActionId },
        });
      }),
  };
}

export class BillingLimitBulkCancelService {
  static async cancelQueuedRuns(
    organizationId: string,
    options?: { dedupeKey?: string },
    deps?: BillingLimitBulkCancelDeps
  ): Promise<{ bulkActionIds: string[] }> {
    return this.cancelRunsForBillableEnvironments(
      organizationId,
      {
        source: BILLING_LIMIT_RESOLVE_CANCEL_SOURCE,
        statuses: [...QUEUED_STATUSES],
        name: "Billing limit resolve — cancel queued runs",
        countRuns: countQueuedRunsForBillableEnvironment,
        dedupeKey: options?.dedupeKey,
      },
      deps
    );
  }

  static async cancelInProgressRuns(
    organizationId: string,
    options: { hitAt: string },
    deps?: BillingLimitBulkCancelDeps
  ): Promise<{ bulkActionIds: string[] }> {
    return this.cancelRunsForBillableEnvironments(
      organizationId,
      {
        source: BILLING_LIMIT_IN_PROGRESS_CANCEL_SOURCE,
        statuses: [...RUNNING_STATUSES],
        name: "Billing limit hit — cancel in-progress runs",
        countRuns: countInProgressRunsForBillableEnvironment,
        dedupeKey: options.hitAt,
      },
      deps
    );
  }

  private static async cancelRunsForBillableEnvironments(
    organizationId: string,
    options: {
      source: BulkCancelSource;
      statuses: TaskRunStatus[];
      name: string;
      countRuns: typeof countQueuedRunsForBillableEnvironment;
      dedupeKey?: string;
    },
    deps?: BillingLimitBulkCancelDeps
  ): Promise<{ bulkActionIds: string[] }> {
    const { prismaClient, createRunsRepository, enqueueProcessBulkAction } =
      resolveBulkCancelDeps(deps);

    const environments = await getBillableEnvironmentsForBillingLimit(
      organizationId,
      prismaClient
    );

    if (environments.length === 0) {
      return { bulkActionIds: [] };
    }

    const runsRepository = await createRunsRepository(organizationId);
    const bulkActionIds: string[] = [];

    for (const environment of environments) {
      if (options.dedupeKey) {
        const existing = await prismaClient.bulkActionGroup.findFirst({
          where: {
            environmentId: environment.id,
            type: BulkActionType.CANCEL,
            AND: [
              {
                params: {
                  path: ["source"],
                  equals: options.source,
                },
              },
              {
                params: {
                  path: ["dedupeKey"],
                  equals: options.dedupeKey,
                },
              },
            ],
          },
          select: { friendlyId: true },
        });

        if (existing) {
          bulkActionIds.push(existing.friendlyId);
          continue;
        }
      }

      const count = await options.countRuns(runsRepository, organizationId, environment);

      if (count === 0) {
        continue;
      }

      const { id, friendlyId } = BulkActionId.generate();

      await prismaClient.bulkActionGroup.create({
        data: {
          id,
          friendlyId,
          projectId: environment.projectId,
          environmentId: environment.id,
          name: options.name,
          type: BulkActionType.CANCEL,
          params: {
            statuses: options.statuses,
            finalizeRun: true,
            source: options.source,
            ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
          } as Prisma.InputJsonValue,
          queryName: "bulk_action_v1",
          totalCount: count,
          completionNotification: BulkActionNotificationType.NONE,
        },
      });

      await enqueueProcessBulkAction(id);

      bulkActionIds.push(friendlyId);
    }

    return { bulkActionIds };
  }
}
