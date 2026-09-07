import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BRAIN_REQUEST_STATUS,
  type BrainPersistedState,
  BrainStateStore,
  freshBrainState,
} from "@sidecar/brain";
import {
  CONVERSATION_ENTRY_KIND,
  maximumStoredConversationEntries,
  storedConversationMaximumAgeMs,
} from "@sidecar/realtime";
import { MAIN_SESSION_KEY } from "@sidecar/runtime-contracts";
import { loadBrainEnvelope, saveBrainEnvelope } from "./brain-envelope.js";
import { RuntimeDatabase } from "./database.js";
import { EnvelopeTracker, SAVE_KIND } from "./envelope.js";
import { personalFacts, replacePersonalFacts } from "./facts-table.js";
import {
  appendHistory,
  clearHistoryAtOrBefore,
  historyClearedAt,
  listHistory,
} from "./history-table.js";
import { inspectHistory, line, NOW, openTestDatabase, populatedState, request } from "./testing.js";

/** A repository over the database in-thread, tracking the last envelope it saw land as the client does. */
function repository(database: RuntimeDatabase) {
  const tracker = new EnvelopeTracker();
  tracker.observe(loadBrainEnvelope(database, MAIN_SESSION_KEY));
  return {
    load: () => {
      const loaded = loadBrainEnvelope(database, MAIN_SESSION_KEY);
      tracker.observe(loaded);
      return loaded;
    },
    save: (state: BrainPersistedState) => {
      const landed = saveBrainEnvelope(database, MAIN_SESSION_KEY, tracker.saveFor(state));
      if (landed) tracker.landed(state);
      return landed;
    },
  };
}

test("the envelope round-trips through the tables, requests and receipts in their order", () => {
  const database = openTestDatabase();
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY), {});
  const state = populatedState("gen-1");
  assert.equal(
    saveBrainEnvelope(database, MAIN_SESSION_KEY, { kind: SAVE_KIND.REPLACE, state: state }),
    true,
  );
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY), {
    state,
    generation: state.generationId,
  });
  const marked = { ...state, reset: { clearedAt: NOW - 5, generationId: "gen-0" } };
  assert.equal(
    saveBrainEnvelope(database, MAIN_SESSION_KEY, {
      kind: SAVE_KIND.REPLACE,
      expectGeneration: "gen-1",
      state: marked,
    }),
    true,
  );
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.reset, marked.reset);
});

test("deltas leave the tables holding exactly the envelope given, checkpoint by checkpoint", () => {
  const database = openTestDatabase();
  const repo = repository(database);
  let state = populatedState("gen-1");
  assert.equal(repo.save(state), true);
  state = {
    ...state,
    items: [...state.items, { type: "message", role: "assistant", content: "x" }],
  };
  assert.equal(repo.save(state), true);
  state = {
    ...state,
    items: state.items.slice(0, 2),
    cursors: {},
    requests: [request("run-2", { status: BRAIN_REQUEST_STATUS.CANCELLED, revision: 4 })],
    journal: [],
  };
  assert.equal(repo.save(state), true);
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY), {
    state,
    generation: state.generationId,
  });
});

test("a stale handle cannot save over a newer generation, whole or by delta, and stays refused until it loads again", () => {
  const database = openTestDatabase();
  const first = repository(database);
  const second = repository(database);
  const gen1 = populatedState("gen-1");
  assert.equal(first.save(gen1), true);
  assert.deepEqual(second.load().state, gen1);
  // The second handle replaces the generation on purpose, naming the one it replaces.
  const gen2 = freshBrainState("gen-2", NOW + 10);
  assert.equal(second.save(gen2), true);
  // The first handle's picture is gen-1: its checkpoint of gen-1 lands nowhere...
  const staleDelta = { ...gen1, cursors: { codex: { "session-z": "late" } } };
  assert.equal(first.save(staleDelta), false);
  // ...and neither does a whole envelope it composes, because it names gen-1 as what stands.
  assert.equal(first.save(freshBrainState("gen-3", NOW + 20)), false);
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state, gen2);
  // Loading again brings the handle's picture current, and it may write once more.
  first.load();
  assert.equal(first.save({ ...gen2, cursors: { codex: { "session-z": "now" } } }), true);
  // A handle that believes nothing stands is refused too when something does.
  const third = repository(openTestDatabase());
  assert.equal(
    saveBrainEnvelope(database, MAIN_SESSION_KEY, { kind: SAVE_KIND.REPLACE, state: gen1 }),
    false,
  );
  assert.equal(third.save(gen1), true);
});

test("the BrainStateStore keeps its lease, fence, and Clear guarantees over the database repository", async () => {
  const database = openTestDatabase();
  let ids = 0;
  const store = new BrainStateStore({
    repository: repository(database),
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  const loaded = await store.load();
  assert.equal(loaded.generationId, "gen-1");
  const lease = store.lease();
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      cursors: { codex: { s: "c" } },
      requests: [request("run-1")],
    })),
    true,
  );
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.cursors, {
    codex: { s: "c" },
  });
  // A later lease releases the earlier one; the old writer's checkpoint lands nowhere.
  const later = store.lease();
  assert.equal(await store.write(lease, "gen-1", (state) => ({ ...state, cursors: {} })), false);
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.cursors, {
    codex: { s: "c" },
  });
  // The Clear fences synchronously and writes the marker over the old content.
  const cleared = store.clear(NOW + 1);
  assert.equal(store.holdsGeneration("gen-1"), false);
  assert.equal(await cleared, true);
  const after = loadBrainEnvelope(database, MAIN_SESSION_KEY).state;
  assert.equal(after?.generationId, "gen-2");
  assert.deepEqual(after?.reset, { clearedAt: NOW + 1, generationId: "gen-1" });
  assert.deepEqual(after?.requests, []);
  assert.equal(await store.write(later, "gen-1", (state) => state), false);
});

test("history appends are idempotent on the line's own id, and two identical utterances with ids of their own are two lines", () => {
  const database = openTestDatabase();
  const one = line("run the tests", NOW, {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    eventId: "e1",
  });
  const again = line("run the tests", NOW, {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    eventId: "e2",
  });
  const first = appendHistory(database, MAIN_SESSION_KEY, [one], NOW);
  assert.equal(first.changed, true);
  const repeated = appendHistory(database, MAIN_SESSION_KEY, [one, one], NOW);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.entries, [one]);
  const second = appendHistory(database, MAIN_SESSION_KEY, [again], NOW);
  assert.deepEqual(second.entries, [one, again]);
  // A line without an id is identified by its value: delivered twice, it is one line.
  const anonymous = line("no id", NOW + 1);
  appendHistory(database, MAIN_SESSION_KEY, [anonymous, anonymous], NOW + 1);
  assert.equal(inspectHistory(database, MAIN_SESSION_KEY).count, 3);
});

test("a line learns the run it opened, and a run's ask and end are each published once", () => {
  const database = openTestDatabase();
  const spoken = line("what is running", NOW, {
    kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK,
    eventId: "s1",
  });
  appendHistory(database, MAIN_SESSION_KEY, [spoken], NOW);
  const tied = { ...spoken, requestId: "run-1" };
  const enriched = appendHistory(database, MAIN_SESSION_KEY, [tied], NOW);
  assert.equal(enriched.changed, true);
  assert.deepEqual(enriched.entries, [tied]);
  // Another window's copy of the same ask under another id is the same publication, and is refused.
  const duplicateAsk = { ...tied, eventId: "s1-other-window" };
  assert.equal(appendHistory(database, MAIN_SESSION_KEY, [duplicateAsk], NOW).changed, false);
  const reply = line("two agents", NOW + 1, { requestId: "run-1", eventId: "r1" });
  const replyAgain = line("two agents", NOW + 2, { requestId: "run-1", eventId: "r1-late" });
  const published = appendHistory(database, MAIN_SESSION_KEY, [reply, replyAgain], NOW + 2);
  assert.deepEqual(published.entries, [tied, reply]);
});

test("the sequence counts up and is never reused after retention or a Clear", () => {
  const database = openTestDatabase();
  appendHistory(database, MAIN_SESSION_KEY, [line("a", NOW - 10, { eventId: "a" })], NOW);
  appendHistory(database, MAIN_SESSION_KEY, [line("b", NOW - 5, { eventId: "b" })], NOW);
  clearHistoryAtOrBefore(database, MAIN_SESSION_KEY, NOW);
  assert.equal(inspectHistory(database, MAIN_SESSION_KEY).count, 0);
  appendHistory(database, MAIN_SESSION_KEY, [line("c", NOW + 1, { eventId: "c" })], NOW + 1);
  const sequences = inspectHistory(database, MAIN_SESSION_KEY).sequences;
  assert.deepEqual(sequences, [3]);
});

test("retention keeps the 200 most recent lines and nothing older than a fortnight, judged at the append", () => {
  const database = openTestDatabase();
  const old = line("old", NOW - storedConversationMaximumAgeMs - 1, { eventId: "old" });
  const many = Array.from({ length: maximumStoredConversationEntries + 10 }, (_, index) =>
    line(`line ${index}`, NOW - 1000 + index, { eventId: `m${index}` }),
  );
  const outcome = appendHistory(database, MAIN_SESSION_KEY, [old, ...many], NOW);
  assert.equal(outcome.entries.length, maximumStoredConversationEntries);
  assert.equal(outcome.entries[0]?.words, "line 10");
  assert.equal(inspectHistory(database, MAIN_SESSION_KEY).count, maximumStoredConversationEntries);
  // A line stamped in the future is not admitted: the thread's clock is the store's.
  assert.equal(
    appendHistory(database, MAIN_SESSION_KEY, [line("soon", NOW + 1, { eventId: "f" })], NOW)
      .changed,
    false,
  );
});

test("a brain generation's expiry erases no visible history; only the Clear reaches both", () => {
  const database = openTestDatabase();
  const gen1 = populatedState("gen-1");
  saveBrainEnvelope(database, MAIN_SESSION_KEY, { kind: SAVE_KIND.REPLACE, state: gen1 });
  const said = line("said under gen-1", NOW, { eventId: "h1" });
  appendHistory(database, MAIN_SESSION_KEY, [said], NOW);
  // The generation runs out and an empty successor replaces it: its rows cascade away...
  const later = NOW + BRAIN_GENERATION_LIFETIME_MS;
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-1",
    state: freshBrainState("gen-2", later),
  });
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.requests, []);
  // ...while the thread keeps its lines under its own retention, still attributed to gen-1.
  assert.deepEqual(listHistory(database, MAIN_SESSION_KEY, NOW + 1), [said]);
  assert.deepEqual(inspectHistory(database, MAIN_SESSION_KEY).sessionIds, ["gen-1"]);
  // The Clear writes the marker into the successor and erases the lines at or before it.
  const clearedAt = NOW + 2;
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-2",
    state: { ...freshBrainState("gen-3", clearedAt), reset: { clearedAt, generationId: "gen-2" } },
  });
  clearHistoryAtOrBefore(database, MAIN_SESSION_KEY, clearedAt);
  assert.deepEqual(listHistory(database, MAIN_SESSION_KEY, NOW + 3), []);
  // A late line from before the Clear is refused by the standing marker even though the rows are gone.
  assert.equal(
    appendHistory(database, MAIN_SESSION_KEY, [line("late", NOW + 1, { eventId: "late" })], NOW + 3)
      .changed,
    false,
  );
  assert.equal(
    appendHistory(database, MAIN_SESSION_KEY, [line("new", NOW + 3, { eventId: "new" })], NOW + 3)
      .changed,
    true,
  );
});

test("the remembered facts have one writer here: the whole list, within its cap, or nothing", () => {
  const database = openTestDatabase();
  assert.deepEqual(personalFacts(database), []);
  assert.equal(
    replacePersonalFacts(database, [{ id: "f1", words: "prefers short replies" }]),
    true,
  );
  assert.equal(
    replacePersonalFacts(database, [
      { id: "f1", words: "a" },
      { id: "f2", words: "a" },
    ]),
    false,
  );
  assert.deepEqual(personalFacts(database), [{ id: "f1", words: "prefers short replies" }]);
  const tooMany = Array.from({ length: 33 }, (_, i) => ({ id: `id-${i}`, words: `fact ${i}` }));
  assert.equal(replacePersonalFacts(database, tooMany), false);
  assert.equal(replacePersonalFacts(database, []), true);
  assert.deepEqual(personalFacts(database), []);
});

test("a generation whose rows this build cannot read is repaired by the store that observed it, and by no stale writer", async () => {
  const location = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "luke-corrupt-")),
    "agent.sqlite",
  );
  const database = openTestDatabase(location);
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    state: populatedState("gen-old"),
  });
  const stale = repository(database);
  // One checkpoint item is corrupted on disk, beneath everything.
  const raw = new DatabaseSync(location);
  raw.prepare("UPDATE runtime_checkpoints SET item = '{not json' WHERE sequence = 1").run();
  raw.close();
  const loaded = loadBrainEnvelope(database, MAIN_SESSION_KEY);
  assert.deepEqual(loaded, { unreadable: true, generation: "gen-old" });
  // The store begins a fresh generation in place of the unreadable one and
  // its repair lands, because the repository names the generation it observed.
  let ids = 0;
  const reports: string[] = [];
  const store = new BrainStateStore({
    repository: repository(database),
    createGenerationId: () => `gen-repaired-${++ids}`,
    now: () => NOW,
    report: (message) => reports.push(message),
  });
  const fresh = await store.load();
  await store.flush();
  assert.equal(fresh.generationId, "gen-repaired-1");
  assert.deepEqual(reports, ["Brain memory discarded an unreadable state file"]);
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state, fresh);
  const lease = store.lease();
  assert.equal(
    await store.write(lease, fresh.generationId, (state) => ({
      ...state,
      cursors: { codex: { s: "c" } },
    })),
    true,
  );
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.cursors, {
    codex: { s: "c" },
  });
  // The handle that still pictures gen-old cannot replace the repair.
  assert.equal(stale.save(freshBrainState("gen-intruder", NOW)), false);
  assert.equal(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.generationId, "gen-repaired-1");
  database.close();
});

test("the Clear's cutoff outlives the generation that carried its marker, at the exact expiry instant included", () => {
  const database = openTestDatabase();
  const cutoff = NOW;
  const atCutoff = line("AT_CUTOFF", cutoff, { eventId: "at" });
  appendHistory(database, MAIN_SESSION_KEY, [atCutoff], cutoff);
  // The Clear's marker lands; the thread's erasure does not (the disk refused it).
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    state: { ...freshBrainState("gen-cleared", cutoff), reset: { clearedAt: cutoff } },
  });
  assert.deepEqual(listHistory(database, MAIN_SESSION_KEY, cutoff + 1), []);
  // The marker's generation expires and an unmarked successor replaces it at exactly cutoff + lifetime,
  // when the retained-age comparison alone would still admit a line stamped at the cutoff.
  const expiry = cutoff + BRAIN_GENERATION_LIFETIME_MS;
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-cleared",
    state: freshBrainState("gen-after", expiry),
  });
  assert.equal(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.reset, undefined);
  assert.equal(historyClearedAt(database, MAIN_SESSION_KEY), cutoff);
  assert.deepEqual(listHistory(database, MAIN_SESSION_KEY, expiry), []);
  assert.equal(appendHistory(database, MAIN_SESSION_KEY, [atCutoff], expiry).changed, false);
  // A later Clear only raises the cutoff; an older marker never lowers it.
  clearHistoryAtOrBefore(database, MAIN_SESSION_KEY, expiry + 5);
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-after",
    state: { ...freshBrainState("gen-late", expiry + 6), reset: { clearedAt: cutoff } },
  });
  assert.equal(historyClearedAt(database, MAIN_SESSION_KEY), expiry + 5);
});

test("the reproduced boundary: marker written, erase failed, store load at exactly cutoff + lifetime, then a relaunch — the erased line never projects", async () => {
  const location = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "luke-boundary-")),
    "agent.sqlite",
  );
  const cutoff = NOW;
  let clock = cutoff;
  let ids = 0;
  const first = openTestDatabase(location);
  appendHistory(
    first,
    MAIN_SESSION_KEY,
    [line("ERASED_SYNTHETIC", cutoff, { eventId: "e" })],
    cutoff,
  );
  const store = new BrainStateStore({
    repository: repository(first),
    createGenerationId: () => `gen-${++ids}`,
    now: () => clock,
  });
  await store.load();
  // The Clear: the marker lands, the erasure is never asked for (the disk refused it).
  assert.equal(await store.clear(cutoff), true);
  assert.deepEqual(listHistory(first, MAIN_SESSION_KEY, cutoff + 1), []);
  // Exactly one lifetime later the marked generation expires through the store itself.
  clock = cutoff + BRAIN_GENERATION_LIFETIME_MS;
  assert.equal(store.expireIfDue(clock), true);
  await store.flush();
  assert.equal(loadBrainEnvelope(first, MAIN_SESSION_KEY).state?.reset, undefined);
  assert.deepEqual(listHistory(first, MAIN_SESSION_KEY, clock), []);
  first.close();
  // The next launch opens the same file: the cutoff is the conversation's, not the dead generation's.
  const relaunch = RuntimeDatabase.open(location);
  assert.equal(historyClearedAt(relaunch, MAIN_SESSION_KEY), cutoff);
  assert.deepEqual(listHistory(relaunch, MAIN_SESSION_KEY, clock), []);
  assert.deepEqual(listHistory(relaunch, MAIN_SESSION_KEY, clock + 1), []);
  assert.equal(
    appendHistory(
      relaunch,
      MAIN_SESSION_KEY,
      [line("ERASED_SYNTHETIC", cutoff, { eventId: "e2" })],
      clock,
    ).changed,
    false,
  );
  relaunch.close();
});

test("a line keeps its Markdown line structure through the store and a relaunch", () => {
  const location = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "luke-multiline-")),
    "agent.sqlite",
  );
  const words = "Two things:\n\n- first\n- second\n\n```ts\nconst x = 1;\n```";
  const database = openTestDatabase(location);
  const appended = appendHistory(
    database,
    MAIN_SESSION_KEY,
    [line(words, NOW, { eventId: "multiline" })],
    NOW,
  );
  assert.equal(appended.entries[0]?.words, words);
  database.close();
  const relaunch = RuntimeDatabase.open(location);
  assert.equal(listHistory(relaunch, MAIN_SESSION_KEY, NOW)[0]?.words, words);
  relaunch.close();
});

test("the checkpoint stamp lives on the generation: an empty foreign checkpoint keeps it, a delta may set it, and a stray item stamp is unreadable", () => {
  const database = openTestDatabase();
  const foreign = "other-runtime@3:anthropic-messages/2";
  const empty = { ...populatedState("gen-f"), checkpointFormat: foreign, items: [] };
  assert.equal(
    saveBrainEnvelope(database, MAIN_SESSION_KEY, { kind: SAVE_KIND.REPLACE, state: empty }),
    true,
  );
  const loaded = loadBrainEnvelope(database, MAIN_SESSION_KEY);
  assert.equal(loaded.state?.checkpointFormat, foreign);
  assert.deepEqual(loaded.state?.items, []);
  // A native runtime later writing into the same generation stamps it its own.
  const native = "tool-loop@1:openai-responses-input/1";
  assert.equal(
    saveBrainEnvelope(database, MAIN_SESSION_KEY, {
      kind: SAVE_KIND.AMEND,
      generationId: "gen-f",
      delta: {
        checkpointFormat: native,
        items: { keepPrefix: 0, append: [{ type: "message", role: "user", content: "hi" }] },
      },
    }),
    true,
  );
  const restamped = loadBrainEnvelope(database, MAIN_SESSION_KEY);
  assert.equal(restamped.state?.checkpointFormat, native);
  assert.equal(restamped.state?.items.length, 1);
  // An item row of another stamp than the generation's is not its checkpoint.
  database
    .prepare("UPDATE runtime_checkpoints SET format = ? WHERE session_id = ?")
    .run(foreign, "gen-f");
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY), {
    unreadable: true,
    generation: "gen-f",
  });
});

test("a version-1 database is walked forward: its item-tagged generation gains the legacy stamp, an empty one none, and a newer database is refused", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-runtime-store-"));
  const location = path.join(directory, "agent.sqlite");
  const raw = new DatabaseSync(location);
  raw.exec(`CREATE TABLE schema_version (version INTEGER NOT NULL)`);
  raw.exec(`INSERT INTO schema_version (version) VALUES (1)`);
  raw.exec(`CREATE TABLE agents (agent_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`);
  raw.exec(`CREATE TABLE conversations (
    session_key TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(agent_id),
    name TEXT NOT NULL, created_at INTEGER NOT NULL,
    next_history_sequence INTEGER NOT NULL DEFAULT 1, history_cleared_at INTEGER)`);
  raw.exec(`CREATE TABLE conversation_sessions (
    session_id TEXT PRIMARY KEY, session_key TEXT NOT NULL REFERENCES conversations(session_key),
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    reset_cleared_at INTEGER, reset_generation_id TEXT)`);
  raw.exec(`CREATE TABLE runtime_checkpoints (
    session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, format TEXT NOT NULL, item TEXT NOT NULL,
    PRIMARY KEY (session_id, sequence))`);
  raw.prepare("INSERT INTO agents VALUES (?, ?)").run("main", NOW);
  raw
    .prepare(
      "INSERT INTO conversations (session_key, agent_id, name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(MAIN_SESSION_KEY, "main", "main", NOW);
  const lifetime = 14 * 24 * 60 * 60 * 1000;
  raw
    .prepare(
      "INSERT INTO conversation_sessions (session_id, session_key, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run("gen-old", MAIN_SESSION_KEY, NOW, NOW + lifetime);
  raw
    .prepare("INSERT INTO runtime_checkpoints VALUES (?, ?, ?, ?)")
    .run(
      "gen-old",
      0,
      "openai-responses-input/1",
      JSON.stringify({ type: "message", role: "user", content: "x" }),
    );
  raw.close();

  const database = RuntimeDatabase.open(location);
  const loaded = loadBrainEnvelope(database, MAIN_SESSION_KEY);
  assert.equal(loaded.state?.checkpointFormat, "tool-loop@1:openai-responses-input/1");
  assert.equal(loaded.state?.items.length, 1);
  // SAFETY: the schema_version table has one integer column.
  const version = database.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  assert.equal(version.version, 2);
  database.close();
  // Reopening at the current version is a no-op, and a newer database is refused.
  RuntimeDatabase.open(location).close();
  const newer = new DatabaseSync(location);
  newer.exec("UPDATE schema_version SET version = 99");
  newer.close();
  assert.throws(() => RuntimeDatabase.open(location), /schema version 99/u);
  fs.rmSync(directory, { recursive: true, force: true });
});
