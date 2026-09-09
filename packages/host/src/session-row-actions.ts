import {
  ACTION_KIND,
  type ActionRequest,
  type ActionRoster,
  admit,
  type SessionActionKind,
} from "@sidecar/actions";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  isSessionWriteResult,
  type SessionIdentity,
  type SessionWriteResult,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import type { SessionActionPerformer } from "./session-action-performer.js";

/**
 * What a row's own write needs: the roster admission reads for itself — a
 * fresh observation, then the sessions an action may name — and the performer
 * that carries only what admission minted. Nothing here holds a session or an
 * adapter; a row names an identity and a control id, and every word of what
 * reaches a provider is read back out of the roster by `admit`.
 */
export interface SessionRowActionsDependencies {
  roster: ActionRoster;
  performer: Pick<SessionActionPerformer, "perform">;
}

/**
 * The two writes a session's own row asks for: the message typed into its
 * composer and the press of a control its provider advertised. They are the
 * developer's own acts, so they run under the developer's origin and no
 * guard — a press opens its turn and its effect in the same breath — but they
 * run the whole gauntlet a spoken ask does: `admit` reads the roster afresh,
 * the target has to be one it holds, the advertised entry itself becomes what
 * the action carries, and the text is refused rather than cut. A refusal is
 * an answer for the row, never a throw, because a write is the user's own act
 * and what became of it belongs beside the field it left.
 */
export interface SessionRowActions {
  sendMessage(identity: SessionIdentity, text: string): Promise<SessionWriteResult>;
  executeControl(identity: SessionIdentity, controlId: string): Promise<SessionWriteResult>;
}

const REFUSAL = {
  UNREADABLE_ANSWER: "That session's provider answered in a shape this build cannot read.",
} as const;

export function createSessionRowActions(
  dependencies: SessionRowActionsDependencies,
): SessionRowActions {
  const { roster, performer } = dependencies;

  const carry = async (request: ActionRequest<SessionActionKind>): Promise<SessionWriteResult> => {
    const admitted = await admit(request, { origin: RUN_ORIGIN.USER, roster });
    if (admitted.kind === undefined) {
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: admitted.reason };
    }
    const result = await performer.perform(admitted);
    return isSessionWriteResult(result)
      ? result
      : { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSAL.UNREADABLE_ANSWER };
  };

  // The fields are keyed by the action's own schema names — the dialect
  // admission already reads for a tool call — so a row's ask and a spoken one
  // meet the same admitter over the same names.
  return {
    sendMessage: (identity, text) =>
      carry({
        kind: ACTION_KIND.MESSAGE,
        fields: {
          provider_id: identity.providerId,
          provider_session_id: identity.providerSessionId,
          text,
        },
      }),
    executeControl: (identity, controlId) =>
      carry({
        kind: ACTION_KIND.CONTROL,
        fields: {
          provider_id: identity.providerId,
          provider_session_id: identity.providerSessionId,
          control_id: controlId,
        },
      }),
  };
}
