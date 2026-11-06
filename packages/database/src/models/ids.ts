import { hostMintedId } from "@repo/wire/host-ids";

const ID_KIND = {
  CHILD: "child",
  TURN: "turn",
  RECEIVED: "received",
  ANSWER: "answer",
  REASONING: "reasoning",
  NATIVE_TURN: "native-turn",
} as const;

export function childConversationId(parentConversationId: string, callId: string): string {
  return hostMintedId([ID_KIND.CHILD, parentConversationId, callId]);
}

export function hostTurnId(sessionId: string, eveTurnId: string): string {
  return hostMintedId([ID_KIND.TURN, sessionId, eveTurnId]);
}

export function receivedMessageId(sessionId: string, eveTurnId: string, ordinal = 0): string {
  const parts = [ID_KIND.RECEIVED, sessionId, eveTurnId];
  if (ordinal > 0) parts.push(String(ordinal));
  return hostMintedId(parts);
}

export function nativeTurnId(conversationId: string, openingSequence: number): string {
  return hostMintedId([ID_KIND.NATIVE_TURN, conversationId, String(openingSequence)]);
}

export function answerMessageId(sessionId: string, eveTurnId: string): string {
  return hostMintedId([ID_KIND.ANSWER, sessionId, eveTurnId]);
}

export function reasoningItemId(
  sessionId: string,
  eveTurnId: string,
  stepIndex: number,
  ordinal: number,
): string {
  return hostMintedId([
    ID_KIND.REASONING,
    sessionId,
    eveTurnId,
    String(stepIndex),
    String(ordinal),
  ]);
}
