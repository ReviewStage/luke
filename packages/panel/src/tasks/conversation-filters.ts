/**
 * conversation-filters.ts -- the Pull request tab's Conversation filters, Hide bots and Hide resolved: what each leaves out, how many it would, and the choice kept across launches, with which of the view's two sections stand folded.
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
 *
 * Whether the Description and the Conversation stand open is kept beside
 * them on the same terms: one choice for each section, never one for each
 * pull request, both open until folded, as the sidebar keeps a group's
 * fold for every task in it.
 */

import type { ConversationEntry, ReviewThread } from "@luke/features/coding-agent-wire";
import { Effect, Option, Schema } from "effect";
import { useCallback } from "react";
import { keptKey, useKept } from "../use-kept.js";

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

/** Both filters off and both sections open, as the conversation draws until told otherwise. */
const DEFAULT_CHOICES = {
  hideBots: false,
  hideResolved: false,
  descriptionOpen: true,
  conversationOpen: true,
} as const;

const conversationChoicesSchema = Schema.Struct({
  hideBots: keptOr(Schema.Boolean, DEFAULT_CHOICES.hideBots),
  hideResolved: keptOr(Schema.Boolean, DEFAULT_CHOICES.hideResolved),
  descriptionOpen: keptOr(Schema.Boolean, DEFAULT_CHOICES.descriptionOpen),
  conversationOpen: keptOr(Schema.Boolean, DEFAULT_CHOICES.conversationOpen),
});

/** The Conversation view's kept choices: its two filters, and whether each of its sections stands open. */
type ConversationChoices = typeof conversationChoicesSchema.Type;

/** What the filters leave out of a conversation. */
export type ConversationFilters = Pick<ConversationChoices, "hideBots" | "hideResolved">;

/** The choice, kept on this Mac under one key for every pull request. */
const KEPT = {
  CHOICES: keptKey("luke.conversation-filters", Schema.fromJsonString(conversationChoicesSchema)),
} as const;

/** How many entries each filter would leave out of a conversation, each counted on its own. */
export interface ConversationHidden {
  /** The comments and reviews an App's bot wrote. */
  readonly bots: number;
  /** The resolved review threads, a bot's among them. */
  readonly resolved: number;
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

/** Nothing brought into view, which the filters leave as they find it. */
const NONE_KEPT: ReadonlySet<string> = new Set();

/**
 * The conversation as the filters leave it: an entry left out whole, or a
 * review standing with only its threads still open. What a link or a View
 * in Conversation brought into view (`kept`: a thread by its id, an entry by
 * its page) stands whatever the filters say, a thread with the review it is
 * on.
 */
export function filteredConversation(
  conversation: readonly ConversationEntry[],
  filters: ConversationFilters,
  kept: ReadonlySet<string> = NONE_KEPT,
): readonly ConversationEntry[] {
  const keeps = (thread: ReviewThread) => thread.id !== undefined && kept.has(thread.id);
  return conversation.flatMap((entry): ConversationEntry[] => {
    const threads = threadsOf(entry);
    const keptEntry = kept.has(entry.url);
    if (filters.hideBots && entry.by.bot && !keptEntry && !threads.some(keeps)) return [];
    if (!filters.hideResolved || threads.length === 0) return [entry];
    const open = threads.filter((thread) => !thread.resolved || keeps(thread));
    // Note that a review whose every thread was resolved goes with them, as stage-cli drops one, unless it was brought into view.
    if (open.length === 0) return keptEntry ? [entry] : [];
    return open.length === threads.length ? [entry] : [{ ...entry, threads: open }];
  });
}

/** The Conversation's filters and sections' folds, and the door that changes them for every conversation. */
export interface ConversationFiltersControl {
  readonly filters: ConversationChoices;
  readonly change: (change: Partial<ConversationChoices>) => void;
}

export function useConversationFilters(): ConversationFiltersControl {
  const [filters, , changeChoices] = useKept<ConversationChoices>(KEPT.CHOICES, DEFAULT_CHOICES);
  // Note that a change is made over what is kept now, so every conversation's tab draws it at once, and a filter changed in one never undoes a section folded in another.
  const change = useCallback(
    (changed: Partial<ConversationChoices>) => changeChoices((held) => ({ ...held, ...changed })),
    [changeChoices],
  );
  return { filters, change };
}
