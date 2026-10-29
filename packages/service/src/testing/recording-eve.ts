/**
 * recording-eve.ts -- eve's coding-agent service as a sweep's test fakes it, writing down every message sent.
 *
 * A sweep that hands an agent a line (`steerAgent`) reaches eve per
 * account; this stands in for it at the client's boundary, opening every
 * session it is asked to and writing down each message sent by session, or
 * refusing every send as unreachable, so a test reads back what each agent
 * was told.
 */

import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  EveUnreachable,
} from "../agents/eve-host/eve-sessions.js";

/** eve's coding-agent service, writing down every message sent, by session, or refusing every send. */
export function recordingEve(refusing = false) {
  const sent: { readonly sessionId: string; readonly message: EveMessage }[] = [];
  const sessions: AgentSessions = {
    open: () =>
      Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` }),
    send: (sessionId, message) =>
      refusing
        ? Effect.fail(
            new EveUnreachable({
              // SAFETY: the client's own error shape, built by the fake at the transport it stands for.
              cause: {
                _tag: "RequestError",
                reason: { _tag: "TransportError" },
                message: "refused",
              } as never,
            }),
          )
        : Effect.sync(() => {
            sent.push({ sessionId, message });
            return {
              outcome: EVE_SEND_OUTCOME.ACCEPTED,
              sessionId,
              deliveryId: randomUUID(),
            } as const;
          }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
  };
  return { sent, eveFor: () => Effect.succeed(sessions) };
}

/** The words of a message sent to eve. */
function sentText(message: EveMessage["message"]): string {
  if (!Array.isArray(message)) return message;
  return message.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** The words the session was sent, in order. */
export function sentTo(eve: ReturnType<typeof recordingEve>, sessionId: string): string[] {
  return eve.sent
    .filter((each) => each.sessionId === sessionId)
    .map((each) => sentText(each.message.message));
}
