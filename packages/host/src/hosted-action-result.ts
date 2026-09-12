import {
  PRODUCT_EVENT,
  type ProductSessionAction,
  type RecordProductEvent,
} from "@sidecar/analytics";
import {
  HOSTED_ACTION_FAILURE,
  type HostedActionFailure,
  type HostedActionOutcome,
  type HostedActionWorkspaceOutcome,
} from "@sidecar/hosted";
import type { CloudAgentProviderId, SessionWriteResult } from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";

/** What a caller hears of a service call that ended short of the provider's own answer. */
export const HOSTED_ACTION_ANSWER = {
  NO_ENDPOINT: "That session's provider documents no way in from this Mac.",
  NOT_SENT: "Luke could not reach his service under your account; sign in and try again.",
  REFUSED: "Luke's service refused the request before it reached the provider.",
  UNSAID: "The provider refused the write and said nothing more.",
  LOST: "The write was handed on, and its answer was lost; it may have landed.",
  UNREADABLE:
    "The write was handed on, and its provider answered in a shape this build cannot read.",
} as const;

/**
 * A failure short of an answer, as the caller hears it. A call that never left
 * or was turned away ran nothing and is a refusal; one that left and lost its
 * answer, or came back unreadable, may have landed, and the caller must
 * neither call it failed nor repeat it.
 */
const FAILURE_RESULT = {
  [HOSTED_ACTION_FAILURE.NOT_SENT]: {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: HOSTED_ACTION_ANSWER.NOT_SENT,
  },
  [HOSTED_ACTION_FAILURE.REFUSED]: {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: HOSTED_ACTION_ANSWER.REFUSED,
  },
  [HOSTED_ACTION_FAILURE.LOST]: {
    status: UNKNOWN_ACTION_STATUS,
    reason: HOSTED_ACTION_ANSWER.LOST,
  },
  [HOSTED_ACTION_FAILURE.UNREADABLE]: {
    status: UNKNOWN_ACTION_STATUS,
    reason: HOSTED_ACTION_ANSWER.UNREADABLE,
  },
} as const satisfies Readonly<Record<HostedActionFailure, SessionWriteResult>>;

/**
 * The service's answer to a session act as the write result it means: the
 * provider's own status and sentence where the call answered, and where it
 * did not, the one reading of that end that says whether the act may have
 * landed. A row's press and the brain's admitted act hear the same words,
 * because the same call carried both.
 */
export function hostedActionResult(
  outcome: HostedActionOutcome | HostedActionWorkspaceOutcome,
): SessionWriteResult {
  if ("failure" in outcome) return FAILURE_RESULT[outcome.failure];
  const { answer } = outcome;
  if (answer.result === ACTION_RESULT_STATUS.ACCEPTED) {
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  }
  return { status: answer.result, reason: answer.reason ?? HOSTED_ACTION_ANSWER.UNSAID };
}

/**
 * What every write earns once the service has answered: the roster drawn
 * again, and a landed write counted. A rejection redraws like an acceptance,
 * because a write whose answer never arrived may still have landed, so the
 * roster must catch up with the provider rather than keep advertising what
 * it may have already taken; only a write the service says its provider
 * cannot take at all moved nothing.
 *
 * The redraw is a poke and never a wait: `refresh` starts the observation
 * pass on the runtime the composition handed its caller and answers at once,
 * exactly as the detached promise it replaces did.
 */
export function settleHostedWrite<Result extends SessionWriteResult>(
  result: Result,
  providerId: CloudAgentProviderId,
  counted: ProductSessionAction,
  refresh: () => void,
  recordProductEvent: RecordProductEvent,
): Result {
  if (result.status !== ACTION_RESULT_STATUS.UNSUPPORTED) refresh();
  if (result.status === ACTION_RESULT_STATUS.ACCEPTED) {
    recordProductEvent(PRODUCT_EVENT.SESSION_ACTION_SEND, {
      provider_id: providerId,
      session_action: counted,
    });
  }
  return result;
}
