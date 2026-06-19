import { describe, expect, it } from "vitest";
import type { BillingLimitResult } from "~/services/billingLimit.schemas";
import { resolveConvergeTargetFromBillingLimit } from "~/v3/services/billingLimit/billingLimitReconciliation.server";

const graceLimit: BillingLimitResult = {
  isConfigured: true,
  mode: "custom",
  amountCents: 10_000,
  cancelInProgressRuns: false,
  limitState: { status: "grace", hitAt: "2026-01-01T00:00:00.000Z", graceEndsAt: "2026-01-02T00:00:00.000Z" },
  effectiveAmountCents: 10_000,
  gracePeriodMs: 86_400_000,
};

describe("billingLimitReconciliation", () => {
  it("maps grace and rejected limits to converge targets", () => {
    expect(resolveConvergeTargetFromBillingLimit(graceLimit)).toBe("grace");
    expect(
      resolveConvergeTargetFromBillingLimit({
        ...graceLimit,
        limitState: {
          status: "rejected",
          hitAt: "2026-01-01T00:00:00.000Z",
          graceEndsAt: "2026-01-02T00:00:00.000Z",
        },
      })
    ).toBe("rejected");
    expect(
      resolveConvergeTargetFromBillingLimit({
        ...graceLimit,
        limitState: { status: "ok" },
      })
    ).toBe("ok");
    expect(resolveConvergeTargetFromBillingLimit(undefined)).toBe("ok");
    expect(
      resolveConvergeTargetFromBillingLimit({ isConfigured: false, gracePeriodMs: 86_400_000 })
    ).toBe("ok");
  });
});
