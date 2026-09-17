import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  joinReplyMessages,
  maximumConversationEntries,
  maximumConversationEntryLength,
  recentConversationEntries,
  storedConversationEntry,
  streamingConversationEntry,
} from "./conversation.js";

const NOW = 1_800_000_000_000;

test("a streaming line is normalized like the settled line it previews", () => {
  const line = streamingConversationEntry(
    CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    `  Checkout\r\n\r\nfinished ${"x".repeat(2 * maximumConversationEntryLength)}  `,
  );
  // The words are trimmed and their line endings made uniform; nothing is
  // cut, and the line structure between the words stands.
  assert.equal(
    line?.words,
    `Checkout\n\nfinished ${"x".repeat(2 * maximumConversationEntryLength)}`,
  );
  // A line still growing has not happened yet: it carries no clock.
  assert.equal(line?.recordedAt, undefined);

  // Words that trim to nothing preview nothing.
  assert.equal(streamingConversationEntry(CONVERSATION_ENTRY_KIND.REPLY, "   "), undefined);
});

test("the recent slice is the newest lines up to the seed's bound, oldest first", () => {
  const entries: ConversationEntry[] = Array.from(
    { length: maximumConversationEntries + 3 },
    (_, index) => ({ kind: CONVERSATION_ENTRY_KIND.ASK, words: `ask ${index}` }),
  );
  const recent = recentConversationEntries(entries);
  assert.equal(recent.length, maximumConversationEntries);
  assert.equal(recent[0]?.words, "ask 3");
  assert.equal(recent.at(-1)?.words, `ask ${maximumConversationEntries + 2}`);
  assert.deepEqual(recentConversationEntries(entries.slice(0, 2)), entries.slice(0, 2));
});

test("a reply said as several messages is joined whole, in order, each its own paragraph", () => {
  assert.equal(
    joinReplyMessages(["Two agents are working. ", "", "  One needs you."]),
    "Two agents are working.\n\nOne needs you.",
  );
  assert.equal(joinReplyMessages(["   ", ""]), "");
  assert.equal(joinReplyMessages([]), "");
});

test("a settled line reads back under the strict read, and a malformed one drops rather than repairs", () => {
  const line = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "two agents are working",
    recordedAt: NOW,
  };
  assert.deepEqual(storedConversationEntry(JSON.parse(JSON.stringify(line))), line);
  assert.equal(
    storedConversationEntry({ kind: "invented", words: "no", recordedAt: NOW }),
    undefined,
  );
  assert.equal(
    storedConversationEntry({ kind: CONVERSATION_ENTRY_KIND.REPLY, words: line.words }),
    undefined,
  );
  assert.equal(storedConversationEntry({ ...line, words: " two agents " }), undefined);
  assert.equal(
    storedConversationEntry({ ...line, identity: { providerId: "claude-code" } }),
    undefined,
  );
  // Fields an older build carried beside the words are left unread, not refused.
  assert.deepEqual(
    storedConversationEntry({
      ...line,
      mentions: [{ providerId: "claude-code", providerSessionId: "a", title: "checkout" }],
    }),
    line,
  );
  // Every optional field survives the read when it is well-formed.
  const full = {
    ...line,
    eventId: "line-1",
    requestId: "run-1",
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
  };
  assert.deepEqual(storedConversationEntry(JSON.parse(JSON.stringify(full))), full);
});

test("the unstrict read takes what the strict one refuses, and nothing wider", () => {
  const line = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: " two agents ",
    recordedAt: NOW,
  };

  // The three refusals that are the whole of the difference: unnormalized
  // words, no clock, and an empty identity field. A line another process of
  // the same build just handed over is taken as it was sent.
  assert.deepEqual(storedConversationEntry(line, { strict: false }), line);
  assert.equal(storedConversationEntry(line), undefined);

  const unclocked = { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "settled" };
  assert.deepEqual(storedConversationEntry(unclocked, { strict: false }), unclocked);
  assert.equal(storedConversationEntry(unclocked), undefined);

  const blankIdentity = { ...unclocked, identity: { providerId: "", providerSessionId: "" } };
  assert.deepEqual(storedConversationEntry(blankIdentity, { strict: false }), blankIdentity);
  assert.equal(
    storedConversationEntry({ ...blankIdentity, recordedAt: line.recordedAt }),
    undefined,
  );

  // Neither read repairs a kind this build does not know, or words that are
  // not words at all: those refusals are the parse itself, not its strictness.
  for (const strict of [true, false]) {
    assert.equal(
      storedConversationEntry({ ...unclocked, kind: "invented" }, { strict }),
      undefined,
    );
    assert.equal(storedConversationEntry({ ...unclocked, words: 7 }, { strict }), undefined);
  }
});
