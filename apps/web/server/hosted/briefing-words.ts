import type { ToolSet } from "ai";
import {
  BRAIN_TOOL,
  isRecord,
  isStoredToolPart,
  MESSAGE_ROLE,
  maximumBriefingLength,
  storedToolName,
  TOOL_PART_STATE,
  text,
  unparsedWire,
  type WireBoundaryInput,
} from "../core.js";
import type { HostedStoreRun } from "./store/database.js";
import { readMessageById, type SpeechOffer } from "./store/index.js";

/**
 * The briefing an announcement's row carries: the settled announce call's
 * input, read back under the vocabulary the row was written in and bounded
 * as the tool bounds it. A row this build cannot read, or one with no settled
 * announce call on it, has no words, and a caller that would speak or push
 * them leaves the offer standing rather than claiming words it cannot say.
 * The push pass and the live session service read the same words this way.
 */
export async function briefingWordsOf(
  run: HostedStoreRun,
  tools: ToolSet,
  offer: SpeechOffer,
): Promise<string | undefined> {
  const read = await run(
    readMessageById(offer.userId, offer.conversationId, tools, offer.messageId),
  );
  if (!read.ok) return undefined;
  const message = read.value[0]?.message;
  if (message === undefined || message.role !== MESSAGE_ROLE.ASSISTANT) return undefined;
  for (const part of message.parts) {
    if (!isStoredToolPart(part)) continue;
    if (storedToolName(part) !== BRAIN_TOOL.ANNOUNCE) continue;
    if (part.state !== TOOL_PART_STATE.OUTPUT_AVAILABLE) continue;
    // SAFETY: the part was read back from the row's jsonb column through the vocabulary; its input is the JSON that column held.
    const input = unparsedWire(part.input as WireBoundaryInput);
    const briefing = isRecord(input) ? text(input.briefing) : undefined;
    if (briefing) return briefing.slice(0, maximumBriefingLength);
  }
  return undefined;
}
