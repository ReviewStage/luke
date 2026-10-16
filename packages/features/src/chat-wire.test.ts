import assert from "node:assert/strict";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result, type Schema } from "effect";
import { test } from "vitest";
import {
  CHAT_ASK,
  CHAT_BOUNDS,
  chatChannelNameSchema,
  chatHandleSchema,
  chatTargetSchema,
  mentionedHandles,
  postChatAskInputSchema,
  postChatInputSchema,
} from "./chat-wire.js";

/** Whether the schema takes the value as the wire hands it in. */
function takes(schema: Schema.Codec<unknown, unknown>, value: WireBoundaryInput): boolean {
  return Result.isSuccess(readEither(schema)(unparsedWire(value)));
}

test("a handle is a slug opening on a letter, bounded; anything else is refused", () => {
  for (const handle of ["luke", "agent-12", "charles-2", "a"]) {
    assert.equal(takes(chatHandleSchema, handle), true, handle);
  }
  for (const handle of [
    "",
    "2fast",
    "-agent",
    "Agent",
    "agent_1",
    "agent.1",
    "@luke",
    "a b",
    "a".repeat(CHAT_BOUNDS.MAX_HANDLE_CHARS + 1),
  ]) {
    assert.equal(takes(chatHandleSchema, handle), false, handle);
  }
});

test("a channel's name is the inbox key's slug, bounded; a sigil, a capital, or a space is refused", () => {
  for (const name of ["general", "billing-export", "v2.api", "2026-plan", "a_b"]) {
    assert.equal(takes(chatChannelNameSchema, name), true, name);
  }
  for (const name of [
    "",
    "#general",
    "General",
    "-lead",
    "two words",
    "x".repeat(CHAT_BOUNDS.MAX_KEY_CHARS + 1),
  ]) {
    assert.equal(takes(chatChannelNameSchema, name), false, name);
  }
});

test("a post goes to `#name` or `@handle` alone, and refuses a key it does not name", () => {
  assert.equal(takes(chatTargetSchema, "#billing-export"), true);
  assert.equal(takes(chatTargetSchema, "@agent-2"), true);
  assert.equal(takes(chatTargetSchema, `@${"a".repeat(CHAT_BOUNDS.MAX_HANDLE_CHARS)}`), true);
  assert.equal(takes(chatTargetSchema, `@${"a".repeat(CHAT_BOUNDS.MAX_HANDLE_CHARS + 1)}`), false);
  assert.equal(takes(chatTargetSchema, `#${"a".repeat(CHAT_BOUNDS.MAX_KEY_CHARS)}`), true);
  assert.equal(takes(chatTargetSchema, `#${"a".repeat(CHAT_BOUNDS.MAX_KEY_CHARS + 1)}`), false);
  for (const to of ["billing-export", "@2", "#", "@", "#Billing", "@agent 2", "#a #b"]) {
    assert.equal(takes(chatTargetSchema, to), false, to);
  }
  assert.equal(takes(postChatInputSchema, { text: "Taking the table.", to: "#general" }), true);
  assert.equal(takes(postChatInputSchema, { text: "" }), false);
  assert.equal(
    takes(postChatInputSchema, { text: "x".repeat(CHAT_BOUNDS.MAX_TEXT_CHARS + 1) }),
    false,
  );
  assert.equal(
    takes(postChatInputSchema, { text: "Which?", ask: { response: { type: CHAT_ASK.TEXT } } }),
    false,
  );
  assert.equal(
    takes(postChatAskInputSchema, {
      text: "Which?",
      key: "table-owner",
      ask: { response: { type: CHAT_ASK.TEXT } },
    }),
    true,
  );
  assert.equal(
    takes(postChatAskInputSchema, { text: "Which?", ask: { response: { type: CHAT_ASK.TEXT } } }),
    false,
  );
  assert.equal(takes(postChatAskInputSchema, { text: "Plain, no key." }), true);
});

test("the handles a post mentions are each named once, in order, and an address or a glued @ is none", () => {
  assert.deepEqual(
    mentionedHandles("@agent-2 and @luke: see @agent-2's note; mail me@example.com or a@@b"),
    ["agent-2", "luke"],
  );
  assert.deepEqual(mentionedHandles("(@charles) done."), ["charles"]);
  assert.deepEqual(mentionedHandles("@luke: yes, and @agent-2's too"), ["luke", "agent-2"]);
  assert.deepEqual(mentionedHandles("ask @agent_2 or @Luke or @team.lead or @x@y"), []);
  assert.deepEqual(mentionedHandles("nobody here"), []);
});
