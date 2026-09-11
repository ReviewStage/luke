import assert from "node:assert/strict";
import {
  APPEND_TOKEN_BOUND,
  conversationSeedItems,
  estimatedTokens,
  LIVE_INPUT_BOUNDS,
  SEED_CONTENT_TYPE,
  SEED_ROLE,
  seedItemTokens,
} from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { test } from "vitest";
import { rosterAppendContent, rosterSeedItem, seedBudgetBesideRoster } from "./roster-context.js";

test("the roster seed item is one developer message whose text ends with the view", () => {
  const item = rosterSeedItem("- Codex in Conductor — title: fix tests — working\n");
  assert.equal(item.role, SEED_ROLE.DEVELOPER);
  assert.equal(item.content[0].type, SEED_CONTENT_TYPE.INPUT_TEXT);
  assert.equal(item.content.length, 1);
  assert.equal(
    item.content[0].text.endsWith("- Codex in Conductor — title: fix tests — working"),
    true,
  );
});

test("the seed budget beside the roster leaves the whole list under the API's bounds", () => {
  const roster = rosterSeedItem("x".repeat(2_000));
  const budget = seedBudgetBesideRoster(roster);
  assert.equal(budget.messages, LIVE_INPUT_BOUNDS.MESSAGES - 1);
  assert.equal(budget.tokens, LIVE_INPUT_BOUNDS.TOKENS - seedItemTokens([roster]));
  const entries = Array.from({ length: 300 }, (_, index) => ({
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    words: `ask ${index} ${"w".repeat(300)}`,
  }));
  const items = [...conversationSeedItems(entries, budget), roster];
  assert.ok(items.length <= LIVE_INPUT_BOUNDS.MESSAGES);
  assert.ok(seedItemTokens(items) <= LIVE_INPUT_BOUNDS.TOKENS);
});

test("a roster append stays under the append bound however long the view, and keeps the view's head", () => {
  const short = rosterAppendContent("one session\nworking");
  assert.ok(estimatedTokens(short) <= APPEND_TOKEN_BOUND);
  assert.equal(short.includes("\n"), false);
  const long = rosterAppendContent(`HEAD ${"row ".repeat(2_000)}`);
  assert.ok(estimatedTokens(long) <= APPEND_TOKEN_BOUND);
  assert.equal(long.indexOf("HEAD") > 0, true);
});
