import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CANDIDATE_ORIGIN,
  CANDIDATE_SESSION_KIND,
  CANDIDATE_STATUS,
  type CandidateSeed,
  CONSOLIDATION_PHASE,
  hashText,
  MEMORY_HOUSEKEEPING_OUTCOME,
  promotedEntry,
  promotionMarker,
  rankCandidate,
} from "@sidecar/memory";
import { WORKSPACE_FILE } from "@sidecar/runtime";
import { MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime-contracts";
import {
  advanceIngestion,
  FORGOTTEN_SOURCE_KIND,
  flushState,
  forgetMemorySources,
  ingestionCursor,
  listForgottenSources,
  listMemoryCandidates,
  listMemoryRewrites,
  MEMORY_REWRITE_REFUSAL,
  messageIngested,
  publishMemoryRewrite,
  readDurableMemoryFile,
  recordFlush,
  recordPhaseHits,
  stageMemoryCandidates,
} from "./memory-maintenance-table.js";
import { listNotebookEntries, rememberNotebookEntry } from "./notebook-table.js";
import { NOW, openTestDatabase } from "./testing.js";

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "luke-memory-maintenance-"));
}

const THREAD = threadSessionKey("main", "11111111-1111-4111-8111-111111111111");

function seed(overrides: Partial<CandidateSeed> = {}): CandidateSeed {
  return {
    text: "The developer prefers pnpm over npm for every workspace install",
    path: `conversation:${THREAD}`,
    startLine: 0,
    endLine: 0,
    origin: CANDIDATE_ORIGIN.USER,
    sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
    sourceSessionKey: THREAD,
    sourceEventId: "line-1",
    query: "ingest:2026-09-06",
    score: 0.8,
    day: "2026-09-06",
    ...overrides,
  };
}

test("staging the same evidence twice reinforces one candidate; a promoted one takes no more signals", () => {
  const database = openTestDatabase();
  const first = stageMemoryCandidates(database, [seed()], NOW);
  assert.deepEqual(first, { staged: 1, reinforced: 0, refused: 0 });
  const second = stageMemoryCandidates(
    database,
    [seed({ query: "ingest:2026-09-07", day: "2026-09-07" })],
    NOW + 1,
  );
  assert.deepEqual(second, { staged: 0, reinforced: 1, refused: 0 });
  const [candidate] = listMemoryCandidates(database);
  assert.ok(candidate);
  assert.equal(candidate.signalCount, 2);
  assert.deepEqual(candidate.queries, ["ingest:2026-09-06", "ingest:2026-09-07"]);
  assert.deepEqual(candidate.days, ["2026-09-06", "2026-09-07"]);
  assert.equal(recordPhaseHits(database, CONSOLIDATION_PHASE.LIGHT, [candidate.key], NOW), 1);
  assert.equal(listMemoryCandidates(database)[0]?.lightHits, 1);
});

test("ingestion cursors and seen hashes keep a line from being learned twice", () => {
  const database = openTestDatabase();
  assert.equal(ingestionCursor(database, MAIN_SESSION_KEY), 0);
  const hash = hashText("typed-ask\nhello");
  assert.equal(messageIngested(database, MAIN_SESSION_KEY, hash), false);
  advanceIngestion(database, MAIN_SESSION_KEY, NOW, [hash], NOW);
  assert.equal(ingestionCursor(database, MAIN_SESSION_KEY), NOW);
  assert.equal(messageIngested(database, MAIN_SESSION_KEY, hash), true);
  advanceIngestion(database, MAIN_SESSION_KEY, NOW - 10, [], NOW + 1);
  assert.equal(ingestionCursor(database, MAIN_SESSION_KEY), NOW, "the cursor never moves back");
});

test("a rewrite is published only over the content it was planned on, with its preimage recorded", () => {
  const database = openTestDatabase();
  const root = workspace();
  fs.writeFileSync(path.join(root, WORKSPACE_FILE.MEMORY), "# MEMORY.md\n\n- one\n");
  const read = readDurableMemoryFile(root, WORKSPACE_FILE.MEMORY);
  assert.ok(read);
  stageMemoryCandidates(database, [seed()], NOW);
  const [candidate] = listMemoryCandidates(database);
  assert.ok(candidate);
  // The developer edits the file between the plan and the publish.
  fs.writeFileSync(path.join(root, WORKSPACE_FILE.MEMORY), "# MEMORY.md\n\n- one\n- by hand\n");
  const conflict = publishMemoryRewrite(
    database,
    root,
    {
      path: WORKSPACE_FILE.MEMORY,
      phase: CONSOLIDATION_PHASE.DEEP,
      expectedHash: read.hash,
      next: "# MEMORY.md\n\n- one\n- promoted\n",
      candidateKeys: [candidate.key],
    },
    NOW,
  );
  assert.deepEqual(conflict, { ok: false, reason: MEMORY_REWRITE_REFUSAL.CONFLICT });
  assert.equal(
    fs.readFileSync(path.join(root, WORKSPACE_FILE.MEMORY), "utf8"),
    "# MEMORY.md\n\n- one\n- by hand\n",
  );
  assert.equal(listMemoryCandidates(database)[0]?.status, CANDIDATE_STATUS.STAGED);

  const fresh = readDurableMemoryFile(root, WORKSPACE_FILE.MEMORY);
  assert.ok(fresh);
  const published = publishMemoryRewrite(
    database,
    root,
    {
      path: WORKSPACE_FILE.MEMORY,
      phase: CONSOLIDATION_PHASE.DEEP,
      expectedHash: fresh.hash,
      next: "# MEMORY.md\n\n- one\n- by hand\n- promoted\n",
      candidateKeys: [candidate.key],
    },
    NOW,
  );
  assert.equal(published.ok, true);
  assert.equal(
    fs.readFileSync(path.join(root, WORKSPACE_FILE.MEMORY), "utf8"),
    "# MEMORY.md\n\n- one\n- by hand\n- promoted\n",
  );
  const [rewrite] = listMemoryRewrites(database);
  assert.ok(rewrite);
  assert.equal(rewrite.previous, "# MEMORY.md\n\n- one\n- by hand\n");
  assert.deepEqual(rewrite.candidateKeys, [candidate.key]);
  assert.equal(listMemoryCandidates(database)[0]?.status, CANDIDATE_STATUS.PROMOTED);
  assert.deepEqual(
    publishMemoryRewrite(
      database,
      root,
      {
        path: WORKSPACE_FILE.SOUL,
        phase: CONSOLIDATION_PHASE.DEEP,
        expectedHash: "",
        next: "",
        candidateKeys: [],
      },
      NOW,
    ),
    { ok: false, reason: MEMORY_REWRITE_REFUSAL.NOT_DURABLE_FILE },
  );
});

test("flush state is recorded per conversation", () => {
  const database = openTestDatabase();
  assert.equal(flushState(database, MAIN_SESSION_KEY), undefined);
  recordFlush(database, MAIN_SESSION_KEY, {
    compactionCount: 2,
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED,
    flushedAt: NOW,
  });
  assert.deepEqual(flushState(database, MAIN_SESSION_KEY), {
    compactionCount: 2,
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED,
    flushedAt: NOW,
  });
});

test("forgetting a source removes its candidates and the MEMORY.md entries they produced, tombstones it against relearning, and reports what a hand edit left unattributable", () => {
  const database = openTestDatabase();
  const root = workspace();
  stageMemoryCandidates(database, [seed()], NOW);
  stageMemoryCandidates(database, [seed({ query: "ingest:2026-09-07", day: "2026-09-07" })], NOW);
  stageMemoryCandidates(database, [seed({ query: "ingest:2026-09-08", day: "2026-09-08" })], NOW);
  const other = seed({
    text: "The developer keeps meetings before noon",
    path: "memory/2026-09-05.md",
    startLine: 2,
    endLine: 2,
    sourceSessionKey: undefined,
    sourceEventId: undefined,
  });
  stageMemoryCandidates(database, [other], NOW);
  const [fromThread, fromNote] = listMemoryCandidates(database).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  assert.ok(fromThread && fromNote);
  const content = [
    "# MEMORY.md",
    "",
    "## Consolidated Memory (2026-09-08)",
    "",
    promotionMarker(fromThread.key),
    promotedEntry({ candidate: fromThread, ranking: rankCandidate(fromThread, NOW) }),
    promotionMarker(fromNote.key),
    promotedEntry({ candidate: fromNote, ranking: rankCandidate(fromNote, NOW) }),
    "- Edited by hand Source: memory/2026-09-01.md#L2-L2",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, WORKSPACE_FILE.MEMORY), content);
  const remembered = rememberNotebookEntry(database, root, { id: "e1", words: "likes tabs" }, NOW);
  assert.equal(remembered.ok, true);

  const report = forgetMemorySources(
    database,
    root,
    { entryIds: ["e1"], sessionKeys: [THREAD], reason: "developer asked" },
    NOW,
  );
  assert.equal(report.forgottenEntries, 1);
  assert.equal(report.removedCandidates, 1);
  assert.equal(report.removedMemoryEntries, 1);
  assert.equal(report.limitations.length, 1);
  assert.match(report.limitations[0] ?? "", /attribution was lost to a manual edit/u);
  assert.deepEqual(listNotebookEntries(database, root, NOW), []);
  const memory = fs.readFileSync(path.join(root, WORKSPACE_FILE.MEMORY), "utf8");
  assert.equal(memory.includes(promotionMarker(fromThread.key)), false);
  assert.equal(memory.includes("prefers pnpm"), false);
  assert.ok(memory.includes("before noon"));
  assert.ok(memory.includes("Edited by hand"));
  assert.deepEqual(
    listMemoryCandidates(database).map((candidate) => candidate.key),
    [fromNote.key],
  );
  const tombstones = listForgottenSources(database);
  assert.ok(
    tombstones.some(
      (source) => source.kind === FORGOTTEN_SOURCE_KIND.CONVERSATION && source.id === THREAD,
    ),
  );
  assert.ok(
    tombstones.some(
      (source) => source.kind === FORGOTTEN_SOURCE_KIND.HISTORY_LINE && source.id === "line-1",
    ),
  );
  // A later scan of the same source relearns nothing.
  const again = stageMemoryCandidates(database, [seed()], NOW + 1);
  assert.deepEqual(again, { staged: 0, reinforced: 0, refused: 1 });
  assert.equal(listMemoryRewrites(database).length, 1, "the scrub kept its preimage");
});
