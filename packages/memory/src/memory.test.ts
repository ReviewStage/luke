import assert from "node:assert/strict";
import { MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime/vocabulary";
import { test } from "vitest";
import { chunkMarkdown } from "./chunking.js";
import { MEMORY_ORIGIN, MEMORY_SOURCE, type MemoryProvenance } from "./contracts.js";
import { MEMORY_QUERY_MAXIMUM_CHARS, MEMORY_SEARCH_DEFAULTS } from "./defaults.js";
import { isMaintenanceEligibleConversation, isRecallEligibleConversation } from "./eligibility.js";
import {
  isAppendOnlyRewrite,
  isDailyNotePathForDay,
  MEMORY_FLUSH_DEFAULTS,
  memoryFlushPrompt,
  memoryFlushThreshold,
  shouldRunMemoryFlush,
} from "./flush.js";
import { appendNotebookEntry, parseNotebook, removeNotebookEntry } from "./notebook-markdown.js";
import {
  bm25RankToScore,
  buildFtsQuery,
  cosineSimilarity,
  datedNoteDay,
  decayedScore,
  defaultRankingOptions,
  isEvergreenMemoryPath,
  mergeHybridResults,
  mmrRerank,
  parseEmbedding,
  selectHybridSearchResults,
} from "./ranking.js";

const NOW = Date.UTC(2026, 8, 8);

const provenance = (path: string): MemoryProvenance => ({
  origin: MEMORY_ORIGIN.AGENT,
  path,
  indexedAt: NOW,
});

test("the pinned retrieval defaults match OpenClaw b7528507", () => {
  assert.deepEqual(
    [
      MEMORY_SEARCH_DEFAULTS.CHUNK_TOKENS,
      MEMORY_SEARCH_DEFAULTS.CHUNK_OVERLAP_TOKENS,
      MEMORY_SEARCH_DEFAULTS.WATCH_DEBOUNCE_MS,
      MEMORY_SEARCH_DEFAULTS.MAXIMUM_RESULTS,
      MEMORY_SEARCH_DEFAULTS.MINIMUM_SCORE,
      MEMORY_SEARCH_DEFAULTS.VECTOR_WEIGHT,
      MEMORY_SEARCH_DEFAULTS.TEXT_WEIGHT,
      MEMORY_SEARCH_DEFAULTS.CANDIDATE_MULTIPLIER,
      MEMORY_SEARCH_DEFAULTS.MMR_LAMBDA,
      MEMORY_SEARCH_DEFAULTS.TEMPORAL_DECAY_HALF_LIFE_DAYS,
      MEMORY_SEARCH_DEFAULTS.EMBEDDING_CACHE_MAXIMUM_ENTRIES,
    ],
    [400, 80, 1500, 6, 0.35, 0.7, 0.3, 4, 0.7, 30, 50_000],
  );
  assert.equal(MEMORY_QUERY_MAXIMUM_CHARS, 480);
});

test("chunking keeps whole lines within the budget, carries overlap, and numbers lines from one", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1} ${"x".repeat(60)}`);
  const chunks = chunkMarkdown(lines.join("\n"), { tokens: 100, overlap: 20 });
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0]?.startLine, 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 400 + 1);
    assert.ok(chunk.startLine <= chunk.endLine);
    assert.equal(chunk.hash.length, 64);
  }
  const [first, second] = chunks;
  assert.ok(first && second && second.startLine <= first.endLine, "overlap carries the tail");
  assert.equal(chunks[chunks.length - 1]?.endLine, 40);
});

test("a line wider than a chunk is cut into pieces that keep its number", () => {
  const chunks = chunkMarkdown("y".repeat(1_000), { tokens: 50, overlap: 0 });
  assert.ok(chunks.length >= 5);
  assert.ok(chunks.every((chunk) => chunk.startLine === 1 && chunk.endLine === 1));
});

test("the FTS query quotes every token and requires all of them", () => {
  assert.equal(
    buildFtsQuery('prefers "tabs" over spaces'),
    '"prefers" AND "tabs" AND "over" AND "spaces"',
  );
  assert.equal(buildFtsQuery("!!!"), undefined);
  assert.ok(bm25RankToScore(-3) > bm25RankToScore(-1));
  assert.equal(bm25RankToScore(Number.NaN), 1 / 1000);
});

test("dated notes decay with a thirty-day half-life while evergreen files do not", () => {
  assert.equal(datedNoteDay("memory/2026-08-09.md")?.toISOString(), "2026-08-09T00:00:00.000Z");
  assert.equal(datedNoteDay("memory/2026-13-01.md"), undefined);
  assert.equal(isEvergreenMemoryPath("USER.md"), true);
  assert.equal(isEvergreenMemoryPath("memory/topics.md"), true);
  assert.equal(isEvergreenMemoryPath("memory/2026-08-09.md"), false);
  assert.ok(Math.abs(decayedScore(1, 30, 30) - 0.5) < 1e-9);
  const options = defaultRankingOptions(NOW);
  const merged = mergeHybridResults(
    [],
    [
      {
        id: "a",
        path: "USER.md",
        startLine: 1,
        endLine: 1,
        snippet: "the developer prefers tabs",
        textScore: 0.9,
        provenance: provenance("USER.md"),
      },
      {
        id: "b",
        path: "memory/2026-06-10.md",
        startLine: 1,
        endLine: 1,
        snippet: "tabs were discussed at standup",
        textScore: 0.9,
        provenance: provenance("memory/2026-06-10.md"),
      },
    ],
    MEMORY_SOURCE.MEMORY,
    { ...options, mmr: { enabled: false, lambda: 0.7 } },
  );
  assert.equal(merged[0]?.path, "USER.md");
  assert.ok((merged[1]?.score ?? 1) < 0.3 * 0.9);
});

test("vector and keyword scores merge under the pinned weights and MMR diversifies", () => {
  const options = defaultRankingOptions(NOW);
  const merged = mergeHybridResults(
    [
      {
        id: "a",
        path: "MEMORY.md",
        startLine: 1,
        endLine: 2,
        snippet: "deploys go out on tuesdays",
        vectorScore: 0.8,
        provenance: provenance("MEMORY.md"),
      },
      {
        id: "b",
        path: "MEMORY.md",
        startLine: 3,
        endLine: 4,
        snippet: "deploys go out on tuesdays and thursdays",
        vectorScore: 0.6,
        provenance: provenance("MEMORY.md"),
      },
      {
        id: "c",
        path: "MEMORY.md",
        startLine: 5,
        endLine: 6,
        snippet: "the staging cluster lives in frankfurt",
        vectorScore: 0.59,
        provenance: provenance("MEMORY.md"),
      },
    ],
    [
      {
        id: "a",
        path: "MEMORY.md",
        startLine: 1,
        endLine: 2,
        snippet: "deploys go out on tuesdays",
        textScore: 0.5,
        provenance: provenance("MEMORY.md"),
      },
    ],
    MEMORY_SOURCE.MEMORY,
    options,
  );
  assert.equal(merged[0]?.startLine, 1);
  assert.ok(Math.abs((merged[0]?.score ?? 0) - (0.7 * 0.8 + 0.3 * 0.5)) < 1e-9);
  assert.equal(merged[1]?.startLine, 5, "MMR prefers the dissimilar chunk second");
  const window = selectHybridSearchResults({
    merged,
    keyword: [{ path: "MEMORY.md", startLine: 1, endLine: 2 }],
    maxResults: 6,
    minScore: 0.35,
  });
  assert.equal(window.length, 3);
});

test("the lexical fallback stands when nothing clears the threshold", () => {
  const merged = mergeHybridResults(
    [],
    [
      {
        id: "k",
        path: "USER.md",
        startLine: 4,
        endLine: 4,
        snippet: "likes espresso",
        textScore: 0.2,
        provenance: provenance("USER.md"),
      },
    ],
    MEMORY_SOURCE.MEMORY,
    defaultRankingOptions(NOW),
  );
  const window = selectHybridSearchResults({
    merged,
    keyword: [{ path: "USER.md", startLine: 4, endLine: 4 }],
    maxResults: 6,
    minScore: 0.35,
  });
  assert.equal(window.length, 1);
  assert.equal(
    selectHybridSearchResults({ merged, keyword: [], maxResults: 6, minScore: 0.35 }).length,
    0,
  );
});

test("MMR with lambda one is relevance order alone", () => {
  const ranked = mmrRerank(
    [
      { id: "1", score: 0.2, content: "a" },
      { id: "2", score: 0.9, content: "b" },
    ],
    1,
  );
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["2", "1"],
  );
});

test("vectors: cosine similarity and stored embeddings", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1], [1, 2]), 0);
  assert.deepEqual(parseEmbedding("[0.5,1]"), [0.5, 1]);
  assert.equal(parseEmbedding("[]"), undefined);
  assert.equal(parseEmbedding('["x"]'), undefined);
  assert.equal(parseEmbedding("not json"), undefined);
});

test("notebook entries are the bullets under the remembered heading and nothing else", () => {
  const seeded = "# USER.md\n\nStable facts.\n\n- a bullet in the prose\n";
  assert.deepEqual(parseNotebook(seeded).entries, []);
  const one = appendNotebookEntry(seeded, "prefers tabs");
  const two = appendNotebookEntry(one, "ships on tuesdays");
  assert.deepEqual(
    parseNotebook(two).entries.map((entry) => entry.words),
    ["prefers tabs", "ships on tuesdays"],
  );
  const closed = `${two}\n## Other\n\n- not an entry\n`;
  assert.equal(parseNotebook(closed).entries.length, 2);
  const removed = removeNotebookEntry(closed, "prefers tabs");
  assert.deepEqual(
    parseNotebook(removed).entries.map((entry) => entry.words),
    ["ships on tuesdays"],
  );
  assert.equal(removeNotebookEntry(removed, "never there"), removed);
});

test("search eligibility: main and private threads of the same agent, never the current, temporary, observed, or a child", () => {
  const current = { sessionKey: MAIN_SESSION_KEY, agentId: "main" };
  const thread = threadSessionKey("11111111-1111-1111-1111-111111111111");
  assert.equal(
    isRecallEligibleConversation(
      { sessionKey: thread, agentId: "main", temporary: false },
      current,
    ),
    true,
  );
  assert.equal(
    isRecallEligibleConversation({ sessionKey: thread, agentId: "main", temporary: true }, current),
    false,
  );
  assert.equal(
    isRecallEligibleConversation(
      { sessionKey: MAIN_SESSION_KEY, agentId: "main", temporary: false },
      current,
    ),
    false,
  );
  assert.equal(
    isRecallEligibleConversation(
      { sessionKey: thread, agentId: "other", temporary: false },
      current,
    ),
    false,
  );
  for (const key of [
    "agent:main:observed:claude/code:abc",
    "agent:main:subagent:child-1",
    "agent:main:cron:job",
    "agent:main:heartbeat:1",
    "something:else",
  ]) {
    // SAFETY: test keys are shaped by hand to exercise the classifier.
    const ineligibleKey = key as typeof MAIN_SESSION_KEY;
    assert.equal(
      isRecallEligibleConversation(
        { sessionKey: ineligibleKey, agentId: "main", temporary: false },
        current,
      ),
      false,
      key,
    );
    assert.equal(isMaintenanceEligibleConversation(ineligibleKey, false), false, key);
  }
  assert.equal(isMaintenanceEligibleConversation(MAIN_SESSION_KEY, false), true);
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
