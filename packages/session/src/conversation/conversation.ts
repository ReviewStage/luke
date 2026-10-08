/**
 * The lines a call is spoken in, as this side still speaks them: the kind
 * each line is and who it speaks for, the words themselves, and the caption
 * a voice window draws while a line is still being said. The conversation
 * itself is the service's record; no thread of these lines is kept on this
 * side.
 */

/** What one line records, which also says who it speaks for. */
export const CONVERSATION_ENTRY_KIND = {
  /** The developer's own spoken turn, as the voice service transcribed it. */
  ASK: "spoken-ask",
  /** The words Luke spoke as a conversation reply. */
  REPLY: "reply",
} as const;

export type ConversationEntryKind =
  (typeof CONVERSATION_ENTRY_KIND)[keyof typeof CONVERSATION_ENTRY_KIND];

export interface ConversationEntry {
  kind: ConversationEntryKind;
  /**
   * The line's words, kept whole with their line structure: a reply's list
   * or code block needs its newlines to be one, and a line that silently
   * dropped the end of a long ask or reply would misquote the developer to
   * themselves.
   */
  words: string;
}

/**
 * One normalization for every line: line endings made uniform and the ends
 * trimmed, the line structure between kept. No length cut, and no
 * flattening.
 */
function normalizedEntryWords(words: string): string {
  return words.replace(/\r\n?/g, "\n").trim();
}

/**
 * One line still being said, for the voice window to draw while its words
 * grow. Presentation only — nothing built here is recorded anywhere; the
 * record is the service's.
 */
export function streamingConversationEntry(
  kind: ConversationEntryKind,
  words: string,
): ConversationEntry | undefined {
  const normalized = normalizedEntryWords(words);
  if (!normalized) return undefined;
  return { kind, words: normalized };
}

/**
 * One line still being said, as the voice window reports it: the ledger's
 * row it grows on, an opaque id minted when the row opened and stable from
 * then on, so a later fragment grows the line in place; its words so far;
 * the span it stands in on the session's own timeline, milliseconds from the
 * session's start; and whether the row has settled, meaning no fragment has
 * joined it for the gap.
 */
export interface LiveConversationLine {
  readonly rowId: string;
  readonly entry: ConversationEntry;
  readonly startMs: number;
  readonly endMs: number;
  /**
   * The store's id for the voice session the line is said on, the one its
   * row on record names as its `voice_session_id`; absent for a session no
   * account holds, which writes no row.
   */
  readonly voiceSessionId?: string;
  readonly settled: boolean;
}
