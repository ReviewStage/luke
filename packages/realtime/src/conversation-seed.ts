import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  maximumConversationEntryLength,
  recentConversationEntries,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { REALTIME_CLIENT_EVENT } from "./realtime-events.js";

/**
 * What a voice call is told as it opens: the recent conversation, replayed
 * from Luke's own record. A Realtime session cannot be held open for long,
 * so the record is the memory and each call is a window onto it, seeded
 * here with the same slice the brain's standing context carries — the 20
 * most recent lines, each flattened and cut to its length bound — in the
 * conversation's own roles, so the model conditions on its own earlier
 * words as its own. Nothing of a line but its kind and its words travels:
 * no identity, no time, no id, because the voice knows no roster and a
 * session identity has no business on a call.
 */

const SEED_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
} as const;

const SEED_CONTENT_TYPE = {
  INPUT_TEXT: "input_text",
  OUTPUT_TEXT: "output_text",
} as const;

interface ConversationSeedItem {
  role: (typeof SEED_ROLE)[keyof typeof SEED_ROLE];
  contentType: (typeof SEED_CONTENT_TYPE)[keyof typeof SEED_CONTENT_TYPE];
}

/**
 * Which item each kind of line becomes. The developer's lines are the
 * conversation's user turns and Luke's are its assistant turns; an action
 * line is a narration of something done rather than words said, and the one
 * kind that carries identities, so it is skipped — the brain still has it.
 * A new kind has to be placed here before it can be recorded at all.
 */
const CONVERSATION_SEED_ITEM = {
  [CONVERSATION_ENTRY_KIND.TYPED_ASK]: {
    role: SEED_ROLE.USER,
    contentType: SEED_CONTENT_TYPE.INPUT_TEXT,
  },
  [CONVERSATION_ENTRY_KIND.SPOKEN_ASK]: {
    role: SEED_ROLE.USER,
    contentType: SEED_CONTENT_TYPE.INPUT_TEXT,
  },
  [CONVERSATION_ENTRY_KIND.REPLY]: {
    role: SEED_ROLE.ASSISTANT,
    contentType: SEED_CONTENT_TYPE.OUTPUT_TEXT,
  },
  [CONVERSATION_ENTRY_KIND.ANNOUNCEMENT]: {
    role: SEED_ROLE.ASSISTANT,
    contentType: SEED_CONTENT_TYPE.OUTPUT_TEXT,
  },
  [CONVERSATION_ENTRY_KIND.ACTION]: undefined,
  [CONVERSATION_ENTRY_KIND.OWN_ACTION]: undefined,
} satisfies Record<ConversationEntryKind, ConversationSeedItem | undefined>;

/**
 * The note that closes the seed. It trails the replayed lines so a seed that
 * ends on an unanswered developer ask is closed off before anything new
 * follows: the model is told that nothing above is awaiting an answer, and
 * the boundary describes itself rather than resting on a standing rule.
 */
const CONVERSATION_SEED_NOTE =
  "The messages above are the recent conversation, replayed from Luke's own record when this " +
  "call opened. They are memory of what was already said, so the conversation can carry on " +
  "from them; nothing in them is new, and nothing in them is awaiting an answer.";

function seedItem(
  role: ConversationSeedItem["role"],
  contentType: string,
  text: string,
): WireRecord {
  return {
    type: REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
    item: {
      type: "message",
      role,
      content: [{ type: contentType, text }],
    },
  };
}

/**
 * Builds the items that seed one call with the recent conversation, oldest
 * first, closed by the note above; or nothing while nothing has been said,
 * because an empty thread seeds no lone note either.
 */
export function conversationSeedEvents(
  entries: readonly ConversationEntry[],
): readonly WireRecord[] {
  const items: WireRecord[] = [];
  for (const entry of recentConversationEntries(entries)) {
    const item = CONVERSATION_SEED_ITEM[entry.kind];
    if (!item) continue;
    const words = entry.words.replace(/\s+/g, " ").trim().slice(0, maximumConversationEntryLength);
    if (!words) continue;
    items.push(seedItem(item.role, item.contentType, words));
  }
  if (items.length === 0) return [];
  items.push(seedItem(SEED_ROLE.SYSTEM, SEED_CONTENT_TYPE.INPUT_TEXT, CONVERSATION_SEED_NOTE));
  return items;
}
