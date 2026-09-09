import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/realtime";
import {
  ARCHIVE_REASON,
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  CONVERSATION_KIND,
  type ConversationRecord,
  DEFAULT_AGENT_ID,
  MAIN_SESSION_KEY,
  type SessionKey,
  sessionKey,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import { userMessageItem } from "../responses-api.js";
import { BrainStateStore, freshBrainState } from "../state-store.js";
import {
  archiveDirectory,
  deleteConversationHistory,
  FILE_SYSTEM_DURABILITY,
  listArchives,
  type PublicationDurability,
  publishPendingArchives,
} from "./archives.js";
import { loadBrainEnvelope, saveBrainEnvelope } from "./brain-envelope.js";
import { decodeArchiveContent, encodeArchiveContent, zstdSupported } from "./compression.js";
import {
  archiveConversation,
  createConversation,
  listConversations,
  pinConversation,
} from "./conversations-table.js";
import { AGENT_DATABASE_FILE, StoreDatabase } from "./database.js";
import { EnvelopeTracker } from "./envelope.js";
import { appendHistory, historyClearedAt, listHistory } from "./history-table.js";
import {
  capVictims,
  diskBudgetVictims,
  HISTORY_MAINTENANCE_DEFAULTS,
  idleThreadVictims,
  shouldRunEntryMaintenance,
  staleVictims,
} from "./maintenance.js";
import { measurePhysicalUsage, runHistoryMaintenance } from "./maintenance-run.js";
import { inspectHistory, line, NOW } from "./testing.js";
import { listCompactionBoundaries, listTranscript, searchTranscript } from "./transcript-table.js";

/**
 * The lifecycle the store now owns: the transcript kept apart from the
 * projection, the recoverable deletion, and the maintenance policy ported
 * from OpenClaw. Every value below is synthetic.
 */

const DAY = 24 * 60 * 60 * 1000;
const SECRET = "SEARCHABLE_SECRET_TOKEN";

function agentRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-lifecycle-"));
  return root;
}

function openAt(root: string): StoreDatabase {
  const database = StoreDatabase.open(path.join(root, AGENT_DATABASE_FILE));
  createConversation(database, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    name: "main",
    now: NOW,
  });
  return database;
}

/** A repository over the database in-thread, carrying transcript events the way the client does. */
function repository(database: StoreDatabase, key: SessionKey = MAIN_SESSION_KEY) {
  const tracker = new EnvelopeTracker();
  tracker.observe(loadBrainEnvelope(database, key));
  return {
    load: () => {
      const loaded = loadBrainEnvelope(database, key);
      tracker.observe(loaded);
      return loaded;
    },
    save: (
      state: Parameters<typeof tracker.saveFor>[0],
      transcript?: readonly TranscriptEvent[],
    ) => {
      const landed = saveBrainEnvelope(database, key, tracker.saveFor(state, transcript));
      if (landed) tracker.landed(state);
      return landed;
    },
  };
}

function userText(text: string, recordedAt = NOW): TranscriptEvent {
  return {
    kind: TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
    recordedAt,
    input: { kind: CONTEXT_INPUT_KIND.USER_TEXT, text },
  };
}

function record(key: string, overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    sessionKey: sessionKey(key),
    kind: CONVERSATION_KIND.THREAD,
    name: key,
    createdAt: NOW - 100 * DAY,
    lastActivityAt: NOW - 100 * DAY,
    ...overrides,
  };
}

test("zstd archives round-trip through the build's own codec, and an empty archive stays plain", () => {
  assert.equal(zstdSupported(), true);
  const encoded = encodeArchiveContent(`{"a":1}\n`.repeat(50));
  assert.equal(encoded.encoding, "zstd");
  assert.ok(encoded.bytes.length < 400);
  assert.equal(decodeArchiveContent(encoded.bytes, encoded.encoding), `{"a":1}\n`.repeat(50));
  assert.equal(encodeArchiveContent("").encoding, "identity");
});

test("a compaction changes the projection and keeps the transcript searchable, with the boundary on record", () => {
  const root = agentRoot();
  const database = openAt(root);
  const repo = repository(database);
  let state = freshBrainState("gen-1", NOW);
  state = {
    ...state,
    checkpointFormat: "tool-loop@1:openai-responses-input/1",
    items: [
      { type: "message", role: "user", content: SECRET },
      { type: "message", role: "assistant", content: "noted" },
    ],
  };
  assert.equal(repo.save(state, [userText(SECRET), userText("noted")]), true);
  // The explicit compaction: the window replaced whole, the boundary recorded beside it.
  state = { ...state, items: [{ type: "compaction", encrypted_content: "folded" }] };
  assert.equal(
    repo.save(state, [
      {
        kind: TRANSCRIPT_EVENT_KIND.COMPACTION,
        recordedAt: NOW + 1,
        boundary: {
          source: COMPACTION_SOURCE.PROVIDER_EXPLICIT,
          dropped: 2,
          checkpointFormat: "tool-loop@1:openai-responses-input/1",
        },
      },
    ]),
    true,
  );
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.items, [
    { type: "compaction", encrypted_content: "folded" },
  ]);
  const transcript = listTranscript(database, MAIN_SESSION_KEY);
  assert.equal(transcript.length, 3);
  assert.equal(transcript[0]?.sessionId, "gen-1");
  assert.equal(searchTranscript(database, MAIN_SESSION_KEY, SECRET).length, 1);
  assert.deepEqual(
    listCompactionBoundaries(database, MAIN_SESSION_KEY).map((b) => [
      b.source,
      b.dropped,
      b.transcriptSequence,
    ]),
    [[COMPACTION_SOURCE.PROVIDER_EXPLICIT, 2, 3]],
  );
  // A save from a stale picture of the generation carries no transcript either.
  const stale = repository(database);
  stale.load();
  assert.equal(repo.save(freshBrainState("gen-2", NOW + 2)), true);
  assert.equal(
    stale.save({ ...state, cursors: { codex: { s: "late" } } }, [userText("late")]),
    false,
  );
  assert.equal(searchTranscript(database, MAIN_SESSION_KEY, "late").length, 0);
  database.close();
});

test("Start fresh replaces the lifetime and keeps the history and transcript, attributed to the lifetime that wrote them", async () => {
  const root = agentRoot();
  const database = openAt(root);
  const repo = repository(database);
  let ids = 0;
  const store = new BrainStateStore({
    repository: repo,
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  const first = await store.load();
  const lease = store.lease();
  assert.equal(
    await store.write(lease, first.generationId, (state) => ({
      ...state,
      items: [{ type: "message", role: "user", content: "before" }],
      transcript: [userText("before")],
    })),
    true,
  );
  appendHistory(database, MAIN_SESSION_KEY, [line("said before", NOW, { eventId: "h1" })], NOW);
  assert.equal(await store.reset(NOW + 5), true);
  const standing = loadBrainEnvelope(database, MAIN_SESSION_KEY);
  assert.equal(standing.state?.generationId, "gen-2");
  assert.deepEqual(standing.state?.items, []);
  assert.equal(standing.state?.reset, undefined);
  assert.equal(listHistory(database, MAIN_SESSION_KEY, NOW + 5).length, 1);
  assert.equal(historyClearedAt(database, MAIN_SESSION_KEY), undefined);
  assert.equal(listTranscript(database, MAIN_SESSION_KEY)[0]?.sessionId, "gen-1");
  // A checkpoint of the replaced lifetime lands nowhere, and cannot refill the fresh one.
  assert.equal(
    await store.write(lease, first.generationId, (state) => ({
      ...state,
      items: [{ type: "message", role: "user", content: "stale" }],
      transcript: [userText("stale")],
    })),
    false,
  );
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.items, []);
  assert.equal(searchTranscript(database, MAIN_SESSION_KEY, "stale").length, 0);
  database.close();
});

test("Delete history commits the archive with the removal, publishes and verifies it, and a restore preserves identities and refuses a newer live conversation", () => {
  const root = agentRoot();
  const database = openAt(root);
  const repo = repository(database);
  const gen = {
    ...freshBrainState("gen-1", NOW),
    checkpointFormat: "tool-loop@1:openai-responses-input/1",
    items: [{ type: "message", role: "user", content: SECRET }],
  };
  assert.equal(repo.save(gen, [userText(SECRET)]), true);
  appendHistory(
    database,
    MAIN_SESSION_KEY,
    [
      line("first words", NOW - 10, { eventId: "h1", kind: CONVERSATION_ENTRY_KIND.TYPED_ASK }),
      line("second words", NOW - 5, { eventId: "h2" }),
    ],
    NOW,
  );
  const deleted = deleteConversationHistory(database, root, MAIN_SESSION_KEY, NOW, {
    archiveId: "archive-1",
  });
  assert.ok(deleted);
  assert.equal(deleted.published, true);
  assert.equal(deleted.archive.historyLines, 2);
  assert.equal(deleted.archive.transcriptEvents, 1);
  assert.equal(deleted.archive.publishedAt !== undefined, true);
  assert.match(
    deleted.archive.fileName,
    /^agent_main_main\.jsonl\.deleted\.\d{4}-\d{2}-\d{2}T[\d.-]+Z\.archive1\.zst$/u,
  );
  const file = path.join(archiveDirectory(root), deleted.archive.fileName);
  assert.equal(fs.existsSync(file), true);
  // The rows are gone, the cutoff stands, and nothing of the old lifetime remains.
  assert.deepEqual(listHistory(database, MAIN_SESSION_KEY, NOW), []);
  assert.equal(listTranscript(database, MAIN_SESSION_KEY).length, 0);
  assert.equal(historyClearedAt(database, MAIN_SESSION_KEY), NOW);
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY), {});
  // A late line from before the deletion is refused by the cutoff.
  appendHistory(database, MAIN_SESSION_KEY, [line("late", NOW - 1, { eventId: "late" })], NOW + 1);
  assert.deepEqual(listHistory(database, MAIN_SESSION_KEY, NOW + 1), []);
  // The archive itself holds the words, compressed, and nowhere else does.
  const content = decodeArchiveContent(fs.readFileSync(file), deleted.archive.encoding);
  assert.match(content, /first words/u);
  assert.match(content, new RegExp(SECRET, "u"));
  assert.equal(searchTranscript(database, MAIN_SESSION_KEY, SECRET).length, 0);
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a publication a crash interrupted keeps its payload in the registry and is published at the next launch", () => {
  const root = agentRoot();
  const database = openAt(root);
  appendHistory(database, MAIN_SESSION_KEY, [line("words", NOW, { eventId: "h1" })], NOW);
  // The archive directory is a file, so the publication cannot land.
  fs.writeFileSync(archiveDirectory(root), "not a directory");
  const deleted = deleteConversationHistory(database, root, MAIN_SESSION_KEY, NOW, {
    archiveId: "archive-2",
  });
  assert.ok(deleted);
  assert.equal(deleted.published, false);
  assert.equal(deleted.archive.publishedAt, undefined);
  assert.deepEqual(listHistory(database, MAIN_SESSION_KEY, NOW), []);
  // The registry still holds the bytes until the publication lands.
  // SAFETY: length() of the payload column is one integer column named bytes.
  const held = database
    .prepare("SELECT length(payload) AS bytes FROM history_archives WHERE archive_id = ?")
    .get("archive-2") as { bytes: number };
  assert.ok(held.bytes > 0);
  database.close();
  // The next launch: the directory is a directory again, and the retry publishes.
  fs.rmSync(archiveDirectory(root));
  const relaunched = StoreDatabase.open(path.join(root, AGENT_DATABASE_FILE));
  assert.deepEqual(publishPendingArchives(relaunched, root), []);
  const [archive] = listArchives(relaunched);
  assert.ok(archive?.publishedAt !== undefined);
  assert.equal(fs.existsSync(path.join(archiveDirectory(root), archive.fileName)), true);
  // SAFETY: the payload column is the BLOB the deletion wrote, or NULL once published.
  const cleared = relaunched
    .prepare("SELECT payload FROM history_archives WHERE archive_id = ?")
    .get("archive-2") as { payload: Uint8Array | null };
  assert.equal(cleared.payload, null);
  relaunched.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a directory sync that fails is a publication that failed: the rows are gone, the payload stays for the retry, and the retry syncs the name that already exists before it lets the payload go", () => {
  const root = agentRoot();
  const database = openAt(root);
  appendHistory(database, MAIN_SESSION_KEY, [line("words", NOW, { eventId: "h1" })], NOW);
  let syncs = 0;
  const failing: PublicationDurability = {
    syncDirectory: () => {
      syncs += 1;
      throw Object.assign(new Error("EIO: directory sync failed"), { code: "EIO" });
    },
  };
  const deleted = deleteConversationHistory(database, root, MAIN_SESSION_KEY, NOW, {
    archiveId: "archive-4",
    durability: failing,
  });
  assert.ok(deleted);
  assert.equal(deleted.published, false);
  assert.equal(syncs, 1);
  assert.deepEqual(listHistory(database, MAIN_SESSION_KEY, NOW), []);
  // The name was linked before the sync failed, and the payload was not let go of.
  const target = path.join(archiveDirectory(root), deleted.archive.fileName);
  assert.equal(fs.existsSync(target), true);
  // SAFETY: the payload column is the BLOB the deletion wrote, or NULL once published.
  const held = database
    .prepare("SELECT payload, published_at FROM history_archives WHERE archive_id = ?")
    .get("archive-4") as { payload: Uint8Array | null; published_at: number | null };
  assert.ok(held.payload);
  assert.equal(held.published_at, null);
  // A retry over the existing name still runs the directory sync, and a
  // second failure there still keeps the payload.
  assert.deepEqual(publishPendingArchives(database, root, failing), ["archive-4"]);
  assert.equal(syncs, 2);
  // Once the sync succeeds, and only then, the publication counts and the payload goes.
  let synced = 0;
  const counting: PublicationDurability = {
    syncDirectory: (directory) => {
      synced += 1;
      FILE_SYSTEM_DURABILITY.syncDirectory(directory);
    },
  };
  assert.deepEqual(publishPendingArchives(database, root, counting), []);
  assert.equal(synced, 1);
  // SAFETY: the payload column is the BLOB the deletion wrote, or NULL once published, beside its publication instant.
  const cleared = database
    .prepare("SELECT payload, published_at FROM history_archives WHERE archive_id = ?")
    .get("archive-4") as { payload: Uint8Array | null; published_at: number | null };
  assert.equal(cleared.payload, null);
  assert.ok(cleared.published_at !== null);
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a deletion takes what stood at or before its instant and every lifetime but the one named, so a line and a lifetime begun after the press survive it", () => {
  const root = agentRoot();
  const database = openAt(root);
  const repo = repository(database);
  assert.equal(
    repo.save({ ...freshBrainState("gen-old", NOW - 10), items: [userMessageItem(SECRET)] }),
    true,
  );
  appendHistory(
    database,
    MAIN_SESSION_KEY,
    [line("before", NOW - 5, { eventId: "h-before" })],
    NOW - 5,
  );
  // The fence at NOW: the successor lifetime carrying the marker replaces the old one...
  assert.equal(
    repo.save({
      ...freshBrainState("gen-new", NOW),
      reset: { clearedAt: NOW, generationId: "gen-old" },
    }),
    true,
  );
  // ...and a line lands a beat after the press, while the deletion waits.
  appendHistory(
    database,
    MAIN_SESSION_KEY,
    [line("after", NOW + 1, { eventId: "h-after" })],
    NOW + 1,
  );
  const deleted = deleteConversationHistory(database, root, MAIN_SESSION_KEY, NOW, {
    archiveId: "archive-5",
    keepSessionId: "gen-new",
  });
  assert.ok(deleted);
  assert.equal(deleted.archive.historyLines, 1);
  assert.deepEqual(
    listHistory(database, MAIN_SESSION_KEY, NOW + 1).map((entry) => entry.words),
    ["after"],
  );
  assert.equal(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.generationId, "gen-new");
  assert.equal(historyClearedAt(database, MAIN_SESSION_KEY), NOW);
  // Unnamed, every lifetime goes: the maintenance removal of a conversation nobody is in.
  assert.ok(
    deleteConversationHistory(database, root, MAIN_SESSION_KEY, NOW + 2, {
      archiveId: "archive-6",
    }),
  );
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY), {});
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("the maintenance policy: protections, the idle-thread and stale rules, the cap's order, and the disk budget's positive eligibility", () => {
  const protections = { preserve: new Set<SessionKey>([sessionKey("agent:main:thread:busy")]) };
  const main = record("agent:main:main", { kind: CONVERSATION_KIND.MAIN });
  const pinned = record("agent:main:thread:pinned", { pinnedAt: NOW });
  const busy = record("agent:main:thread:busy");
  const idle = record("agent:main:thread:idle", {
    lastActivityAt: NOW - 8 * DAY,
    createdAt: NOW - 8 * DAY,
  });
  const recent = record("agent:main:thread:recent", {
    lastActivityAt: NOW - DAY,
    createdAt: NOW - DAY,
  });
  const forgotten = record("agent:main:thread:forgotten", {
    lastActivityAt: NOW - 40 * DAY,
    createdAt: NOW - 40 * DAY,
  });
  const unknown = record("agent:main:cron:nightly", { kind: CONVERSATION_KIND.UNKNOWN });
  const archivedByCap = record("agent:main:thread:capped", {
    archivedAt: NOW - DAY,
    archiveReason: ARCHIVE_REASON.ACTIVE_SESSION_CAP,
  });
  const archivedByUser = record("agent:main:thread:shelved", {
    archivedAt: NOW - 2 * DAY,
    archiveReason: ARCHIVE_REASON.USER,
  });
  const all = [main, pinned, busy, idle, recent, forgotten, unknown, archivedByCap, archivedByUser];

  // Idle threads: only private threads, judged by their latest activity; protected ones never.
  assert.deepEqual(
    idleThreadVictims(
      all,
      NOW,
      HISTORY_MAINTENANCE_DEFAULTS.idleThreadArchiveAfterMs,
      protections,
    ).map((r) => r.sessionKey),
    [idle.sessionKey, forgotten.sessionKey],
  );
  // Stale: archived in place; protected rows, archived rows, and a key this build cannot classify are left alone.
  assert.deepEqual(
    staleVictims(all, NOW, HISTORY_MAINTENANCE_DEFAULTS.staleAfterMs, protections).map(
      (r) => r.sessionKey,
    ),
    [forgotten.sessionKey],
  );
  // The cap counts unarchived rows only, never protected ones as victims, longest untouched first, later insertion winning ties.
  const tieA = record("agent:main:thread:tie-a", {
    lastActivityAt: NOW - 3 * DAY,
    createdAt: NOW - 3 * DAY,
  });
  const tieB = record("agent:main:thread:tie-b", {
    lastActivityAt: NOW - 3 * DAY,
    createdAt: NOW - 3 * DAY,
  });
  const capped = capVictims([main, pinned, busy, tieA, tieB, recent, unknown], 2, protections);
  assert.deepEqual(
    capped.map((r) => r.sessionKey),
    [tieB.sessionKey, tieA.sessionKey, recent.sessionKey],
  );
  // Protected rows alone past the cap leave the directory above it.
  assert.deepEqual(capVictims([main, pinned, busy, unknown], 1, protections), []);
  // The disk budget may delete only the cap's own archives, oldest archived first.
  assert.deepEqual(
    diskBudgetVictims(all, protections).map((r) => r.sessionKey),
    [archivedByCap.sessionKey],
  );
  assert.deepEqual(diskBudgetVictims([{ ...archivedByCap, pinnedAt: NOW }], protections), []);
  // The batched trigger: a large cap waits for its slack, a tiny one is strict.
  assert.equal(shouldRunEntryMaintenance(5_000, 5_000), false);
  assert.equal(shouldRunEntryMaintenance(5_500, 5_000), true);
  assert.equal(shouldRunEntryMaintenance(11, 10), true);
  assert.equal(shouldRunEntryMaintenance(0, 5_000, true), true);
  assert.deepEqual(
    [
      HISTORY_MAINTENANCE_DEFAULTS.staleAfterMs,
      HISTORY_MAINTENANCE_DEFAULTS.idleThreadArchiveAfterMs,
      HISTORY_MAINTENANCE_DEFAULTS.maximumUnarchived,
      HISTORY_MAINTENANCE_DEFAULTS.maximumDiskBytes,
      HISTORY_MAINTENANCE_DEFAULTS.highWaterBytes,
    ],
    [30 * DAY, 7 * DAY, 5_000, 10 * 1024 ** 3, 8 * 1024 ** 3],
  );
});

test("a maintenance pass archives idle and stale threads in place, keeps a key it cannot classify, caps by activity, and its disk budget deletes only cap-archived rows and reports what protection left standing", () => {
  const root = agentRoot();
  const database = openAt(root);
  const thread = (name: string, ageMs: number) => {
    const key = threadSessionKey(name);
    createConversation(database, {
      agentId: DEFAULT_AGENT_ID,
      sessionKey: key,
      name,
      now: NOW - ageMs,
    });
    appendHistory(
      database,
      key,
      [line(`${name} words`, NOW - ageMs, { eventId: `${name}-1` })],
      NOW - ageMs,
    );
    return key;
  };
  const idle = thread("idle", 8 * DAY);
  const stale = thread("stale", 40 * DAY);
  const fresh = thread("fresh", DAY);
  const pinned = thread("pinned", 50 * DAY);
  pinConversation(database, pinned, NOW);
  const unknown = sessionKey("agent:main:cron:nightly");
  createConversation(database, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: unknown,
    name: "unclassified",
    now: NOW - 40 * DAY,
  });
  appendHistory(
    database,
    MAIN_SESSION_KEY,
    [line("main words", NOW - 60 * DAY, { eventId: "m1" })],
    NOW - 60 * DAY,
  );

  const report = runHistoryMaintenance(database, root, { now: NOW, preserve: [] });
  // The idle-thread rule runs before the stale rule, as the pinned source
  // orders its boundaries, so a thread past both is archived as idle.
  assert.equal(report.archivedIdleThreads, 2);
  assert.equal(report.archivedStale, 0);
  const byKey = new Map(listConversations(database).map((r) => [r.sessionKey, r]));
  assert.equal(byKey.get(idle)?.archiveReason, ARCHIVE_REASON.IDLE_THREAD);
  assert.equal(byKey.get(stale)?.archiveReason, ARCHIVE_REASON.IDLE_THREAD);
  assert.equal(byKey.get(fresh)?.archivedAt, undefined);
  assert.equal(byKey.get(pinned)?.archivedAt, undefined);
  assert.equal(byKey.get(MAIN_SESSION_KEY)?.archivedAt, undefined);
  assert.equal(byKey.get(unknown)?.archivedAt, undefined);
  // Archived in place: the history rows are still there, whatever the thread's own age retention shows.
  assert.equal(inspectHistory(database, stale).count, 1);

  // The cap, forced: only unarchived rows count, and the longest untouched eligible one goes.
  const capped = runHistoryMaintenance(database, root, {
    now: NOW,
    preserve: [],
    force: true,
    config: { maximumUnarchived: 2 },
  });
  assert.equal(capped.archivedByCap, 1);
  const afterCap = new Map(listConversations(database).map((r) => [r.sessionKey, r]));
  assert.equal(afterCap.get(fresh)?.archiveReason, ARCHIVE_REASON.ACTIVE_SESSION_CAP);
  assert.equal(afterCap.get(pinned)?.archivedAt, undefined);

  // Disk pressure with a budget the database already exceeds: the cap's
  // archive is deleted through the recoverable process; the age and idle
  // archives, main, and the pinned thread survive; the pressure that remains
  // is reported rather than resolved by deleting protected history.
  const usage = measurePhysicalUsage(root, AGENT_DATABASE_FILE);
  const pressured = runHistoryMaintenance(database, root, {
    now: NOW,
    preserve: [],
    config: { maximumDiskBytes: 1, highWaterBytes: 1 },
    createArchiveId: () => "capped-archive",
  });
  assert.ok(usage.totalBytes > 1);
  assert.ok(pressured.disk);
  assert.equal(pressured.disk.overBudget, true);
  assert.equal(pressured.disk.deletedConversations, 1);
  assert.ok(pressured.disk.remainingPressureBytes > 0);
  const survivors = listConversations(database).map((r) => r.sessionKey);
  assert.deepEqual(new Set(survivors), new Set([MAIN_SESSION_KEY, idle, stale, pinned, unknown]));
  assert.equal(inspectHistory(database, stale).count, 1);
  assert.equal(inspectHistory(database, MAIN_SESSION_KEY).count, 1);
  assert.equal(listArchives(database).length, 1);
  assert.equal(listArchives(database)[0]?.sessionKey, fresh);
  assert.equal(archiveConversation(database, MAIN_SESSION_KEY, NOW, ARCHIVE_REASON.USER), false);
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("SQLite checkpoints survive their former fortnight deadline until explicitly reset", async () => {
  const root = agentRoot();
  const database = openAt(root);
  try {
    const prior = {
      ...freshBrainState("existing-lifetime", NOW),
      items: [{ type: "message", role: "user", content: "existing context" }],
    };
    assert.equal(repository(database).save(prior), true);
    const store = new BrainStateStore({
      repository: repository(database),
      createGenerationId: () => "manual-successor",
      now: () => NOW + 60 * DAY,
    });
    assert.equal((await store.load()).generationId, prior.generationId);
    assert.deepEqual(store.current()?.items, prior.items);
    assert.equal(store.expireIfDue(NOW + 90 * DAY), false);
    assert.equal(
      loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.generationId,
      prior.generationId,
    );
    assert.equal(await store.reset(NOW + 90 * DAY), true);
    assert.equal(
      loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.generationId,
      "manual-successor",
    );
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("canonical history retains old and overflow lines while the existing panel projection stays bounded", () => {
  const root = agentRoot();
  const database = openAt(root);
  try {
    const now = NOW + 30 * DAY;
    const old = line("old voice-only history", NOW, { eventId: "old-voice" });
    appendHistory(database, MAIN_SESSION_KEY, [old], NOW);
    const recent = Array.from({ length: 205 }, (_, i) =>
      line(`recent ${i}`, now - 205 + i, { eventId: `recent-${i}` }),
    );
    appendHistory(database, MAIN_SESSION_KEY, recent, now);
    assert.equal(listHistory(database, MAIN_SESSION_KEY, now).length, 200);
    const archived = deleteConversationHistory(database, root, MAIN_SESSION_KEY, now);
    assert.ok(archived?.published);
    assert.equal(archived.archive.historyLines, 206);
    const content = decodeArchiveContent(
      fs.readFileSync(path.join(archiveDirectory(root), archived.archive.fileName)),
      archived.archive.encoding,
    );
    assert.ok(content.includes("old voice-only history"));
    assert.ok(content.includes('"words":"recent 0"'));
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
