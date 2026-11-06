/**
 * recording-sessions.ts -- an account's agent sessions as a sweep's test fakes them, writing down every message sent.
 *
 * A sweep that hands an agent a line (`steerAgent`) reaches the agents'
 * sessions per account; this stands in for them at the interface, opening every
 * session it is asked to and writing down each message sent by session, or
 * refusing every send as unreachable, so a test reads back what each agent
 * was told.
 */

import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  type AgentSessions,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
  type SessionMessage,
  SessionUnreachable,
} from "../agents/sessions/agent-sessions.js";

/** An account's agent sessions, writing down every message sent, by session, or refusing every send. */
export function recordingSessions(refusing = false) {
  const sent: { readonly sessionId: string; readonly message: SessionMessage }[] = [];
  const sessions: AgentSessions = {
    open: () =>
      Effect.succeed({ outcome: SESSION_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` }),
    send: (sessionId, message) =>
      refusing
        ? Effect.fail(
            new SessionUnreachable({
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
              outcome: SESSION_SEND_OUTCOME.ACCEPTED,
              sessionId,
              deliveryId: randomUUID(),
            } as const;
          }),
    cancel: () => Effect.succeed({ outcome: SESSION_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: SESSION_RESET_OUTCOME.RESET }),
  };
  return { sent, sessions, sessionsFor: () => Effect.succeed(sessions) };
}

/** The words of a message sent to a session. */
function sentText(message: SessionMessage["message"]): string {
  if (!Array.isArray(message)) return message;
  return message.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** The words the session was sent, in order. */
export function sentTo(
  agentSessions: ReturnType<typeof recordingSessions>,
  sessionId: string,
): string[] {
  return agentSessions.sent
    .filter((each) => each.sessionId === sessionId)
    .map((each) => sentText(each.message.message));
}
