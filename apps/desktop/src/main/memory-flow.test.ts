import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_ENTRY_KIND,
  maximumStoredConversationEntries,
  storedConversationMaximumAgeMs,
} from "@sidecar/realtime";
import {
  conversationFromStored,
  conversationRecord,
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
