import assert from "node:assert/strict";
import test from "node:test";
import { MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime-contracts";
import { chunkMarkdown } from "./chunking.js";
import { MEMORY_ORIGIN, MEMORY_SOURCE, type MemoryProvenance } from "./contracts.js";
import { MEMORY_SEARCH_DEFAULTS, RECALL_DEFAULTS } from "./defaults.js";
import {
  appendNotebookEntry,
  parseNotebook,
  REMEMBERED_HEADING,
  removeNotebookEntry,
} from "./notebook-markdown.js";
import {
  bm25RankToScore,
  buildFtsQuery,
  datedNoteDay,
  decayedScore,
  defaultRankingOptions,
  isEvergreenMemoryPath,
  mergeHybridResults,
  mmrRerank,
  selectHybridSearchResults,
} from "./ranking.js";
import {
  boundRecentTurns,
  ConversationRecall,
  conversationRunsRecall,
  hasRecallIntent,
  isRecallEligibleConversation,
  RECALL_DECISION,
  RECALL_STATUS,
  summarizeRecallReply,
} from "./recall.js";
import { cosineSimilarity, parseEmbedding } from "./vectors.js";

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
  assert.deepEqual(
    [
      RECALL_DEFAULTS.TIMEOUT_MS,
      RECALL_DEFAULTS.MAXIMUM_SUMMARY_CHARS,
      RECALL_DEFAULTS.RECENT_USER_TURNS,
      RECALL_DEFAULTS.RECENT_ASSISTANT_TURNS,
      RECALL_DEFAULTS.CACHE_TTL_MS,
      RECALL_DEFAULTS.CIRCUIT_BREAKER_MAXIMUM_TIMEOUTS,
      RECALL_DEFAULTS.CIRCUIT_BREAKER_COOLDOWN_MS,
    ],
    [15_000, 220, 2, 1, 15_000, 3, 60_000],
  );
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
  assert.ok(one.includes(`${REMEMBERED_HEADING}\n\n- prefers tabs\n`));
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

test("recall eligibility: main and private threads of the same agent, never the current, temporary, observed, or a child", () => {
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
    assert.equal(
      conversationRunsRecall({ sessionKey: ineligibleKey, agentId: "main", temporary: false }),
      false,
      key,
    );
  }
  assert.equal(
    conversationRunsRecall({ sessionKey: MAIN_SESSION_KEY, agentId: "main", temporary: false }),
    true,
  );
});

test("recall intent reads questions about the past and nothing else", () => {
  assert.equal(hasRecallIntent("what did we decide about the deploy window?"), true);
  assert.equal(hasRecallIntent("do you remember the branch name?"), true);
  assert.equal(hasRecallIntent("open the second session"), false);
  assert.equal(hasRecallIntent("   "), false);
});

test("recent turns are bounded to two asks of 220 and one reply of 180 characters", () => {
  const bounded = boundRecentTurns([
    { role: "user", text: "a".repeat(300) },
    { role: "assistant", text: "b".repeat(300) },
    { role: "user", text: "c" },
    { role: "assistant", text: "d" },
    { role: "user", text: "e" },
  ]);
  assert.deepEqual(
    bounded.map((turn) => [turn.role, turn.text.length]),
    [
      ["user", 1],
      ["user", 1],
      ["assistant", 1],
    ],
  );
  assert.equal(boundRecentTurns([{ role: "user", text: "a".repeat(300) }])[0]?.text.length, 220);
  assert.equal(
    boundRecentTurns([{ role: "assistant", text: "b".repeat(300) }])[0]?.text.length,
    180,
  );
});

test("a recall summary is one line, cut to 220, and NONE means nothing", () => {
  assert.equal(summarizeRecallReply("NONE"), "");
  assert.equal(summarizeRecallReply("  none "), "");
  assert.equal(summarizeRecallReply("a\nb   c"), "a b c");
  assert.equal(summarizeRecallReply("x".repeat(500)).length, 220);
});

test("recall: trusted hit answers without a subrun, intent escalates, cache holds for 15s, timeouts trip the breaker", async () => {
  let now = NOW;
  let subruns = 0;
  let strong = true;
  let hang = false;
  const recall = new ConversationRecall({
    now: () => now,
    timeoutMs: 50,
    trustedMemory: async () => ({ strongHit: strong }),
    subrun: async ({ signal }) => {
      subruns += 1;
      if (!hang) return "We decided on tuesday deploys.";
      await new Promise<void>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
      return undefined;
    },
  });
  const ask = {
    sessionKey: MAIN_SESSION_KEY,
    agentId: "main",
    query: "what did we decide about deploys?",
    recentTurns: [],
  };
  const hit = await recall.recall(ask);
  assert.equal(hit.decision, RECALL_DECISION.TRUSTED_MEMORY_HIT);
  assert.equal(hit.status, RECALL_STATUS.SKIPPED);
  assert.equal(subruns, 0);

  strong = false;
  const plain = await recall.recall({ ...ask, query: "open the first session" });
  assert.equal(plain.decision, RECALL_DECISION.NO_RECALL_INTENT);
  assert.equal(subruns, 0);

  const escalated = await recall.recall(ask);
  assert.equal(escalated.status, RECALL_STATUS.OK);
  assert.equal(escalated.summary, "We decided on tuesday deploys.");
  assert.equal(subruns, 1);
  const cached = await recall.recall(ask);
  assert.equal(cached.cached, true);
  assert.equal(subruns, 1, "a repeated recall inside the window runs no subrun");
  now += RECALL_DEFAULTS.CACHE_TTL_MS + 1;
  await recall.recall(ask);
  assert.equal(subruns, 2, "and runs again once the cache has lapsed");

  hang = true;
  for (let i = 0; i < 3; i += 1) {
    const timedOut = await recall.recall({ ...ask, query: `what did we say earlier ${i}` });
    assert.equal(timedOut.status, RECALL_STATUS.TIMEOUT);
  }
  assert.equal(recall.consecutiveTimeouts(), 3);
  const tripped = await recall.recall({ ...ask, query: "what did we say earlier 9" });
  assert.equal(tripped.status, RECALL_STATUS.UNAVAILABLE);
  assert.equal(subruns, 5, "the open breaker runs no subrun");
  now += RECALL_DEFAULTS.CIRCUIT_BREAKER_COOLDOWN_MS;
  hang = false;
  const recovered = await recall.recall({ ...ask, query: "what did we say earlier 10" });
  assert.equal(recovered.status, RECALL_STATUS.OK);
});

test("a subrun that returns nothing because the timeout cut it counts as a timeout, not as nothing found", async () => {
  let lookups = 0;
  const recall = new ConversationRecall({
    timeoutMs: 20,
    trustedMemory: async () => {
      lookups += 1;
      return { strongHit: false };
    },
    // A cancelled tool loop ends quietly with no text rather than throwing.
    subrun: ({ signal }) =>
      new Promise<string | undefined>((resolve) =>
        signal.addEventListener("abort", () => resolve(undefined), { once: true }),
      ),
  });
  const ask = { sessionKey: MAIN_SESSION_KEY, agentId: "main", recentTurns: [] };
  const quiet = await recall.recall({ ...ask, query: "what did we decide about deploys?" });
  assert.equal(quiet.status, RECALL_STATUS.TIMEOUT);
  assert.equal(recall.consecutiveTimeouts(), 1);
  assert.equal(lookups, 1);
  const plain = await recall.recall({ ...ask, query: "open the first session" });
  assert.equal(plain.decision, RECALL_DECISION.NO_RECALL_INTENT);
  assert.equal(lookups, 1, "an ask with no recall intent consults trusted memory not at all");
});
