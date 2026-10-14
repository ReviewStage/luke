import { OPEN_SETTINGS_LABEL } from "./open-settings";

/**
 * failure-remedy.ts -- why a failure stands, as a typed word beside its sentence, and what the press that mends it says.
 */

export const FAILURE_REASON = {
  GITHUB_SIGN_IN: "github-sign-in",
  RECONNECT_INTEGRATION: "reconnect-integration",
  API_KEY: "api-key",
  OTHER: "other",
} as const;

export type FailureReason = (typeof FAILURE_REASON)[keyof typeof FAILURE_REASON];

export interface Failure {
  readonly reason: FailureReason;
  readonly text: string;
}

/** The remedy's label; none where only Retry answers. */
export function remedyLabel(failure: Failure): string | undefined {
  switch (failure.reason) {
    case FAILURE_REASON.GITHUB_SIGN_IN:
      return OPEN_SETTINGS_LABEL;
    // An integration is connected in one place, Settings › Integrations, so the press goes there.
    case FAILURE_REASON.RECONNECT_INTEGRATION:
      return OPEN_SETTINGS_LABEL;
    case FAILURE_REASON.API_KEY:
      return "Open API keys";
    case FAILURE_REASON.OTHER:
      return undefined;
  }
}
