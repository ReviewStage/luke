import { INTEGRATION_NAME, type IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { CONNECT_GITHUB_LABEL } from "./planning/planning-model";

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

export type Failure =
  | {
      readonly reason: typeof FAILURE_REASON.RECONNECT_INTEGRATION;
      readonly text: string;
      readonly provider: IntegrationProvider;
    }
  | {
      readonly reason: Exclude<FailureReason, typeof FAILURE_REASON.RECONNECT_INTEGRATION>;
      readonly text: string;
    };

/** The remedy's label; none where only Retry answers. */
export function remedyLabel(failure: Failure): string | undefined {
  switch (failure.reason) {
    case FAILURE_REASON.GITHUB_SIGN_IN:
      return CONNECT_GITHUB_LABEL;
    case FAILURE_REASON.RECONNECT_INTEGRATION:
      return `Reconnect ${INTEGRATION_NAME[failure.provider]}`;
    case FAILURE_REASON.API_KEY:
      return "Open API keys";
    case FAILURE_REASON.OTHER:
      return undefined;
  }
}
