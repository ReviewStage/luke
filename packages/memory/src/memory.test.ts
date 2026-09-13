import assert from "node:assert/strict";
import { MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime/vocabulary";
import { test } from "vitest";
import { isMaintenanceEligibleConversation } from "./eligibility.js";
import {
  isAppendOnlyRewrite,
  isDailyNotePathForDay,
  MEMORY_FLUSH_DEFAULTS,
  memoryFlushPrompt,
  memoryFlushThreshold,
  shouldRunMemoryFlush,
} from "./flush.js";

test("maintenance eligibility: main and a durable private thread, never a temporary thread, an observed session, a child, or a cron conversation", () => {
  const thread = threadSessionKey("11111111-1111-1111-1111-111111111111");
  assert.equal(isMaintenanceEligibleConversation(MAIN_SESSION_KEY, false), true);
  assert.equal(isMaintenanceEligibleConversation(thread, false), true);
  assert.equal(isMaintenanceEligibleConversation(thread, true), false);
  for (const key of [
    "agent:main:observed:claude/code:abc",
    "agent:main:subagent:child-1",
    "agent:main:cron:job",
    "agent:main:heartbeat:1",
    "something:else",
  ]) {
    // SAFETY: test keys are shaped by hand to exercise the classifier.
    const ineligibleKey = key as typeof MAIN_SESSION_KEY;
    assert.equal(isMaintenanceEligibleConversation(ineligibleKey, false), false, key);
  }
});
test("the pinned flush defaults match OpenClaw b7528507", () => {
  assert.deepEqual(
    [
      MEMORY_FLUSH_DEFAULTS.SOFT_THRESHOLD_TOKENS,
      MEMORY_FLUSH_DEFAULTS.FORCE_TRANSCRIPT_BYTES,
      MEMORY_FLUSH_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
    ],
    [4_000, 2 * 1024 * 1024, 2_000],
  );
});

test("the flush fires a soft margin under the compaction threshold, on the byte trigger, and once per cycle", () => {
  assert.equal(memoryFlushThreshold(400_000, 20_000), 376_000);
  assert.equal(memoryFlushThreshold(10_000, 2_500), 7_500 - 3_750);
  const base = {
    contextWindowTokens: 400_000,
    reserveTokens: 20_000,
    transcriptBytes: 1_000,
    compactionCount: 0,
  };
  assert.equal(shouldRunMemoryFlush({ ...base, contextTokens: 375_999 }), false);
  assert.equal(shouldRunMemoryFlush({ ...base, contextTokens: 376_000 }), true);
  assert.equal(
    shouldRunMemoryFlush({ ...base, contextTokens: 376_000, lastFlushCompactionCount: 0 }),
    false,
    "flushed already in this cycle",
  );
  assert.equal(
    shouldRunMemoryFlush({
      ...base,
      contextTokens: 376_000,
      compactionCount: 1,
      lastFlushCompactionCount: 0,
    }),
    true,
    "a new cycle flushes again",
  );
  assert.equal(
    shouldRunMemoryFlush({ ...base, contextTokens: 100, transcriptBytes: 2 * 1024 * 1024 }),
    true,
    "the byte trigger flushes whatever the count",
  );
});

test("a housekeeping write is bounded to today's note and to appending", () => {
  assert.equal(isDailyNotePathForDay("memory/2026-09-08.md", "2026-09-08"), true);
  assert.equal(isDailyNotePathForDay("memory/2026-09-08-standup.md", "2026-09-08"), true);
  assert.equal(isDailyNotePathForDay("memory/2026-09-07.md", "2026-09-08"), false);
  assert.equal(isDailyNotePathForDay("MEMORY.md", "2026-09-08"), false);
  assert.equal(isAppendOnlyRewrite("", "- new\n"), true);
  assert.equal(isAppendOnlyRewrite("- old\n", "- old\n- new\n"), true);
  assert.equal(isAppendOnlyRewrite("- old", "- old\n- new\n"), true);
  assert.equal(isAppendOnlyRewrite("- old\n", "- new\n"), false);
  assert.equal(isAppendOnlyRewrite("- old\n", "- ol"), false);
  const prompt = memoryFlushPrompt("2026-09-08");
  assert.equal(prompt.notePath, "memory/2026-09-08.md");
});
