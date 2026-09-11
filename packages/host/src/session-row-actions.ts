import { ACTION_REFUSAL } from "@sidecar/actions";
import {
  PRODUCT_EVENT,
  PRODUCT_SESSION_ACTION,
  type ProductSessionAction,
  type RecordProductEvent,
} from "@sidecar/analytics";
import {
  HOSTED_ACTION_FAILURE,
  type HostedActionClient,
  type HostedActionFailure,
  type HostedActionOutcome,
  type HostedActionTarget,
} from "@sidecar/hosted";
import {
  isCloudAgentProviderId,
  type Session,
  type SessionIdentity,
  type SessionWriteResult,
  sessionWithIdentity,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";

/**
 * What a row's own write needs: the sessions the rows draw, read at the
 * press, the service call that carries the write, and the redraw a landed
 * write earns. Nothing here holds a roster of its own or an adapter: a row
 * names an identity and a control id, and every word of what reaches a
 * provider is read back out of the stored snapshot by the service's own
 * admission.
 */
export interface SessionRowActionsDependencies {
  /** The roster the rows were drawn from, as it stands at the press. */
  drawn: () => readonly Session[];
  client: Pick<HostedActionClient, "sendMessage" | "executeControl">;
  /** Draws the roster again, so a write that moved a session is seen rather than remembered. */
  refresh: () => Promise<void>;
  recordProductEvent: RecordProductEvent;
}

/**
 * The two writes a session's own row asks for: the message typed into its
 * composer and the press of a control its provider advertised. They are the
 * developer's own acts, and they are admitted where the roster is: the
 * service admits each against the stored snapshot the row was drawn from,
 * by the same `admit()` every action runs, builds the write from that
 * snapshot's own advertisement, and answers what the provider said. The one
 * thing decided here is that the row still stands — a session the drawn
 * roster no longer holds is refused without a call, as it always was. A
 * refusal is an answer for the row, never a throw, because a write is the
 * user's own act and what became of it belongs beside the field it left.
 */
export interface SessionRowActions {
  sendMessage(identity: SessionIdentity, text: string): Promise<SessionWriteResult>;
  executeControl(identity: SessionIdentity, controlId: string): Promise<SessionWriteResult>;
}

const ROW_ANSWER = {
  NO_ENDPOINT: "That session's provider documents no way in from this Mac.",
  NOT_SENT: "Luke could not reach his service under your account; sign in and try again.",
  REFUSED: "Luke's service refused the request before it reached the provider.",
  UNSAID: "The provider refused the write and said nothing more.",
  LOST: "The write was handed on, and its answer was lost; it may have landed.",
  UNREADABLE:
    "The write was handed on, and its provider answered in a shape this build cannot read.",
} as const;

/**
 * A failure short of an answer, as the row hears it. A call that never left
 * or was turned away ran nothing and is a refusal; one that left and lost its
 * answer, or came back unreadable, may have landed, and the row must neither
 * call it failed nor repeat it.
 */
const FAILURE_RESULT = {
  [HOSTED_ACTION_FAILURE.NOT_SENT]: {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ROW_ANSWER.NOT_SENT,
  },
  [HOSTED_ACTION_FAILURE.REFUSED]: {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ROW_ANSWER.REFUSED,
  },
  [HOSTED_ACTION_FAILURE.LOST]: { status: UNKNOWN_ACTION_STATUS, reason: ROW_ANSWER.LOST },
  [HOSTED_ACTION_FAILURE.UNREADABLE]: {
    status: UNKNOWN_ACTION_STATUS,
    reason: ROW_ANSWER.UNREADABLE,
  },
} as const satisfies Readonly<Record<HostedActionFailure, SessionWriteResult>>;

function writeResult(outcome: HostedActionOutcome): SessionWriteResult {
  if ("failure" in outcome) return FAILURE_RESULT[outcome.failure];
  const { answer } = outcome;
  if (answer.result === ACTION_RESULT_STATUS.ACCEPTED) {
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  }
  return { status: answer.result, reason: answer.reason ?? ROW_ANSWER.UNSAID };
}

export function createSessionRowActions(
  dependencies: SessionRowActionsDependencies,
): SessionRowActions {
  const { drawn, client, refresh, recordProductEvent } = dependencies;

  const carry = async (
    identity: SessionIdentity,
    counted: ProductSessionAction,
    call: (target: HostedActionTarget) => Promise<HostedActionOutcome>,
  ): Promise<SessionWriteResult> => {
    const session = sessionWithIdentity(identity, drawn());
    if (!session)
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: ACTION_REFUSAL.NO_SESSION };
    const providerId = session.providerId;
    if (!isCloudAgentProviderId(providerId)) {
      return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: ROW_ANSWER.NO_ENDPOINT };
    }
    const result = writeResult(
      await call({ providerId, providerSessionId: session.providerSessionId }),
    );
    // A rejection redraws like an acceptance: a write whose answer never
    // arrived may still have landed, so the rows must catch up with the
    // snapshot rather than keep advertising what it may have already taken.
    if (result.status !== ACTION_RESULT_STATUS.UNSUPPORTED) void refresh().catch(() => undefined);
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) {
      recordProductEvent(PRODUCT_EVENT.SESSION_ACTION_SEND, {
        provider_id: providerId,
        session_action: counted,
      });
    }
    return result;
  };

  return {
    sendMessage: (identity, text) =>
      carry(identity, PRODUCT_SESSION_ACTION.MESSAGE_SEND, (target) =>
        client.sendMessage(target, text),
      ),
    executeControl: (identity, controlId) =>
      carry(identity, PRODUCT_SESSION_ACTION.CONTROL_RUN, (target) =>
        client.executeControl(target, controlId),
      ),
  };
}
