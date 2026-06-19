import { type ActionFunctionArgs, json } from "@remix-run/server-runtime";
import { z } from "zod";
import { prisma } from "~/db.server";
import { BillingLimitHitWebhookBodySchema } from "~/services/billingLimit.schemas";
import { requireAdminApiRequest } from "~/services/personalAccessToken.server";
import { bustBillingLimitCaches } from "~/services/platform.v3.server";
import {
  enqueueBillingLimitCancelInProgressRuns,
  enqueueBillingLimitConverge,
} from "~/v3/billingLimitWorker.server";
import { BillingLimitConvergeEnvironmentsService } from "~/v3/services/billingLimit/billingLimitConvergeEnvironmentsService.server";
import { processBillingLimitHit } from "~/v3/services/billingLimit/billingLimitHit.server";

const ParamsSchema = z.object({
  organizationId: z.string(),
});

/** Billing platform webhook: org entered billing limit grace. Idempotent — returns 202. */
export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdminApiRequest(request);

  if (request.method.toLowerCase() !== "post") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { organizationId } = ParamsSchema.parse(params);
  const body = BillingLimitHitWebhookBodySchema.parse(await request.json());

  const organization = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { id: true },
  });

  if (!organization) {
    return json({ error: "Organization not found" }, { status: 404 });
  }

  await processBillingLimitHit(
    {
      organizationId,
      hitAt: body.hitAt,
      cancelInProgressRuns: body.cancelInProgressRuns,
    },
    {
      bustCaches: bustBillingLimitCaches,
      seedReconcileQueue: BillingLimitConvergeEnvironmentsService.seedReconcileQueue,
      enqueueConverge: enqueueBillingLimitConverge,
      enqueueCancelInProgressRuns: enqueueBillingLimitCancelInProgressRuns,
    }
  );

  return json({ success: true, accepted: true }, { status: 202 });
}
