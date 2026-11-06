import type { ConversationEntry, ReviewThread } from "@repo/features/agent-wire";
import { Effect, Option, Schema } from "effect";
import { useCallback } from "react";
import { keptKey, useKept } from "../use-kept.js";

function keptOr<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  fallback: S["Type"] & S["Encoded"],
) {
  return schema.pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(fallback))),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );
}

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

type ConversationChoices = typeof conversationChoicesSchema.Type;

export type ConversationFilters = Pick<ConversationChoices, "hideBots" | "hideResolved">;

const KEPT = {
  CHOICES: keptKey("app.conversation-filters", Schema.fromJsonString(conversationChoicesSchema)),
} as const;

export interface ConversationHidden {
  readonly bots: number;
  readonly resolved: number;
}

function threadsOf(entry: ConversationEntry): readonly ReviewThread[] {
  return entry.threads ?? [];
}

export function conversationHidden(conversation: readonly ConversationEntry[]): ConversationHidden {
  let bots = 0;
  let resolved = 0;
  for (const entry of conversation) {
    if (entry.by.bot) bots += 1;
    resolved += threadsOf(entry).filter((thread) => thread.resolved).length;
  }
  return { bots, resolved };
}

const NONE_KEPT: ReadonlySet<string> = new Set();

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
    if (open.length === 0) return keptEntry ? [entry] : [];
    return open.length === threads.length ? [entry] : [{ ...entry, threads: open }];
  });
}

export interface ConversationFiltersControl {
  readonly filters: ConversationChoices;
  readonly change: (change: Partial<ConversationChoices>) => void;
}

export function useConversationFilters(): ConversationFiltersControl {
  const [filters, , changeChoices] = useKept<ConversationChoices>(KEPT.CHOICES, DEFAULT_CHOICES);
  const change = useCallback(
    (changed: Partial<ConversationChoices>) => changeChoices((held) => ({ ...held, ...changed })),
    [changeChoices],
  );
  return { filters, change };
}
