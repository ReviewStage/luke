import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  maximumConversationEntryLength,
  recentConversationEntries,
} from "@sidecar/session";
import { estimatedTokens } from "./tokens.js";

/**
 * What a session is told as it opens: the recent conversation, replayed from
 * Luke's own record into the session's startup `input`, which is where the
 * guide says to put context the model needs from the beginning. A session
 * closes whenever the desk is quiet, so the record is the memory and each
 * session is a window onto it, seeded with the same slice the brain's
 * standing context carries, in the conversation's own roles, so the model
 * conditions on its own earlier words as its own. Nothing of a line but its
 * kind and its words travels: no identity, no time, no id.
 */

/** The roles `input` accepts. There is no `system`; trusted notes are a developer's. */
export const SEED_ROLE = {
  DEVELOPER: "developer",
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export type SeedRole = (typeof SEED_ROLE)[keyof typeof SEED_ROLE];

export const SEED_CONTENT_TYPE = {
  INPUT_TEXT: "input_text",
  OUTPUT_TEXT: "output_text",
} as const;

export const SEED_ITEM_TYPE = "message";

/** One startup history message in the shape the API's `InitialItem` takes: one text part each. */
export type InitialItem =
  | {
      type: typeof SEED_ITEM_TYPE;
      role: typeof SEED_ROLE.DEVELOPER | typeof SEED_ROLE.USER;
      content: readonly [{ type: typeof SEED_CONTENT_TYPE.INPUT_TEXT; text: string }];
    }
  | {
      type: typeof SEED_ITEM_TYPE;
      role: typeof SEED_ROLE.ASSISTANT;
      content: readonly [{ type: typeof SEED_CONTENT_TYPE.OUTPUT_TEXT; text: string }];
    };

/** The API's bounds on `input`: messages, and tokens over the whole list. */
export const LIVE_INPUT_BOUNDS = {
  MESSAGES: 128,
  TOKENS: 8_192,
} as const;

export interface SeedBudget {
  messages: number;
  tokens: number;
}

/**
 * Which item each kind of line becomes. The developer's lines are the
 * conversation's user turns and Luke's are its assistant turns; an action
 * line narrates something done rather than words said, and is the one kind
 * that carries identities, so it is skipped: the brain still has it. A new
 * kind has to be placed here before it can be seeded at all.
 */
const SEED_ROLE_OF_KIND = {
  [CONVERSATION_ENTRY_KIND.ASK]: SEED_ROLE.USER,
  [CONVERSATION_ENTRY_KIND.REPLY]: SEED_ROLE.ASSISTANT,
  [CONVERSATION_ENTRY_KIND.ANNOUNCEMENT]: SEED_ROLE.ASSISTANT,
  [CONVERSATION_ENTRY_KIND.ACTION]: undefined,
  [CONVERSATION_ENTRY_KIND.OWN_ACTION]: undefined,
} satisfies Record<ConversationEntryKind, SeedRole | undefined>;

/**
 * The note that closes the seed, as a developer message because it is the
 * application's and `input` has no system role. It trails the replayed lines
 * so a seed that ends on an unanswered ask is closed off before anything new
 * follows: nothing above is new, and nothing above is awaiting an answer.
 */
const CONVERSATION_SEED_NOTE =
  "The messages above are the recent conversation, replayed from Luke's own record when this " +
  "session opened. They are memory of what was already said, so the conversation can carry on " +
  "from them; nothing in them is new, and nothing in them is awaiting an answer.";

function seedItem(role: SeedRole, text: string): InitialItem {
  if (role === SEED_ROLE.ASSISTANT) {
    return {
      type: SEED_ITEM_TYPE,
      role,
      content: [{ type: SEED_CONTENT_TYPE.OUTPUT_TEXT, text }],
    };
  }
  return { type: SEED_ITEM_TYPE, role, content: [{ type: SEED_CONTENT_TYPE.INPUT_TEXT, text }] };
}

/** The application's own message in a session's history: the seed's closing note, or a caller's roster view. */
export function developerSeedItem(text: string): InitialItem {
  return seedItem(SEED_ROLE.DEVELOPER, text);
}

/** The estimate the whole list is held under, counted over each message's text. */
export function seedItemTokens(items: readonly InitialItem[]): number {
  return items.reduce((total, item) => total + estimatedTokens(item.content[0].text), 0);
}

/**
 * The oldest lines go first when the list would not fit: a seed is memory of
 * what was just said, and the newest of it is what a follow-up needs.
 */
function withinBudget(items: readonly InitialItem[], budget: SeedBudget): readonly InitialItem[] {
  let kept = items.slice(Math.max(0, items.length - budget.messages));
  while (kept.length > 0 && seedItemTokens(kept) > budget.tokens) {
    kept = kept.slice(1);
  }
  return kept;
}

/**
 * Builds the items that seed one session with the recent conversation,
 * oldest first, closed by the note above, held under the budget by dropping
 * the oldest lines first; or nothing while nothing has been said, because an
 * empty thread seeds no lone note either. A caller that puts its own
 * developer message beside the seed passes the budget that message leaves.
 */
export function conversationSeedItems(
  entries: readonly ConversationEntry[],
  budget: SeedBudget = { messages: LIVE_INPUT_BOUNDS.MESSAGES, tokens: LIVE_INPUT_BOUNDS.TOKENS },
): readonly InitialItem[] {
  const items: InitialItem[] = [];
  for (const entry of recentConversationEntries(entries)) {
    const role = SEED_ROLE_OF_KIND[entry.kind];
    if (!role) continue;
    const words = entry.words.replace(/\s+/g, " ").trim().slice(0, maximumConversationEntryLength);
    if (!words) continue;
    items.push(seedItem(role, words));
  }
  if (items.length === 0) return [];
  const note = developerSeedItem(CONVERSATION_SEED_NOTE);
  const noteTokens = seedItemTokens([note]);
  if (budget.messages < 2 || budget.tokens <= noteTokens) return [];
  const lines = withinBudget(items, {
    messages: budget.messages - 1,
    tokens: budget.tokens - noteTokens,
  });
  if (lines.length === 0) return [];
  return [...lines, note];
}
