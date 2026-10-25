import { brainHostId } from "@luke/wire/host-ids";

/**
 * The ids the host mints for what eve's stream names only relatively. A turn
 * of eve's is `turn_<n>` inside its session, and a received message or a
 * reasoning item has no id of its own; the store keys a turn by uuid and a
 * message by a client id unique in its conversation. Each id here is the
 * same function of the same coordinates, so a retried step that re-emits an
 * event under a new event id lands on the row the first attempt opened
 * rather than beside it. The function is `@luke/wire`'s (`host-ids.ts`), so a
 * window derives the id a line it sent is written under (`sentLineId`).
 */

const ID_KIND = {
  CHILD: "child",
  TURN: "turn",
  RECEIVED: "received",
  ANSWER: "answer",
  REASONING: "reasoning",
  NATIVE_TURN: "native-turn",
} as const;

/**
 * The store's id for the child conversation a subagent's session is recorded
 * in: one per call that started a subagent, so the parent's call alone finds
 * its subagent's record.
 */
export function childConversationId(parentConversationId: string, callId: string): string {
  return brainHostId([ID_KIND.CHILD, parentConversationId, callId]);
}

/** The store's id for one turn of one eve session. */
export function hostTurnId(sessionId: string, eveTurnId: string): string {
  return brainHostId([ID_KIND.TURN, sessionId, eveTurnId]);
}

/** The developer's line a turn opened with and, under its ordinal from one, each line that joined the turn under way; the first keeps the coordinate it always had. */
export function receivedMessageId(sessionId: string, eveTurnId: string, ordinal = 0): string {
  const parts = [ID_KIND.RECEIVED, sessionId, eveTurnId];
  if (ordinal > 0) parts.push(String(ordinal));
  return brainHostId(parts);
}

/**
 * The store's id for one turn of a native harness's conversation, by the
 * number of the runner event that opened it, which no other turn of the
 * conversation shares, so a batch posted again opens the same turn.
 */
export function nativeTurnId(conversationId: string, openingSequence: number): string {
  return brainHostId([ID_KIND.NATIVE_TURN, conversationId, String(openingSequence)]);
}

/** The client id of the assistant message a turn completes; the turn's id is its journal's client id already, so this is another. */
export function answerMessageId(sessionId: string, eveTurnId: string): string {
  return brainHostId([ID_KIND.ANSWER, sessionId, eveTurnId]);
}

/** The id a reasoning item stands under, since eve's stream carries none of the provider's. */
export function reasoningItemId(
  sessionId: string,
  eveTurnId: string,
  stepIndex: number,
  ordinal: number,
): string {
  return brainHostId([ID_KIND.REASONING, sessionId, eveTurnId, String(stepIndex), String(ordinal)]);
}
