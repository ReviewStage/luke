import assert from "node:assert/strict";
import { test } from "vitest";
import { MEMORY_RANKING, type PassageCandidate, rankPassages } from "./ranking.js";

/** Synthetic passages throughout: no real note, decision, or name. */

const NOW = Date.UTC(2026, 8, 15);

function passage(
  path: string,
  text: string,
  overrides: Partial<PassageCandidate> = {},
): PassageCandidate {
  return { path, startLine: 1, endLine: 1, text, updatedAt: NOW, ...overrides };
}

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
