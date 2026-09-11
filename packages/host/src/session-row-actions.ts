import { ACTION_REFUSAL } from "@sidecar/actions";
import {
  PRODUCT_SESSION_ACTION,
  type ProductSessionAction,
  type RecordProductEvent,
} from "@sidecar/analytics";
import type { HostedActionClient, HostedActionOutcome, HostedActionTarget } from "@sidecar/hosted";
import {
  isCloudAgentProviderId,
  type Session,
  type SessionIdentity,
  type SessionWriteResult,
  sessionWithIdentity,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import {
  HOSTED_ACTION_ANSWER,
  hostedActionResult,
  settleHostedWrite,
} from "./hosted-action-result.js";

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
      return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: HOSTED_ACTION_ANSWER.NO_ENDPOINT };
    }
    return settleHostedWrite(
      hostedActionResult(await call({ providerId, providerSessionId: session.providerSessionId })),
      providerId,
      counted,
      refresh,
      recordProductEvent,
    );
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
