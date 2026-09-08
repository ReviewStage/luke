import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MEMORY_SEARCH_DEFAULTS } from "@sidecar/memory";
import { WORKSPACE_FILE } from "@sidecar/runtime";
import {
  applyMemorySync,
  isMemoryPath,
  memoryIndexStatus,
  planMemorySync,
  readMemoryLines,
  rebuildMemoryIndex,
  resolveMemoryPath,
  searchMemoryIndex,
} from "./memory-index-table.js";
import { rememberNotebookEntry } from "./notebook-table.js";
import { NOW, openTestDatabase } from "./testing.js";

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

function sync(database: ReturnType<typeof openTestDatabase>, root: string, now = NOW) {
  const plan = planMemorySync(database, root, IDENTITY, now);
  const embeddings = plan.missingEmbeddings.map((missing) => ({
    hash: missing.hash,
    vector: embed(missing.text),
  }));
  return { plan, report: applyMemorySync(database, plan, embeddings, IDENTITY, now) };
}

test("a sync indexes the notebook files, and an unchanged file is not indexed again", () => {
  const database = openTestDatabase();
  const root = workspace();
  const first = sync(database, root);
  assert.deepEqual(
    first.plan.changed.map((file) => file.path),
    ["MEMORY.md", "memory/2026-09-01.md"],
  );
  assert.equal(first.plan.removed.length, 0);
  assert.ok(first.plan.missingEmbeddings.length > 0);
  assert.equal(first.report.indexedFiles, 2);
  assert.equal(first.report.embeddedChunks, first.report.indexedChunks);
  const second = sync(database, root);
  assert.equal(second.plan.changed.length, 0);
  assert.equal(second.plan.unchanged, 2);
  assert.equal(second.plan.missingEmbeddings.length, 0, "cached vectors are not asked for again");
});

test("keyword and semantic retrieval agree on the notebook, and a dated note decays", () => {
  const database = openTestDatabase();
  const root = workspace();
  sync(database, root);
  const keywordOnly = searchMemoryIndex(database, { query: "frankfurt cluster", now: NOW });
  assert.equal(keywordOnly.vectorHits, 0);
  assert.equal(keywordOnly.results[0]?.path, "MEMORY.md");
  assert.ok((keywordOnly.results[0]?.textScore ?? 0) > 0);
  assert.equal(keywordOnly.results[0]?.provenance.path, "MEMORY.md");

  const semantic = searchMemoryIndex(database, {
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
    Math.abs(evergreen.score - MEMORY_SEARCH_DEFAULTS.VECTOR_WEIGHT * evergreen.vectorScore) < 1e-9,
    "the evergreen file keeps its whole weighted score",
  );
  assert.ok(
    note.score < MEMORY_SEARCH_DEFAULTS.VECTOR_WEIGHT * note.vectorScore,
    "the dated note is decayed below its weighted score",
  );
  assert.ok(
    semantic.results.every((result) => result.startLine >= 1 && result.endLine >= result.startLine),
  );
});

test("a file edit re-indexes only that file, a deletion removes its rows, and a rebuild starts over", () => {
  const database = openTestDatabase();
  const root = workspace();
  sync(database, root);
  fs.writeFileSync(
    path.join(root, WORKSPACE_FILE.MEMORY),
    "# MEMORY.md\n\nThe team drinks espresso.\n",
  );
  const edited = sync(database, root, NOW + 1);
  assert.deepEqual(
    edited.plan.changed.map((file) => file.path),
    ["MEMORY.md"],
  );
  assert.equal(searchMemoryIndex(database, { query: "frankfurt", now: NOW }).results.length, 0);
  assert.equal(searchMemoryIndex(database, { query: "espresso", now: NOW }).results.length, 1);

  fs.rmSync(path.join(root, "memory", "2026-09-01.md"));
  const removed = sync(database, root, NOW + 2);
  assert.deepEqual(removed.plan.removed, ["memory/2026-09-01.md"]);
  assert.equal(searchMemoryIndex(database, { query: "standup", now: NOW }).results.length, 0);
  assert.equal(memoryIndexStatus(database).sources, 1);

  assert.equal(rebuildMemoryIndex(database), true);
  assert.equal(memoryIndexStatus(database).chunks, 0);
  const rebuilt = sync(database, root, NOW + 3);
  assert.equal(rebuilt.plan.changed.length, 1);
  assert.equal(rebuilt.plan.missingEmbeddings.length, 0, "the cache survives a rebuild");
  assert.equal(memoryIndexStatus(database).embeddedChunks, memoryIndexStatus(database).chunks);
});

test("without an embedding identity the index is keyword-only and says so in its counts", () => {
  const database = openTestDatabase();
  const root = workspace();
  const plan = planMemorySync(database, root, undefined, NOW);
  assert.equal(plan.missingEmbeddings.length, 0);
  const report = applyMemorySync(database, plan, [], undefined, NOW);
  assert.equal(report.embeddedChunks, 0);
  assert.ok(report.indexedChunks > 0);
  const answer = searchMemoryIndex(database, { query: "frankfurt", now: NOW });
  assert.equal(answer.vectorHits, 0);
  assert.equal(answer.results.length, 1);
});

test("USER.md chunks carry the ids of the entries they cover", () => {
  const database = openTestDatabase();
  const root = workspace();
  rememberNotebookEntry(database, root, { id: "entry-1", words: "prefers espresso" }, NOW);
  sync(database, root);
  const hit = searchMemoryIndex(database, { query: "espresso", now: NOW }).results[0];
  assert.equal(hit?.path, "USER.md");
  assert.deepEqual(hit?.provenance.entryIds, ["entry-1"]);
});

test("reads validate the path against the root and clamp the range", () => {
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
});

test("the embedding cache is pruned at the pinned bound", () => {
  const database = openTestDatabase();
  const insert = database.prepare(
    "INSERT INTO memory_embedding_cache (provider, model, hash, embedding, dims, updated_at) VALUES (?, ?, ?, '[1]', 1, ?)",
  );
  for (let i = 0; i < 5; i += 1) insert.run("openai", "m", `h${i}`, i);
  applyMemorySync(
    database,
    { changed: [], removed: [] },
    [{ hash: "fresh", vector: [1] }],
    IDENTITY,
    NOW,
  );
  assert.equal(memoryIndexStatus(database).cachedEmbeddings, 6);
  assert.ok(MEMORY_SEARCH_DEFAULTS.EMBEDDING_CACHE_MAXIMUM_ENTRIES > 6);
});

test("two agents are two databases over two workspaces: neither sees the other's notebook or index", () => {
  const first = openTestDatabase();
  const second = openTestDatabase();
  const firstRoot = workspace();
  const secondRoot = workspace();
  rememberNotebookEntry(first, firstRoot, { id: "a", words: "agent one drinks espresso" }, NOW);
  sync(first, firstRoot);
  sync(second, secondRoot);
  assert.equal(searchMemoryIndex(first, { query: "espresso", now: NOW }).results.length, 1);
  assert.equal(searchMemoryIndex(second, { query: "espresso", now: NOW }).results.length, 0);
  assert.equal(
    readMemoryLines(secondRoot, "USER.md"),
    undefined,
    "the second workspace holds no USER.md",
  );
  assert.equal(memoryIndexStatus(second).sources, 2, "only its own MEMORY.md and note");
});
