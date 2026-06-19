import { EnvironmentPauseSource } from "@trigger.dev/database";
import type { PauseStatus } from "~/v3/services/pauseEnvironment.server";

export function getManualPauseEnvironmentResult(
  action: PauseStatus,
  pauseSource: EnvironmentPauseSource | null | undefined
):
  | { proceed: true }
  | { proceed: false; success: true; state: PauseStatus }
  | { proceed: false; success: false; error: string } {
  if (
    action === "resumed" &&
    pauseSource === EnvironmentPauseSource.BILLING_LIMIT
  ) {
    return {
      proceed: false,
      success: false,
      error:
        "This environment is paused because your organization reached its billing limit. Resolve the limit on the billing limits settings page to resume.",
    };
  }

  if (action === "paused" && pauseSource === EnvironmentPauseSource.BILLING_LIMIT) {
    return {
      proceed: false,
      success: true,
      state: "paused",
    };
  }

  return { proceed: true };
}
