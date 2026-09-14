/**
 * The lines a conversation is spoken in, as this side still speaks them: the
 * kind each line is and who it speaks for, the words themselves, and the two
 * reads that build one — the caption a voice window draws while a line is
 * still being said, and the parse that takes a line back from another
 * process of the same build. The conversation itself is the service's record
 * since the exchange moved there; no thread of these lines is kept on this
 * side, and the seed a voice session opens with is the desk alone.
 */

import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { Schema } from "effect";
import type { SessionIdentity } from "../session-identity.js";

/**
 * The note a line carries in place of an identity the roster no longer
 * reports, taught verbatim by the standing instructions a voice runs under,
 * so the words the model is taught are always the words it reads: a line
 * wearing it names work that is gone — perhaps already archived — never an
 * invitation to act on a lookalike still observed.
 */
export const SESSION_NO_LONGER_OBSERVED_NOTE = "this session is no longer observed";

/** What one history line records, which also says who it speaks for. */
export const CONVERSATION_ENTRY_KIND = {
  /** The developer's own spoken turn, as the voice service transcribed it. */
  ASK: "spoken-ask",
  /** The words Luke spoke as a conversation reply. */
  REPLY: "reply",
  /** The words Luke spoke as a proactive announcement. */
  ANNOUNCEMENT: "announcement",
  /** An action Luke carried at the developer's ask, recorded as the ask itself. */
  ACTION: "action",
  /** An action Luke took on his own judgment, in a turn the developer did not open, recorded as his. */
  OWN_ACTION: "own-action",
} as const;

export type ConversationEntryKind =
  (typeof CONVERSATION_ENTRY_KIND)[keyof typeof CONVERSATION_ENTRY_KIND];

export const ConversationEntryKindSchema = Schema.Literals(Object.values(CONVERSATION_ENTRY_KIND));

const readsConversationEntryKind = Schema.is(ConversationEntryKindSchema);

export function isConversationEntryKind(value: UnparsedWireValue): value is ConversationEntryKind {
  return readsConversationEntryKind(value);
}

/**
 * How many recent lines a seed may carry, and how long each may run when it
 * is handed to a model. Together they bound what one seed can cost a
 * session's window; a line itself keeps its full words, because a caption
 * cut mid-sentence misreports what was said.
 */
export const maximumConversationEntries = 20;
export const maximumConversationEntryLength = 400;

export interface ConversationEntry {
  kind: ConversationEntryKind;
  /**
   * The line's own identity, minted once by the writer that recorded it and
   * carried on every report of it since; two deliberate identical utterances,
   * each with an id of its own, stay two. Never rendered into model context.
   */
  eventId?: string;
  /**
   * The line's words, kept whole with their line structure: the panel draws
   * them as the Markdown they were written in, and a reply's list or code
   * block needs its newlines to be one. A seed's copy is cut to
   * {@link maximumConversationEntryLength} — a window needs what was talked
   * about, not every word of it — but a line that silently dropped the end
   * of a long ask or reply would misquote the developer to themselves.
   */
  words: string;
  /**
   * The roster-validated session the line was about, when it was about one.
   * Only ever an identity the roster reported at the moment of the entry —
   * never one a model composed — and named to a model only while the
   * session is still observed; once the roster lets the session go,
   * {@link SESSION_NO_LONGER_OBSERVED_NOTE} stands in place of the ids, so a
   * stale identity can neither steer a tool call toward a refusal nor leave
   * "that chat" open to a lookalike.
   */
  identity?: SessionIdentity;
  /**
   * When the line happened in the conversation, stamped by the writer that
   * recorded it; a caption still being said carries none. Never enters model
   * context.
   */
  recordedAt?: number;
  /**
   * The brain run this line belongs to, when it is an ask the brain took or
   * the reply that run ended in. Never rendered into model context.
   */
  requestId?: string;
}

/** The recent slice safe to seed a session's context window with. */
export function recentConversationEntries(
  entries: readonly ConversationEntry[],
): readonly ConversationEntry[] {
  return entries.slice(-maximumConversationEntries);
}

/**
 * One normalization for every line, however it enters: line endings made
 * uniform and the ends trimmed, the line structure between kept, because the
 * panel draws a list as a list and a fence as a fence. No length cut, and no
 * flattening: a seed applies its own bound to its own copy.
 */
function normalizedEntryWords(words: string): string {
  return words.replace(/\r\n?/g, "\n").trim();
}

/**
 * The words of one reply said as several messages — a model answer carrying
 * more than one message item, its words before a tool call and after it, or
 * a call's back-to-back output items — kept whole and in order, each apart
 * from the next as its own paragraph. A message that said nothing adds no
 * paragraph, so a reply whose last message was empty still carries everything
 * said before it, and nothing said is ever dropped or run onto its neighbor.
 */
export function joinReplyMessages(messages: readonly string[]): string {
  return messages
    .map((message) => message.trim())
    .filter((message) => message.length > 0)
    .join("\n\n");
}

/**
 * One line still being said, for the panel to draw under the Conversation
 * while its words grow. It is normalized exactly as a settled line is, so the
 * streaming bubble and the record can never disagree, and it carries no
 * timestamp: a line still growing has not happened yet. Presentation only —
 * nothing built here is recorded anywhere; the record is the service's.
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
 * What one line's optional fields are held to, which is a question of where
 * it came from rather than of the line itself.
 */
export interface StoredConversationEntryOptions {
  /**
   * `true` reads a settled line: every optional field is validated and a
   * clock is required, so a record from a build that spelled an entry
   * differently drops the line rather than what stands around it. `false`
   * reads a line another process of the same build just handed over — the
   * voice window's captions crossing to the panel — where every optional
   * field is taken as it was sent and an unclocked draft is legal.
   *
   * Fields an older build carried beside the words are left unread rather
   * than refused either way, so the words of a line recorded before them
   * still come back.
   */
  strict: boolean;
}

/**
 * Parses one line back, or nothing, under the read's own strictness. The
 * default is the stricter read, so a caller that omits the argument gets the
 * read that refuses rather than the one that trusts.
 */
export function storedConversationEntry(
  value: UnparsedWireValue,
  { strict }: StoredConversationEntryOptions = { strict: true },
): ConversationEntry | undefined {
  if (!isRecord(value) || !isConversationEntryKind(value.kind) || !isWireString(value.words)) {
    return undefined;
  }
  if (strict) {
    const normalized = normalizedEntryWords(value.words);
    if (!normalized || normalized !== value.words) return undefined;
    if (value.requestId !== undefined && !(isWireString(value.requestId) && value.requestId)) {
      return undefined;
    }
    if (value.eventId !== undefined && !(isWireString(value.eventId) && value.eventId)) {
      return undefined;
    }
  }
  const recordedAt = isWireNumber(value.recordedAt) ? value.recordedAt : undefined;
  if (strict && (recordedAt === undefined || !Number.isFinite(recordedAt) || recordedAt < 0)) {
    return undefined;
  }
  const identity = value.identity;
  const providerId = isRecord(identity) ? identity.providerId : undefined;
  const providerSessionId = isRecord(identity) ? identity.providerSessionId : undefined;
  if (
    identity !== undefined &&
    !(
      isWireString(providerId) &&
      isWireString(providerSessionId) &&
      (!strict || (providerId.length > 0 && providerSessionId.length > 0))
    )
  ) {
    return undefined;
  }
  return {
    kind: value.kind,
    words: value.words,
    ...(recordedAt !== undefined ? { recordedAt } : undefined),
    ...(isWireString(providerId) && isWireString(providerSessionId)
      ? { identity: { providerId, providerSessionId } }
      : undefined),
    ...(isWireString(value.requestId) ? { requestId: value.requestId } : undefined),
    ...(isWireString(value.eventId) ? { eventId: value.eventId } : undefined),
  };
}
