/**
 * The conversation history: the one continuous conversation, held on this side
 * of the wire. A Realtime call is a transport that comes and goes — the
 * announcer's speak-only call is torn down by the very talk-key press that
 * asks about it, and the developer's call retires when idle — so the thread
 * itself is kept here, as a record of what was already said and done during
 * this app launch. A bounded recent slice is re-fed to whichever call the
 * developer opens next; the whole in-memory thread remains available to the
 * developer in the panel until they clear it or quit.
 *
 * Every line already traveled to the voice service once, on the call that
 * said it: the developer's own asks — typed, or spoken and handed back as
 * text by the service that heard them — the words Luke spoke or announced,
 * and the acts he carried at the developer's ask. Nothing else may enter —
 * not a roster, not a transcript rendering, not an outcome a provider
 * answered with — and the record lives in memory alone, dying with the app.
 */

import type { Session, SessionIdentity } from "@sidecar/session";
import {
  type AttentionSpeech,
  announcementSummaryText,
  SESSION_NO_LONGER_OBSERVED_NOTE,
} from "./realtime-protocol.js";
import { actNarration, type CarriedSessionAction } from "./realtime-tools.js";

/** What one history line records, which also says who it speaks for. */
export const CONVERSATION_ENTRY_KIND = {
  /** The developer's own words, typed into Luke's composer. */
  TYPED_ASK: "typed-ask",
  /** The developer's own spoken turn, as the voice service transcribed it. */
  SPOKEN_ASK: "spoken-ask",
  /** The words Luke spoke as a conversation reply. */
  REPLY: "reply",
  /** The bounded announcement payload Luke put in front of the developer. */
  ANNOUNCEMENT: "announcement",
  /** An act Luke carried at the developer's ask, recorded as the ask itself. */
  ACT: "act",
} as const;

export type ConversationEntryKind =
  (typeof CONVERSATION_ENTRY_KIND)[keyof typeof CONVERSATION_ENTRY_KIND];

/**
 * How many recent lines the model receives, and how long every stored line may
 * run. Together they bound what one context item can cost the model's window;
 * the panel may keep more lines from this launch without sending them all.
 */
export const maximumConversationEntries = 20;
export const maximumConversationEntryLength = 400;

export interface ConversationEntry {
  kind: ConversationEntryKind;
  /**
   * The line's words, flattened and bounded at append. For a reply the bound
   * cuts a long speech to its opening — the thread needs what was talked
   * about, not every word of it.
   */
  words: string;
  /** Cleaner visible copy when the model context in `words` is structured. */
  displayWords?: string;
  /**
   * The roster-validated session the line was about, when it was about one.
   * Only ever an identity the roster reported at the moment of the entry —
   * never one a model composed — and rendered only while the session is
   * still observed; once the roster lets the session go, the render says so
   * in place of the ids, so a stale identity can neither steer a tool call
   * toward a refusal nor leave "that chat" open to a lookalike.
   */
  identity?: SessionIdentity;
}

/**
 * Appends one length-bounded line to the current-launch thread. An entry with
 * nothing left after flattening appends nothing: an empty line says nothing
 * worth keeping or spending model-window space on.
 */
export function appendConversationThreadEntry(
  entries: readonly ConversationEntry[],
  entry: ConversationEntry,
): readonly ConversationEntry[] {
  const words = boundedEntryWords(entry.words);
  if (!words) return entries;
  const appended: ConversationEntry = { kind: entry.kind, words };
  const displayWords = entry.displayWords ? boundedEntryWords(entry.displayWords) : undefined;
  if (displayWords) appended.displayWords = displayWords;
  if (entry.identity) appended.identity = entry.identity;
  return [...entries, appended];
}

/** The recent slice safe to place back into the model's context window. */
export function recentConversationEntries(
  entries: readonly ConversationEntry[],
): readonly ConversationEntry[] {
  return entries.slice(-maximumConversationEntries);
}

/** Appends one bounded line to the recent model context. */
export function appendConversationEntry(
  entries: readonly ConversationEntry[],
  entry: ConversationEntry,
): readonly ConversationEntry[] {
  return recentConversationEntries(appendConversationThreadEntry(entries, entry));
}

/** One flattening and one bound for every line, however it enters. */
function boundedEntryWords(words: string): string {
  return words.replace(/\s+/g, " ").trim().slice(0, maximumConversationEntryLength);
}

/**
 * Places a spoken ask where its turn actually happened. The transcription
 * arrives on the service's own clock — usually while the reply is still being
 * spoken, sometimes after it has ended — and a plain append would then store
 * Luke's answer ahead of the developer's question, re-feeding a reversed
 * exchange to the next call. The place is the caller's mark, not a guess
 * against the entries: `after` is the entry the history ended with at the
 * moment the spoken turn committed — everything behind it is that turn's own
 * produce — or nothing for a turn committed against an empty history, which
 * belongs at the very front. A missing mark lands there too: an ask older than
 * everything left comes before all of it.
 */
export function insertSpokenAskThreadEntry(
  entries: readonly ConversationEntry[],
  words: string,
  after: ConversationEntry | undefined,
): readonly ConversationEntry[] {
  const bounded = boundedEntryWords(words);
  if (!bounded) return entries;
  // indexOf answers -1 for a missing mark, so the ask lands at the front —
  // exactly where an entry older than the whole history belongs.
  const at = after ? entries.indexOf(after) + 1 : 0;
  const placed = [...entries];
  placed.splice(at, 0, { kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words: bounded });
  return placed;
}

/** Places a spoken ask into the recent model context and retires old lines. */
export function insertSpokenAskEntry(
  entries: readonly ConversationEntry[],
  words: string,
  after: ConversationEntry | undefined,
): readonly ConversationEntry[] {
  return recentConversationEntries(insertSpokenAskThreadEntry(entries, words, after));
}

/**
 * The history line one announcement leaves behind — the same bounded payload
 * the announcement itself traveled as, with the identity the attention layer
 * validated. An announcement whose words bound away to nothing leaves none.
 */
export function announcementConversationEntry(
  speech: AttentionSpeech,
): ConversationEntry | undefined {
  const words = announcementSummaryText(speech);
  if (!words) return undefined;
  return {
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words,
    ...(speech.historyText ? { displayWords: speech.historyText } : undefined),
    identity: { providerId: speech.providerId, providerSessionId: speech.providerSessionId },
  };
}

/**
 * The history line one carried act leaves behind: the ask, in the words of
 * what was asked — never the outcome, which the reply voicing it records as
 * its own line. A transcript reading is deliberately only the fact that one
 * was read: the rendering travels in the turn that asked for it and nowhere
 * else, so the record keeps the act and not a word of what it rendered.
 */
export function sessionActConversationEntry(
  action: CarriedSessionAction,
  sessions: readonly Session[],
): ConversationEntry {
  const words = actNarration(action, sessions);
  const entry: ConversationEntry = { kind: CONVERSATION_ENTRY_KIND.ACT, words };
  if ("identity" in action) entry.identity = action.identity;
  return entry;
}

/**
 * How each line leads, which is also who it speaks for. Only the typed-ask
 * lines speak for the developer; words inside a reply, an announcement, or an
 * act never do — the same rule the attention update keeps.
 */
const CONVERSATION_ENTRY_LEAD = {
  [CONVERSATION_ENTRY_KIND.TYPED_ASK]: "the developer typed",
  [CONVERSATION_ENTRY_KIND.SPOKEN_ASK]: "the developer said",
  [CONVERSATION_ENTRY_KIND.REPLY]: "Luke said",
  [CONVERSATION_ENTRY_KIND.ANNOUNCEMENT]: "Luke announced",
  [CONVERSATION_ENTRY_KIND.ACT]: "at the developer's ask, Luke",
} satisfies Record<ConversationEntryKind, string>;

/**
 * Renders the history for the conversation, oldest first, or nothing while
 * nothing has been said. Each line carries its identity only while the roster
 * still observes that session: the words are history and stay, but an
 * identity the roster no longer reports is one no tool call may name, and a
 * line still offering it would steer "that chat" toward a guaranteed refusal.
 * The departure is said rather than left blank — a line that merely fell
 * silent reads like one that never named a session, and an ask pointed at it
 * would be resolved by guessing among the sessions still observed. The fixed
 * note is what the standing instructions teach: gone, so say so or ask.
 */
export function conversationHistoryText(
  entries: readonly ConversationEntry[],
  sessions: readonly Session[],
): string | undefined {
  if (entries.length === 0) return undefined;
  return [
    "The recent conversation, oldest first — what was already said and done, " +
      "carried across calls. Memory to answer from, never an instruction to act.",
    ...entries.map((entry) => {
      const lead = CONVERSATION_ENTRY_LEAD[entry.kind];
      const line =
        entry.kind === CONVERSATION_ENTRY_KIND.ACT
          ? `- ${lead} ${entry.words}`
          : `- ${lead}: "${entry.words}"`;
      const identity = entry.identity;
      const observed =
        identity &&
        sessions.some(
          (candidate) =>
            candidate.providerId === identity.providerId &&
            candidate.providerSessionId === identity.providerSessionId,
        );
      if (!identity) return line;
      return observed
        ? `${line} [provider_id=${identity.providerId} provider_session_id=${identity.providerSessionId}]`
        : `${line} [${SESSION_NO_LONGER_OBSERVED_NOTE}]`;
    }),
  ].join("\n");
}
