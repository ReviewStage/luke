import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_ENTRY_KIND,
  insertSpokenAskThreadEntry,
  maximumStoredConversationEntries,
  storedConversationMaximumAgeMs,
  withConversationEntryRequest,
} from "@sidecar/realtime";
import {
  conversationFromStored,
  conversationRecord,
  mergeConversationHistory,
  rememberedFactsFromStored,
  rememberedFactsRecord,
} from "./memory-flow";

const NOW = 1_800_000_000_000;

test("a stored thread reads back, and an unreadable file is a launch with nothing", () => {
  const entries = [
    { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "what is running", recordedAt: NOW },
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "two agents", recordedAt: NOW },
  ];
  assert.deepEqual(conversationFromStored(conversationRecord(entries, NOW), NOW), entries);
  assert.deepEqual(conversationFromStored("{not json", NOW), []);
  assert.deepEqual(conversationFromStored(undefined, NOW), []);
});

test("a line that does not parse drops itself rather than the thread", () => {
  const stored = JSON.stringify({
    entries: [
      { kind: "invented-kind", words: "no", recordedAt: NOW },
      { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "", recordedAt: NOW },
      { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "kept", recordedAt: NOW },
    ],
  });
  assert.deepEqual(conversationFromStored(stored, NOW), [
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "kept", recordedAt: NOW },
  ]);
});

test("retention cuts by age and by count, whichever bites first", () => {
  const old = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "old",
    recordedAt: NOW - storedConversationMaximumAgeMs - 1,
  };
  const fresh = { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "fresh", recordedAt: NOW };
  assert.deepEqual(conversationFromStored(conversationRecord([old, fresh], NOW), NOW), [fresh]);

  const many = Array.from({ length: maximumStoredConversationEntries + 10 }, (_, index) => ({
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: `line ${index}`,
    recordedAt: NOW,
  }));
  const kept = conversationFromStored(conversationRecord(many, NOW), NOW);
  assert.equal(kept.length, maximumStoredConversationEntries);
  assert.equal(kept.at(-1)?.words, `line ${many.length - 1}`);
});

test("window snapshots merge once and cannot restore a cleared thread", () => {
  const first = {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    words: "first window",
    recordedAt: NOW - 2,
  };
  const second = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "second window",
    recordedAt: NOW - 1,
  };
  const merged = mergeConversationHistory([first], [second], undefined, NOW);
  assert.deepEqual(merged, [first, second]);
  assert.deepEqual(mergeConversationHistory(merged, [second], undefined, NOW), merged);
  assert.deepEqual(mergeConversationHistory([], merged, NOW, NOW), []);
});

test("window snapshots keep matching words about different sessions", () => {
  const first = {
    kind: CONVERSATION_ENTRY_KIND.ACT,
    words: "sent a message.",
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
    recordedAt: NOW,
  };
  const second = {
    ...first,
    identity: { providerId: "codex", providerSessionId: "session-b" },
  };
  const merged = mergeConversationHistory([first], [second], undefined, NOW);

  assert.deepEqual(merged, [first, second]);
  assert.deepEqual(mergeConversationHistory(merged, [second], undefined, NOW), merged);
});

test("remembered entries read back and are never retired by a clock", () => {
  const facts = [
    {
      id: "one",
      words: "stop telling me about CI",
    },
  ];
  assert.deepEqual(rememberedFactsFromStored(rememberedFactsRecord(facts)), facts);
  assert.deepEqual(rememberedFactsFromStored(JSON.stringify({ facts: [{ id: "" }] })), []);
  assert.deepEqual(rememberedFactsFromStored(undefined), []);
});

test("stored memory drops noncanonical and duplicate entries", () => {
  const stored = JSON.stringify({
    facts: [
      { id: "one", words: "kept" },
      { id: "one", words: "duplicate id" },
      { id: "two", words: "kept" },
      { id: "three", words: "x".repeat(241) },
    ],
  });
  assert.deepEqual(rememberedFactsFromStored(stored), [{ id: "one", words: "kept" }]);
});

test("a spoken line tied to its run after it was relayed is enriched, not duplicated", () => {
  const now = 1_800_000_000_000;
  const spoken = insertSpokenAskThreadEntry([], "the exact spoken words", undefined, now);
  const [line] = spoken;
  assert.ok(line);
  let main = mergeConversationHistory([], spoken, undefined, now + 1);
  const tied = withConversationEntryRequest(spoken, line, "run-1");
  main = mergeConversationHistory(main, tied, undefined, now + 2);
  assert.equal(main.length, 1);
  assert.equal(main[0]?.requestId, "run-1");
  assert.equal(main[0]?.words, "the exact spoken words");
  // A stale window still reporting the uncorrelated copy neither doubles the
  // line nor takes the run back off it.
  main = mergeConversationHistory(main, spoken, undefined, now + 3);
  assert.equal(main.length, 1);
  assert.equal(main[0]?.requestId, "run-1");
  // Two utterances with the same words at different moments stay two lines.
  const again = insertSpokenAskThreadEntry(tied, "the exact spoken words", tied[0], now + 5);
  main = mergeConversationHistory(main, again, undefined, now + 6);
  assert.equal(main.length, 2);
});

test("a stored thread drops every line at or before the last Clear's cutoff", () => {
  const stored = JSON.stringify({
    entries: [
      { kind: "typed-ask", words: "before", recordedAt: 1_800_000_000_000 },
      { kind: "reply", words: "at the cutoff", recordedAt: 1_800_000_000_500 },
      { kind: "reply", words: "after", recordedAt: 1_800_000_000_501 },
    ],
  });
  const now = 1_800_000_001_000;
  assert.deepEqual(
    conversationFromStored(stored, now, 1_800_000_000_500).map((entry) => entry.words),
    ["after"],
  );
  assert.deepEqual(
    conversationFromStored(stored, now).map((entry) => entry.words),
    ["before", "at the cutoff", "after"],
  );
});
