/**
 * conversation-filters.ts -- the Pull request tab's Conversation filters, Hide bots and Hide resolved: what each leaves out, how many it would, and the choice kept across launches.
 *
 * They are stage-cli's: Hide bots leaves out every comment and review an
 * App's bot wrote, a review's threads with it; Hide resolved leaves out
 * every resolved review thread, and a review whose every thread was
 * resolved goes with them, whatever else it says, as stage-cli drops one.
 * A comment is never resolved, so Hide resolved leaves every comment
 * standing. Each counts what it would leave out on its own, whether the
 * other is on or not: Hide bots the comments and reviews, Hide resolved
 * the threads.
 *
 * The choice is the window's own, as the sidebar's fold is
 * (`../desktop/sidebar-collapse.ts`): no other window draws a conversation
 * and main never reads it, so it is kept in the renderer's storage rather
 * than crossing to the settings file. One choice holds for every pull request,
 * both off until changed, and a change in one tab is drawn at once in every
 * other. Each is read on its own, so one that no longer reads leaves the
 * other as it was kept.
 */

import type { ConversationEntry, ReviewThread } from "@luke/features/coding-agent-wire";
import { Effect, Option, Schema } from "effect";
import { useSyncExternalStore } from "react";

/** The storage key the choice is kept under. */
const CONVERSATION_FILTERS_KEY = "luke.conversation-filters";

/** A kept filter read on its own: as kept where it reads, its default where it is missing or does not. */
function keptOr<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  fallback: S["Type"] & S["Encoded"],
) {
  return schema.pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(fallback))),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );
}

/** Both filters off, as the conversation draws until told otherwise. */
const DEFAULT_FILTERS = { hideBots: false, hideResolved: false } as const;

const conversationFiltersSchema = Schema.Struct({
  hideBots: keptOr(Schema.Boolean, DEFAULT_FILTERS.hideBots),
  hideResolved: keptOr(Schema.Boolean, DEFAULT_FILTERS.hideResolved),
});

export type ConversationFilters = typeof conversationFiltersSchema.Type;

const decodeFilters = Schema.decodeUnknownOption(Schema.fromJsonString(conversationFiltersSchema));

/** How many entries each filter would leave out of a conversation, each counted on its own. */
export interface ConversationHidden {
  /** The comments and reviews an App's bot wrote. */
  readonly bots: number;
  /** The resolved review threads, a bot's among them. */
  readonly resolved: number;
}

/** The kept text, none where nothing is kept or storage refuses the read. */
function readKept(): string | null {
  try {
    return window.localStorage.getItem(CONVERSATION_FILTERS_KEY);
  } catch {
    return null;
  }
}

/** The choice last read, with the text it was read from, so a snapshot is the same object until what is kept changes. */
let read: { readonly kept: string | null; readonly filters: ConversationFilters } | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The kept choice, each filter as kept where it reads and off otherwise. */
function snapshot(): ConversationFilters {
  const kept = readKept();
  if (read?.kept !== kept) {
    read = { kept, filters: Option.getOrElse(decodeFilters(kept), () => DEFAULT_FILTERS) };
  }
  return read.filters;
}

/** Changes one filter for every conversation, kept where storage takes it. */
function changeFilters(change: Partial<ConversationFilters>): void {
  const filters = { ...snapshot(), ...change };
  const kept = JSON.stringify(filters);
  try {
    window.localStorage.setItem(CONVERSATION_FILTERS_KEY, kept);
  } catch {
    // The choice holds for this window's life.
  }
  // Note that where storage refused the write, the text read back is what it already held, so the choice still stands until it changes.
  read = { kept: readKept(), filters };
  for (const listener of listeners) listener();
}

/** The threads a review started, none on a comment. */
function threadsOf(entry: ConversationEntry): readonly ReviewThread[] {
  return entry.threads ?? [];
}

/** How many entries each filter would leave out of the conversation given. */
export function conversationHidden(conversation: readonly ConversationEntry[]): ConversationHidden {
  let bots = 0;
  let resolved = 0;
  for (const entry of conversation) {
    if (entry.by.bot) bots += 1;
    resolved += threadsOf(entry).filter((thread) => thread.resolved).length;
  }
  return { bots, resolved };
}

/**
 * The conversation as the filters leave it: an entry left out whole, or a
 * review standing with only its threads still open. A thread a link or a
 * View in Conversation brought into view (`kept`, by its id) stands
 * whatever the filters say, with the review it is on.
 */
export function filteredConversation(
  conversation: readonly ConversationEntry[],
  filters: ConversationFilters,
  kept?: string | undefined,
): readonly ConversationEntry[] {
  const keeps = (thread: ReviewThread) => kept !== undefined && thread.id === kept;
  return conversation.flatMap((entry): ConversationEntry[] => {
    const threads = threadsOf(entry);
    if (filters.hideBots && entry.by.bot && !threads.some(keeps)) return [];
    if (!filters.hideResolved || threads.length === 0) return [entry];
    const open = threads.filter((thread) => !thread.resolved || keeps(thread));
    // Note that a review whose every thread was resolved goes with them, as stage-cli drops one.
    if (open.length === 0) return [];
    return open.length === threads.length ? [entry] : [{ ...entry, threads: open }];
  });
}

/** The Conversation's filters, and the door that changes them for every conversation. */
export interface ConversationFiltersControl {
  readonly filters: ConversationFilters;
  readonly change: (change: Partial<ConversationFilters>) => void;
}

export function useConversationFilters(): ConversationFiltersControl {
  const filters = useSyncExternalStore(subscribe, snapshot);
  return { filters, change: changeFilters };
}
