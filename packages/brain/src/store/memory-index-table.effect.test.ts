import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "@effect/vitest";
import { MEMORY_SEARCH_DEFAULTS } from "@sidecar/memory";
import { WORKSPACE_FILE } from "@sidecar/runtime";
import { Effect } from "effect";
import {
  applyMemorySyncEffect,
  isMemoryPath,
  memoryIndexStatusEffect,
  planMemorySyncEffect,
  readMemoryLines,
  rebuildMemoryIndexEffect,
  resolveMemoryPath,
  searchMemoryIndexEffect,
} from "./memory-index-table.js";
import { listNotebookEntriesEffect, rememberNotebookEntryEffect } from "./notebook-table.js";
import { NOW, overStore } from "./testing.js";

const IDENTITY = { provider: "openai", model: "text-embedding-3-small" };

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-memory-index-"));
  fs.mkdirSync(path.join(root, "memory"));
  fs.writeFileSync(
    path.join(root, WORKSPACE_FILE.MEMORY),
    "# MEMORY.md\n\nDeploys go out on Tuesday afternoons.\nThe staging cluster lives in Frankfurt.\n",
  );
  fs.writeFileSync(
    path.join(root, "memory", "2026-09-01.md"),
    "# 2026-09-01\n\nTalked about Tuesday deploys at standup.\n",
  );
  return root;
}

/** A toy embedding: a fixed vocabulary's presence, enough for cosine to rank. */
function embed(text: string): number[] {
  const words = ["tuesday", "deploys", "frankfurt", "cluster", "espresso"];
  const lower = text.toLowerCase();
  return words.map((word) => (lower.includes(word) ? 1 : 0));
}

function sync(root: string, now = NOW) {
  return Effect.gen(function* () {
    const plan = yield* planMemorySyncEffect(
      root,
      IDENTITY,
      yield* listNotebookEntriesEffect(root, now),
    );
    const embeddings = plan.missingEmbeddings.map((missing) => ({
      hash: missing.hash,
      vector: embed(missing.text),
    }));
    const report = yield* applyMemorySyncEffect(plan, embeddings, IDENTITY, now);
    return { plan, report };
  });
}

describe("the memory index over the client", () => {
  it.effect("a sync indexes the notebook files, and an unchanged file is not indexed again", () =>
    overStore(
      Effect.gen(function* () {
        const root = workspace();
        const first = yield* sync(root);
        assert.deepEqual(
          first.plan.changed.map((file) => file.path),
          ["MEMORY.md", "memory/2026-09-01.md"],
        );
        assert.equal(first.plan.removed.length, 0);
        assert.ok(first.plan.missingEmbeddings.length > 0);
        assert.equal(first.report.indexedFiles, 2);
        assert.equal(first.report.embeddedChunks, first.report.indexedChunks);
        const second = yield* sync(root);
        assert.equal(second.plan.changed.length, 0);
        assert.equal(second.plan.unchanged, 2);
        assert.equal(
          second.plan.missingEmbeddings.length,
          0,
          "cached vectors are not asked for again",
        );
      }),
    ),
  );

  it.effect("keyword and semantic retrieval agree on the notebook, and a dated note decays", () =>
    overStore(
      Effect.gen(function* () {
        const root = workspace();
        yield* sync(root);
        const keywordOnly = yield* searchMemoryIndexEffect({
          query: "frankfurt cluster",
          now: NOW,
        });
        assert.equal(keywordOnly.vectorHits, 0);
        assert.equal(keywordOnly.results[0]?.path, "MEMORY.md");
        assert.ok((keywordOnly.results[0]?.textScore ?? 0) > 0);
        assert.equal(keywordOnly.results[0]?.provenance.path, "MEMORY.md");

        const semantic = yield* searchMemoryIndexEffect({
          query: "when do we ship",
          queryVector: embed("tuesday deploys"),
          identity: IDENTITY,
          now: Date.UTC(2026, 8, 8),
        });
        assert.ok(semantic.vectorHits > 0);
        const evergreen = semantic.results.find((result) => result.path === "MEMORY.md");
        const note = semantic.results.find((result) => result.path === "memory/2026-09-01.md");
        assert.ok(evergreen && note);
        assert.ok(
          Math.abs(evergreen.score - MEMORY_SEARCH_DEFAULTS.VECTOR_WEIGHT * evergreen.vectorScore) <
            1e-9,
          "the evergreen file keeps its whole weighted score",
        );
        assert.ok(
          note.score < MEMORY_SEARCH_DEFAULTS.VECTOR_WEIGHT * note.vectorScore,
          "the dated note is decayed below its weighted score",
        );
        assert.ok(
          semantic.results.every(
            (result) => result.startLine >= 1 && result.endLine >= result.startLine,
          ),
        );
      }),
    ),
  );

  it.effect(
    "a file edit re-indexes only that file, a deletion removes its rows, and a rebuild starts over",
    () =>
      overStore(
        Effect.gen(function* () {
          const root = workspace();
          yield* sync(root);
          fs.writeFileSync(
            path.join(root, WORKSPACE_FILE.MEMORY),
            "# MEMORY.md\n\nThe team drinks espresso.\n",
          );
          const edited = yield* sync(root, NOW + 1);
          assert.deepEqual(
            edited.plan.changed.map((file) => file.path),
            ["MEMORY.md"],
          );
          assert.equal(
            (yield* searchMemoryIndexEffect({ query: "frankfurt", now: NOW })).results.length,
            0,
          );
          assert.equal(
            (yield* searchMemoryIndexEffect({ query: "espresso", now: NOW })).results.length,
            1,
          );

          fs.rmSync(path.join(root, "memory", "2026-09-01.md"));
          const removed = yield* sync(root, NOW + 2);
          assert.deepEqual(removed.plan.removed, ["memory/2026-09-01.md"]);
          assert.equal(
            (yield* searchMemoryIndexEffect({ query: "standup", now: NOW })).results.length,
            0,
          );
          assert.equal((yield* memoryIndexStatusEffect).sources, 1);

          assert.equal(yield* rebuildMemoryIndexEffect, true);
          assert.equal((yield* memoryIndexStatusEffect).chunks, 0);
          const rebuilt = yield* sync(root, NOW + 3);
          assert.equal(rebuilt.plan.changed.length, 1);
          assert.equal(rebuilt.plan.missingEmbeddings.length, 0, "the cache survives a rebuild");
          const status = yield* memoryIndexStatusEffect;
          assert.equal(status.embeddedChunks, status.chunks);
        }),
      ),
  );

  it.effect(
    "without an embedding identity the index is keyword-only and says so in its counts",
    () =>
      overStore(
        Effect.gen(function* () {
          const root = workspace();
          const plan = yield* planMemorySyncEffect(
            root,
            undefined,
            yield* listNotebookEntriesEffect(root, NOW),
          );
          assert.equal(plan.missingEmbeddings.length, 0);
          const report = yield* applyMemorySyncEffect(plan, [], undefined, NOW);
          assert.equal(report.embeddedChunks, 0);
          assert.ok(report.indexedChunks > 0);
          const answer = yield* searchMemoryIndexEffect({ query: "frankfurt", now: NOW });
          assert.equal(answer.vectorHits, 0);
          assert.equal(answer.results.length, 1);
        }),
      ),
  );

  it.effect("USER.md chunks carry the ids of the entries they cover", () =>
    overStore(
      Effect.gen(function* () {
        const root = workspace();
        yield* rememberNotebookEntryEffect(root, { id: "entry-1", words: "prefers espresso" }, NOW);
        yield* sync(root);
        const hit = (yield* searchMemoryIndexEffect({ query: "espresso", now: NOW })).results[0];
        assert.equal(hit?.path, "USER.md");
        assert.deepEqual(hit?.provenance.entryIds, ["entry-1"]);
      }),
    ),
  );

  it.effect("the embedding cache is pruned at the pinned bound", () =>
    overStore(
      Effect.gen(function* () {
        yield* applyMemorySyncEffect(
          { changed: [], removed: [] },
          [
            { hash: "h0", vector: [1] },
            { hash: "h1", vector: [1] },
            { hash: "h2", vector: [1] },
            { hash: "h3", vector: [1] },
            { hash: "h4", vector: [1] },
          ],
          IDENTITY,
          NOW,
        );
        yield* applyMemorySyncEffect(
          { changed: [], removed: [] },
          [{ hash: "fresh", vector: [1] }],
          IDENTITY,
          NOW + 1,
        );
        assert.equal((yield* memoryIndexStatusEffect).cachedEmbeddings, 6);
        assert.ok(MEMORY_SEARCH_DEFAULTS.EMBEDDING_CACHE_MAXIMUM_ENTRIES > 6);
      }),
    ),
  );

  it.effect(
    "a file indexed keyword-only is planned again once an embedding identity stands, until every chunk has a vector",
    () =>
      overStore(
        Effect.gen(function* () {
          const root = workspace();
          const keywordOnly = yield* planMemorySyncEffect(
            root,
            undefined,
            yield* listNotebookEntriesEffect(root, NOW),
          );
          yield* applyMemorySyncEffect(keywordOnly, [], undefined, NOW);
          assert.equal((yield* memoryIndexStatusEffect).embeddedChunks, 0);
          // The provider failed on the first credentialed pass: the plan asked for vectors, none came.
          const failed = yield* planMemorySyncEffect(
            root,
            IDENTITY,
            yield* listNotebookEntriesEffect(root, NOW + 1),
          );
          assert.equal(
            failed.changed.length,
            2,
            "unchanged content still plans while its vectors are missing",
          );
          assert.ok(failed.missingEmbeddings.length > 0);
          yield* applyMemorySyncEffect(failed, [], undefined, NOW + 1);
          assert.equal((yield* memoryIndexStatusEffect).embeddedChunks, 0);
          // The next pass embeds and lands them; after that the files are unchanged and done.
          const backfilled = yield* sync(root, NOW + 2);
          assert.equal(backfilled.plan.changed.length, 2);
          const status = yield* memoryIndexStatusEffect;
          assert.equal(status.embeddedChunks, status.chunks);
          const settled = yield* planMemorySyncEffect(
            root,
            IDENTITY,
            yield* listNotebookEntriesEffect(root, NOW + 3),
          );
          assert.equal(settled.changed.length, 0);
          assert.equal(settled.unchanged, 2);
        }),
      ),
  );

  it.effect("reads validate the path against the root and clamp the range", () =>
    overStore(
      Effect.sync(() => {
        const root = workspace();
        assert.equal(isMemoryPath("../secrets.md"), false);
        assert.equal(isMemoryPath("/etc/passwd"), false);
        assert.equal(isMemoryPath("SOUL.md"), false);
        assert.equal(isMemoryPath("memory/notes/topic.md"), true);
        assert.equal(resolveMemoryPath(root, "memory/../MEMORY.md"), undefined);
        assert.equal(readMemoryLines(root, "AGENTS.md"), undefined);
        const read = readMemoryLines(root, "MEMORY.md", 3, 1);
        assert.deepEqual(read, {
          path: "MEMORY.md",
          text: "Deploys go out on Tuesday afternoons.",
          from: 3,
          to: 3,
          totalLines: 5,
          truncated: true,
        });
        assert.equal(readMemoryLines(root, "MEMORY.md")?.truncated, false);
        assert.equal(readMemoryLines(root, "MEMORY.md", 99)?.text, "");
        assert.equal(readMemoryLines(root, "memory/none.md"), undefined);
      }),
    ),
  );

  it.effect(
    "two agents are two databases over two workspaces: neither sees the other's notebook or index",
    () =>
      Effect.gen(function* () {
        const firstRoot = workspace();
        const secondRoot = workspace();
        yield* overStore(
          Effect.gen(function* () {
            yield* rememberNotebookEntryEffect(
              firstRoot,
              { id: "a", words: "agent one drinks espresso" },
              NOW,
            );
            yield* sync(firstRoot);
            assert.equal(
              (yield* searchMemoryIndexEffect({ query: "espresso", now: NOW })).results.length,
              1,
            );
          }),
        );
        yield* overStore(
          Effect.gen(function* () {
            yield* sync(secondRoot);
            assert.equal(
              (yield* searchMemoryIndexEffect({ query: "espresso", now: NOW })).results.length,
              0,
            );
            assert.equal(
              readMemoryLines(secondRoot, "USER.md"),
              undefined,
              "the second workspace holds no USER.md",
            );
            assert.equal(
              (yield* memoryIndexStatusEffect).sources,
              2,
              "only its own MEMORY.md and note",
            );
          }),
        );
      }),
  );
});
