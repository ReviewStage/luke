import assert from "node:assert/strict";
import { DAY_MS } from "@sidecar/runtime/vocabulary";
import { test } from "vitest";
import {
  bm25Scores,
  cosineSimilarity,
  datedNoteDay,
  MEMORY_RANKING,
  type PassageCandidate,
  rankPassages,
  recencyWeight,
  snippetOf,
  tokenize,
} from "./ranking.js";

/** Synthetic passages throughout: no real note, decision, or name. */

const NOW = Date.UTC(2026, 8, 15);

function passage(
  path: string,
  text: string,
  overrides: Partial<PassageCandidate> = {},
): PassageCandidate {
  return { path, startLine: 1, endLine: 1, text, updatedAt: NOW, ...overrides };
}

test("tokenize lowers ASCII words and keeps duplicates, and cuts CJK into characters and adjacent bigrams", () => {
  assert.deepEqual(tokenize("Notch notch, clipping!"), ["notch", "notch", "clipping"]);
  assert.deepEqual(tokenize("日本語"), ["日本", "本語", "日", "本", "語"]);
  assert.deepEqual(tokenize("  ...  "), []);
});

test("BM25 scores the passage carrying the query's rarer terms highest, and a passage sharing nothing at zero", () => {
  const documents = [
    tokenize("the notch clips the menu bar on the wide display"),
    tokenize("the standing desk is raised in the mornings"),
    tokenize("the notch decision: keep the panel below the notch"),
  ];
  const scores = bm25Scores(tokenize("notch decision"), documents);
  assert.equal(scores.length, 3);
  assert.equal(scores[1], 0);
  assert.ok((scores[2] ?? 0) > (scores[0] ?? 0), "two matching terms beat one");
  assert.ok((scores[0] ?? 0) > 0);
  assert.deepEqual(bm25Scores([], documents), [0, 0, 0]);
  assert.deepEqual(bm25Scores(tokenize("anything"), []), []);
});

test("cosine similarity is one for a vector with itself, zero across widths, and zero for a zero vector", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-12);
});

test("a dated note's day is read from its path, and nothing else has one", () => {
  assert.equal(datedNoteDay("memory/2026-09-14.md"), Date.UTC(2026, 8, 14));
  assert.equal(datedNoteDay("memory/2026-09-14-standup.md"), Date.UTC(2026, 8, 14));
  assert.equal(datedNoteDay("memory/2026-02-30.md"), undefined);
  assert.equal(datedNoteDay("MEMORY.md"), undefined);
  assert.equal(datedNoteDay("notes/2026-09-14.md"), undefined);
});

test("recency halves every 30 days and never exceeds one", () => {
  assert.equal(recencyWeight(0), 1);
  assert.equal(recencyWeight(-DAY_MS), 1);
  assert.ok(Math.abs(recencyWeight(30 * DAY_MS) - 0.5) < 1e-12);
  assert.ok(Math.abs(recencyWeight(60 * DAY_MS) - 0.25) < 1e-12);
  assert.equal(MEMORY_RANKING.RECENCY_HALF_LIFE_DAYS, 30);
});

test("keyword-only ranking scores the best lexical match one, decays a dated note by its day, and drops passages sharing no term", () => {
  const ranked = rankPassages({
    query: "notch decision",
    passages: [
      passage("MEMORY.md", "the notch decision: keep the panel below the notch"),
      passage("memory/2026-08-16.md", "the notch decision: keep the panel below the notch"),
      passage("USER.md", "prefers espresso in the mornings"),
    ],
    now: NOW,
    maxResults: 20,
  });
  assert.deepEqual(
    ranked.map((result) => result.path),
    ["MEMORY.md", "memory/2026-08-16.md"],
  );
  assert.equal(ranked[0]?.score, 1);
  assert.ok(Math.abs((ranked[1]?.score ?? 0) - 0.5) < 1e-9, "thirty days old is half");
  assert.deepEqual(
    ranked.map((result) => [result.startLine, result.endLine]),
    [
      [1, 1],
      [1, 1],
    ],
  );
});

test("hybrid ranking weights the vector lane at 0.7 and the keyword lane at 0.3, and a passage without a vector keeps only its keyword share", () => {
  const ranked = rankPassages({
    query: "espresso",
    queryVector: [1, 0],
    passages: [
      passage("MEMORY.md", "the notch decision stands", { vector: [1, 0] }),
      passage("USER.md", "prefers espresso", { vector: [0, 1] }),
      passage("memory/2026-09-15.md", "prefers espresso"),
    ],
    now: NOW,
    maxResults: 20,
  });
  const byPath = new Map(ranked.map((result) => [result.path, result.score]));
  assert.ok(Math.abs((byPath.get("MEMORY.md") ?? 0) - MEMORY_RANKING.VECTOR_WEIGHT) < 1e-9);
  assert.ok(Math.abs((byPath.get("USER.md") ?? 0) - MEMORY_RANKING.TEXT_WEIGHT) < 1e-9);
  assert.ok(
    Math.abs((byPath.get("memory/2026-09-15.md") ?? 0) - MEMORY_RANKING.TEXT_WEIGHT) < 1e-9,
    "the unembedded passage is ranked by keyword alone",
  );
  assert.equal(ranked[0]?.path, "MEMORY.md");
});

test("the window is cut to maxResults with ties broken by path and line, and an empty ask answers nothing", () => {
  const ranked = rankPassages({
    query: "espresso",
    passages: [
      passage("USER.md", "espresso", { startLine: 9, endLine: 9 }),
      passage("MEMORY.md", "espresso", { startLine: 3, endLine: 3 }),
      passage("MEMORY.md", "espresso", { startLine: 1, endLine: 1 }),
    ],
    now: NOW,
    maxResults: 2,
  });
  assert.deepEqual(
    ranked.map((result) => [result.path, result.startLine]),
    [
      ["MEMORY.md", 1],
      ["MEMORY.md", 3],
    ],
  );
  assert.deepEqual(rankPassages({ query: "x", passages: [], now: NOW, maxResults: 5 }), []);
  assert.deepEqual(
    rankPassages({ query: "x", passages: [passage("USER.md", "x")], now: NOW, maxResults: 0 }),
    [],
  );
});

test("a snippet folds whitespace and is cut to the bound with an ellipsis", () => {
  assert.equal(snippetOf("  a\n\n b   c "), "a b c");
  const long = snippetOf("w".repeat(1000));
  assert.equal(long.length, MEMORY_RANKING.SNIPPET_CHARS);
  assert.ok(long.endsWith("…"));
});
