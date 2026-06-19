import type { RuntimeEnvironmentType } from "@trigger.dev/database";

export const BILLABLE_ENVIRONMENT_TYPES = [
  "PRODUCTION",
  "STAGING",
  "PREVIEW",
] as const satisfies RuntimeEnvironmentType[];

export type BillableEnvironmentType = (typeof BILLABLE_ENVIRONMENT_TYPES)[number];

export const BILLING_LIMIT_CONVERGE_BATCH_SIZE = 50;

export type BillingLimitConvergeTargetState = "grace" | "rejected" | "ok";

export function isBillableEnvironmentType(type: RuntimeEnvironmentType): boolean {
  return (BILLABLE_ENVIRONMENT_TYPES as readonly RuntimeEnvironmentType[]).includes(type);
}

export function buildBillingLimitResolveDedupeKey(
  organizationId: string,
  resolvedAt: string
): string {
  return `billing-limit-resolve:${organizationId}:${resolvedAt}`;
}

export function buildBillingLimitResolveJobId(
  organizationId: string,
  resolvedAt: string
): string {
  return `billingLimit.resolve:${organizationId}:${resolvedAt}`;
}

export function buildBillingLimitInProgressCancelJobId(
  organizationId: string,
  hitAt: string
): string {
  return `billingLimit.cancelInProgress:${organizationId}:${hitAt}`;
}
