import assert from "node:assert/strict";
import test from "node:test";
import { BrainMemory, pairedDanglingCalls } from "./brain-memory.js";
import { functionCallOutputItem, userMessageItem } from "./brain-openai.js";

const IDENTITY = { providerId: "claude-code", providerSessionId: "abc" };
const COMPACTION = { type: "compaction", id: "cmp_1", encrypted_content: "folded" };

test("items before the latest compaction item are dropped and the item itself stays", () => {
  const memory = new BrainMemory();
  memory.append([userMessageItem("one"), COMPACTION, userMessageItem("two")]);
  assert.equal(memory.dropBeforeLatestCompaction(), 1);
  assert.deepEqual(memory.items(), [COMPACTION, userMessageItem("two")]);
  assert.equal(memory.dropBeforeLatestCompaction(), 0);
  const later = { ...COMPACTION, id: "cmp_2" };
  memory.append([userMessageItem("three"), later]);
  assert.equal(memory.dropBeforeLatestCompaction(), 3);
  assert.deepEqual(memory.items(), [later]);
});

test("a mark rolls back items and cursors together, even across a compaction drop", () => {
  const memory = new BrainMemory();
  memory.append([userMessageItem("kept")]);
  memory.setCursor(IDENTITY, "10");
  const mark = memory.mark();
  memory.append([userMessageItem("doomed"), COMPACTION]);
  memory.setCursor(IDENTITY, "20");
  memory.dropBeforeLatestCompaction();
  memory.rollback(mark);
  assert.deepEqual(memory.items(), [userMessageItem("kept")]);
  assert.equal(memory.cursor(IDENTITY), "10");
});

test("the working copy round-trips through its persisted shape", () => {
  const memory = new BrainMemory();
  memory.append([COMPACTION, userMessageItem("after")]);
  memory.setCursor(IDENTITY, "42");
  const state = memory.persisted();
  assert.deepEqual(state.cursors, { "claude-code": { abc: "42" } });
  const restored = new BrainMemory(state);
  assert.equal(restored.cursor(IDENTITY), "42");
  assert.deepEqual(restored.items(), state.items);
});

test("a function_call with no output anywhere after it is paired, and a paired one left alone", () => {
  const call = (id: string) => ({ type: "function_call", call_id: id, name: "x", arguments: "{}" });
  const items = [call("a"), functionCallOutputItem("a", "done"), call("b"), userMessageItem("x")];
  const paired = pairedDanglingCalls(items, (callId) => `unknown:${callId}`);
  assert.deepEqual(paired.slice(0, 4), items);
  assert.deepEqual(paired[4], functionCallOutputItem("b", "unknown:b"));
  const settled = [call("a"), functionCallOutputItem("a", "done")];
  assert.equal(
    pairedDanglingCalls(settled, () => ""),
    settled,
  );
});

test("cursors of sessions the roster no longer holds are forgotten", () => {
  const memory = new BrainMemory();
  memory.setCursor(IDENTITY, "1");
  memory.setCursor({ providerId: "codex", providerSessionId: "gone" }, "2");
  memory.retainCursors([IDENTITY]);
  assert.equal(memory.cursor(IDENTITY), "1");
  assert.equal(memory.cursor({ providerId: "codex", providerSessionId: "gone" }), undefined);
  assert.deepEqual(memory.persisted().cursors, { "claude-code": { abc: "1" } });
});
