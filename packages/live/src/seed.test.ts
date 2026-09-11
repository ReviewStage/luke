import assert from "node:assert/strict";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  maximumConversationEntries,
  maximumConversationEntryLength,
} from "@sidecar/session";
import { test } from "vitest";
import {
  conversationSeedItems,
  LIVE_INPUT_BOUNDS,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
  type SeedRole,
  seedItemTokens,
} from "./seed.js";

const IDENTITY = { providerId: "claude-code", providerSessionId: "session-7f3a" } as const;

function line(kind: ConversationEntryKind, words: string, index = 0): ConversationEntry {
  return {
    kind,
    words,
    eventId: `event-${index}`,
    recordedAt: 1_800_000_000_000 + index,
    requestId: `request-${index}`,
    ...(kind === CONVERSATION_ENTRY_KIND.ACTION || kind === CONVERSATION_ENTRY_KIND.OWN_ACTION
      ? { identity: IDENTITY }
      : undefined),
  };
}

test("each line becomes one message in its own role and content type, and the seed carries nothing else", () => {
  const items = conversationSeedItems([
    line(CONVERSATION_ENTRY_KIND.ASK, "what needs me?", 1),
    line(CONVERSATION_ENTRY_KIND.REPLY, "Nothing yet.", 2),
    line(CONVERSATION_ENTRY_KIND.ASK, "and now?", 3),
    line(CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, "Codex finished.", 4),
  ]);

  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((item) => [item.type, item.role, item.content[0].type]),
    [
      [SEED_ITEM_TYPE, SEED_ROLE.USER, SEED_CONTENT_TYPE.INPUT_TEXT],
      [SEED_ITEM_TYPE, SEED_ROLE.ASSISTANT, SEED_CONTENT_TYPE.OUTPUT_TEXT],
      [SEED_ITEM_TYPE, SEED_ROLE.USER, SEED_CONTENT_TYPE.INPUT_TEXT],
      [SEED_ITEM_TYPE, SEED_ROLE.ASSISTANT, SEED_CONTENT_TYPE.OUTPUT_TEXT],
    ],
  );
  assert.deepEqual(
    items.map((item) => item.content[0].text),
    ["what needs me?", "Nothing yet.", "and now?", "Codex finished."],
  );
  for (const item of items) assert.equal(item.content.length, 1);
});

test("no message is the application's own: a seed is the conversation's two voices and nothing addressed to the model", () => {
  const items = conversationSeedItems([
    line(CONVERSATION_ENTRY_KIND.ASK, "what needs me?", 1),
    line(CONVERSATION_ENTRY_KIND.REPLY, "Nothing yet.", 2),
  ]);
  const spoken: readonly SeedRole[] = [SEED_ROLE.USER, SEED_ROLE.ASSISTANT];

  for (const item of items) assert.equal(spoken.includes(item.role), true);
});

test("no message carries a system role, an identity, a time, or an id", () => {
  const items = conversationSeedItems([line(CONVERSATION_ENTRY_KIND.ASK, "hello", 1)]);
  const roles: readonly string[] = Object.values(SEED_ROLE);

  assert.equal(roles.includes("system"), false);
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ["content", "role", "type"]);
    assert.ok(roles.includes(item.role));
  }
});

test("action lines are skipped, and an empty thread seeds nothing", () => {
  assert.deepEqual(conversationSeedItems([]), []);
  assert.deepEqual(
    conversationSeedItems([
      line(CONVERSATION_ENTRY_KIND.ACTION, "sent a message", 1),
      line(CONVERSATION_ENTRY_KIND.OWN_ACTION, "opened a session", 2),
      line(CONVERSATION_ENTRY_KIND.REPLY, "   ", 3),
    ]),
    [],
  );
});

test("words are flattened and cut to the render bound, as the brain's context is", () => {
  const items = conversationSeedItems([
    line(
      CONVERSATION_ENTRY_KIND.REPLY,
      `first\n\nsecond ${"x".repeat(2 * maximumConversationEntryLength)}`,
    ),
  ]);

  const text = items[0]?.content[0].text ?? "";
  assert.equal(text.length, maximumConversationEntryLength);
  assert.equal(text.includes("\n"), false);
});

test("only the recent slice is seeded, and it stays under the API's message bound", () => {
  const entries = Array.from({ length: maximumConversationEntries * 3 }, (_, index) =>
    line(CONVERSATION_ENTRY_KIND.ASK, `ask ${index}`, index),
  );
  const items = conversationSeedItems(entries);

  assert.equal(items.length, maximumConversationEntries);
  assert.ok(items.length <= LIVE_INPUT_BOUNDS.MESSAGES);
  assert.equal(items[0]?.content[0].text, `ask ${entries.length - maximumConversationEntries}`);
});

test("the oldest lines go first when the token budget would not hold them all", () => {
  const long = "y".repeat(maximumConversationEntryLength);
  const entries = Array.from({ length: 10 }, (_, index) =>
    line(CONVERSATION_ENTRY_KIND.REPLY, `${index} ${long}`, index),
  );
  const budget = { messages: LIVE_INPUT_BOUNDS.MESSAGES, tokens: 400 };
  const items = conversationSeedItems(entries, budget);

  assert.ok(items.length < entries.length);
  assert.ok(seedItemTokens(items) <= budget.tokens);
  assert.equal(items.at(-1)?.content[0].text, `9 ${long}`.slice(0, maximumConversationEntryLength));
});

test("a message budget cuts the oldest first", () => {
  const entries = Array.from({ length: 6 }, (_, index) =>
    line(CONVERSATION_ENTRY_KIND.ASK, `ask ${index}`, index),
  );
  const items = conversationSeedItems(entries, { messages: 3, tokens: LIVE_INPUT_BOUNDS.TOKENS });

  assert.deepEqual(
    items.map((item) => item.content[0].text),
    ["ask 3", "ask 4", "ask 5"],
  );
});

test("a budget too small for one line seeds nothing", () => {
  const entries = [line(CONVERSATION_ENTRY_KIND.ASK, "hello", 1)];

  assert.deepEqual(conversationSeedItems(entries, { messages: 0, tokens: 10 }), []);
  assert.deepEqual(conversationSeedItems(entries, { messages: 128, tokens: 0 }), []);
});
