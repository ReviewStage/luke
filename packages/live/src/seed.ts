import { startupTokens } from "./tokens.js";

/**
 * What a session may be told as it opens: the startup `input`, which is where
 * the guide says to put context the model needs from the beginning, in the
 * shape and under the bounds the API takes.
 */

/** The roles `input` accepts. There is no `system`; trusted notes are a developer's. */
export const SEED_ROLE = {
  DEVELOPER: "developer",
  USER: "user",
  ASSISTANT: "assistant",
} as const;

type SeedRole = (typeof SEED_ROLE)[keyof typeof SEED_ROLE];

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

/** The application's own message in a session's history, which has no system role to carry one. */
export function developerSeedItem(text: string): InitialItem {
  return seedItem(SEED_ROLE.DEVELOPER, text);
}

/** The estimate the whole list is held under, counted over each message's text. */
export function seedItemTokens(items: readonly InitialItem[]): number {
  return items.reduce((total, item) => total + startupTokens(item.content[0].text), 0);
}

/**
 * A startup history held under the API's token bound by the side that pays
 * for it, rather than trusted to arrive there: the oldest of the
 * conversation's lines go first, and a developer message never does, since
 * the application's own notes are what the session opens on. Nothing is answered where the developer
 * messages alone are past the bound, which no conforming device sends.
 */
export function withinStartupBound(
  items: readonly InitialItem[],
): readonly InitialItem[] | undefined {
  const kept = [...items];
  while (seedItemTokens(kept) > LIVE_INPUT_BOUNDS.TOKENS) {
    const oldest = kept.findIndex((item) => item.role !== SEED_ROLE.DEVELOPER);
    if (oldest === -1) return undefined;
    kept.splice(oldest, 1);
  }
  return kept;
}
