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

export function recordingEve(refusing = false) {
  const sent: { readonly sessionId: string; readonly message: EveMessage }[] = [];
  const sessions: AgentSessions = {
    open: () =>
      Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` }),
    send: (sessionId, message) =>
      refusing
        ? Effect.fail(
            new EveUnreachable({
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
  return { sent, sessions, sessionsFor: () => Effect.succeed(sessions) };
}

function sentText(message: EveMessage["message"]): string {
  if (!Array.isArray(message)) return message;
  return message.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

export function sentTo(eve: ReturnType<typeof recordingEve>, sessionId: string): string[] {
  return eve.sent
    .filter((each) => each.sessionId === sessionId)
    .map((each) => sentText(each.message.message));
}
