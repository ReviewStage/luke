import assert from "node:assert/strict";
import { test } from "vitest";
import { hostedConversationAnswerSchema } from "./conversation-wire.js";

test("a conversation answer keeps only attributed, non-empty messages", () => {
  const answer = hostedConversationAnswerSchema.parse(
    JSON.parse(
      JSON.stringify({
        messages: [
          {
            id: "message-1",
            author: "user",
            text: "Fix the roster test",
            receivedAt: 1_800_000_000_000,
          },
          { id: "message-2", author: "agent", text: "  spaced words hold their shape  " },
          { id: "message-3", author: "tool", text: "not a voice a bubble draws" },
          { id: "message-4", author: "agent", text: "" },
          { id: "", author: "agent", text: "no id" },
          { id: "message-5", author: "agent" },
          null,
        ],
        lastMessageId: "message-9",
        hasMore: true,
      }),
    ),
  );
  assert.ok(answer);
  assert.deepEqual(answer.messages, [
    {
      id: "message-1",
      author: "user",
      text: "Fix the roster test",
      receivedAt: 1_800_000_000_000,
    },
    // The words travel exactly as written: the wire reader never trims them.
    { id: "message-2", author: "agent", text: "  spaced words hold their shape  " },
  ]);
  assert.equal(answer.lastMessageId, "message-9");
  assert.equal(answer.hasMore, true);
});

test("a conversation answer without its envelope is no answer at all", () => {
  assert.equal(hostedConversationAnswerSchema.parse(undefined), undefined);
  assert.equal(hostedConversationAnswerSchema.parse("messages"), undefined);
  assert.equal(
    hostedConversationAnswerSchema.parse(JSON.parse(JSON.stringify({ messages: [] }))),
    undefined,
  );
  assert.equal(
    hostedConversationAnswerSchema.parse(
      JSON.parse(JSON.stringify({ messages: "none", hasMore: false })),
    ),
    undefined,
  );
  const empty = hostedConversationAnswerSchema.parse(
    JSON.parse(JSON.stringify({ messages: [], hasMore: false })),
  );
  assert.ok(empty);
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.lastMessageId, undefined);
  assert.equal(empty.hasMore, false);
});

test("a conversation answer carries its history positions when the read reported them", () => {
  const answer = hostedConversationAnswerSchema.parse(
    JSON.parse(
      JSON.stringify({
        messages: [],
        hasMore: false,
        firstOffset: 240,
        hasOlder: true,
      }),
    ),
  );
  assert.ok(answer);
  assert.equal(answer.firstOffset, 240);
  assert.equal(answer.hasOlder, true);

  const malformed = hostedConversationAnswerSchema.parse(
    JSON.parse(
      JSON.stringify({
        messages: [],
        hasMore: true,
        firstOffset: -3,
        hasOlder: "yes",
      }),
    ),
  );
  assert.ok(malformed);
  // Positions that are not what a read reports are dropped, not repaired.
  assert.equal(malformed.firstOffset, undefined);
  assert.equal(malformed.hasOlder, undefined);
});
