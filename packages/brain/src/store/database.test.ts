import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_AGENT_ID, MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import {
  CONVERSATION_ENTRY_KIND,
  maximumStoredConversationEntries,
  storedConversationMaximumAgeMs,
} from "@sidecar/session";
import { test } from "vitest";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  type BrainPersistedState,
  freshBrainState,
} from "../envelope.js";
import { BRAIN_REQUEST_STATUS } from "../requests.js";
import { BrainStateStore } from "../state-store.js";
import { deleteConversation } from "./archives.js";
import { loadBrainEnvelope, saveBrainEnvelope } from "./brain-envelope.js";
import {
  appendConversation,
  CONVERSATION_SEARCH_MAXIMUM_SCANNED_ROWS,
  conversationClearedAt,
  listConversation,
  searchConversation,
} from "./conversation-table.js";
import { createConversation, raiseConversationCutoff } from "./conversations-table.js";
import { StoreDatabase } from "./database.js";
import { EnvelopeTracker, SAVE_KIND } from "./envelope.js";
import { STORE_SCHEMA_VERSION } from "./schema.js";
import {
  inspectConversation,
  line,
  NOW,
  openTestDatabase,
  populatedState,
  request,
} from "./testing.js";

/** A repository over the database in-thread, tracking the last envelope it saw land as the client does. */
function repository(database: StoreDatabase) {
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
    kind: CONVERSATION_ENTRY_KIND.ASK,
    eventId: "e1",
  });
  const again = line("run the tests", NOW, {
    kind: CONVERSATION_ENTRY_KIND.ASK,
    eventId: "e2",
  });
  const first = appendConversation(database, MAIN_SESSION_KEY, [one], NOW);
  assert.equal(first.changed, true);
  const repeated = appendConversation(database, MAIN_SESSION_KEY, [one, one], NOW);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.entries, [one]);
  const second = appendConversation(database, MAIN_SESSION_KEY, [again], NOW);
  assert.deepEqual(second.entries, [one, again]);
  // A line without an id is identified by its value: delivered twice, it is one line.
  const anonymous = line("no id", NOW + 1);
  appendConversation(database, MAIN_SESSION_KEY, [anonymous, anonymous], NOW + 1);
  assert.equal(inspectConversation(database, MAIN_SESSION_KEY).count, 3);
});

test("a line learns the run it opened, and a run's ask and end are each published once", () => {
  const database = openTestDatabase();
  const spoken = line("what is running", NOW, {
    kind: CONVERSATION_ENTRY_KIND.ASK,
    eventId: "s1",
  });
  appendConversation(database, MAIN_SESSION_KEY, [spoken], NOW);
  const tied = { ...spoken, requestId: "run-1" };
  const enriched = appendConversation(database, MAIN_SESSION_KEY, [tied], NOW);
  assert.equal(enriched.changed, true);
  assert.deepEqual(enriched.entries, [tied]);
  // Another window's copy of the same ask under another id is the same publication, and is refused.
  const duplicateAsk = { ...tied, eventId: "s1-other-window" };
  assert.equal(appendConversation(database, MAIN_SESSION_KEY, [duplicateAsk], NOW).changed, false);
  const reply = line("two agents", NOW + 1, { requestId: "run-1", eventId: "r1" });
  const replyAgain = line("two agents", NOW + 2, { requestId: "run-1", eventId: "r1-late" });
  const published = appendConversation(database, MAIN_SESSION_KEY, [reply, replyAgain], NOW + 2);
  assert.deepEqual(published.entries, [tied, reply]);
});

test("the sequence counts up and is never reused after retention or a deletion", () => {
  const database = openTestDatabase();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-database-"));
  appendConversation(database, MAIN_SESSION_KEY, [line("a", NOW - 10, { eventId: "a" })], NOW);
  appendConversation(database, MAIN_SESSION_KEY, [line("b", NOW - 5, { eventId: "b" })], NOW);
  assert.ok(deleteConversation(database, root, MAIN_SESSION_KEY, NOW));
  assert.equal(inspectConversation(database, MAIN_SESSION_KEY).count, 0);
  appendConversation(database, MAIN_SESSION_KEY, [line("c", NOW + 1, { eventId: "c" })], NOW + 1);
  const sequences = inspectConversation(database, MAIN_SESSION_KEY).sequences;
  assert.deepEqual(sequences, [3]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the panel projection keeps 200 recent lines while canonical history keeps every admitted line", () => {
  const database = openTestDatabase();
  const old = line("old", NOW - storedConversationMaximumAgeMs - 1, { eventId: "old" });
  const many = Array.from({ length: maximumStoredConversationEntries + 10 }, (_, index) =>
    line(`line ${index}`, NOW - 1000 + index, { eventId: `m${index}` }),
  );
  const outcome = appendConversation(database, MAIN_SESSION_KEY, [old, ...many], NOW);
  assert.equal(outcome.entries.length, maximumStoredConversationEntries);
  assert.equal(outcome.entries[0]?.words, "line 10");
  assert.equal(inspectConversation(database, MAIN_SESSION_KEY).count, many.length + 1);
  // A line stamped in the future is not admitted: the thread's clock is the store's.
  assert.equal(
    appendConversation(database, MAIN_SESSION_KEY, [line("soon", NOW + 1, { eventId: "f" })], NOW)
      .changed,
    false,
  );
});

test("a brain generation's expiry erases no visible history; only the Clear reaches both", () => {
  const database = openTestDatabase();
  const gen1 = populatedState("gen-1");
  saveBrainEnvelope(database, MAIN_SESSION_KEY, { kind: SAVE_KIND.REPLACE, state: gen1 });
  const said = line("said under gen-1", NOW, { eventId: "h1" });
  appendConversation(database, MAIN_SESSION_KEY, [said], NOW);
  // The generation runs out and an empty successor replaces it: its rows cascade away...
  const later = NOW + BRAIN_GENERATION_LIFETIME_MS;
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-1",
    state: freshBrainState("gen-2", later),
  });
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.requests, []);
  // ...while the thread keeps its lines under its own retention, still attributed to gen-1.
  assert.deepEqual(listConversation(database, MAIN_SESSION_KEY, NOW + 1), [said]);
  assert.deepEqual(inspectConversation(database, MAIN_SESSION_KEY).sessionIds, ["gen-1"]);
  // A reset marker written into the successor raises the cutoff, and the lines at or before it stop projecting.
  const clearedAt = NOW + 2;
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-2",
    state: { ...freshBrainState("gen-3", clearedAt), reset: { clearedAt, generationId: "gen-2" } },
  });
  assert.deepEqual(listConversation(database, MAIN_SESSION_KEY, NOW + 3), []);
  // A late line from before the cutoff is refused by the standing marker.
  assert.equal(
    appendConversation(
      database,
      MAIN_SESSION_KEY,
      [line("late", NOW + 1, { eventId: "late" })],
      NOW + 3,
    ).changed,
    false,
  );
  assert.equal(
    appendConversation(
      database,
      MAIN_SESSION_KEY,
      [line("new", NOW + 3, { eventId: "new" })],
      NOW + 3,
    ).changed,
    true,
  );
});

test("history search reads only the conversations named, under each one's cutoff", () => {
  const database = openTestDatabase();
  // SAFETY: a thread key of the documented shape, built by hand for the test.
  const thread =
    "agent:main:thread:11111111-1111-1111-1111-111111111111" as typeof MAIN_SESSION_KEY;
  createConversation(database, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: thread,
    name: "Thread",
    now: NOW,
  });
  appendConversation(
    database,
    MAIN_SESSION_KEY,
    [line("we chose Tuesday deploys", NOW, { eventId: "a" })],
    NOW,
  );
  appendConversation(
    database,
    thread,
    [line("tuesday is the deploy day", NOW + 1, { eventId: "b" })],
    NOW + 1,
  );
  appendConversation(
    database,
    thread,
    [line("unrelated words", NOW + 2, { eventId: "c" })],
    NOW + 2,
  );
  const both = searchConversation(database, [MAIN_SESSION_KEY, thread], "TUESDAY", 10, NOW + 3);
  assert.deepEqual(
    both.map((hit) => [hit.sessionKey, hit.entry.words]),
    [
      [thread, "tuesday is the deploy day"],
      [MAIN_SESSION_KEY, "we chose Tuesday deploys"],
    ],
  );
  assert.equal(searchConversation(database, [thread], "tuesday", 10, NOW + 3).length, 1);
  assert.equal(searchConversation(database, [], "tuesday", 10, NOW + 3).length, 0);
  assert.equal(
    searchConversation(database, [MAIN_SESSION_KEY, thread], "deploys, tuesday?", 10, NOW + 3)
      .length,
    1,
    "a line is matched by its tokens, in any order and past punctuation, never as one phrase",
  );
  assert.equal(
    searchConversation(database, [MAIN_SESSION_KEY, thread], "tuesday", 1, NOW + 3).length,
    1,
    "the limit bounds the whole answer across every conversation named",
  );
  raiseConversationCutoff(database, MAIN_SESSION_KEY, NOW);
  assert.equal(
    searchConversation(database, [MAIN_SESSION_KEY, thread], "tuesday", 10, NOW + 3).length,
    1,
  );
});

test("history search admits lines by exact token before the limit is spent, so recent substring-only lines cannot crowd an older match out", () => {
  const database = openTestDatabase();
  // SAFETY: a thread key of the documented shape, built by hand for the test.
  const thread =
    "agent:main:thread:11111111-1111-1111-1111-111111111111" as typeof MAIN_SESSION_KEY;
  createConversation(database, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: thread,
    name: "Thread",
    now: NOW,
  });
  appendConversation(
    database,
    MAIN_SESSION_KEY,
    [line("Deploy? Tuesday, we said.", NOW, { eventId: "exact" })],
    NOW,
  );
  const crowd = Array.from({ length: 60 }, (_, index) =>
    line(`deployment tuesday note ${index}`, NOW + 1 + index, { eventId: `crowd-${index}` }),
  );
  appendConversation(database, thread, crowd, NOW + 100);
  appendConversation(
    database,
    thread,
    [line("we redeploy TUESDAYS only", NOW + 200, { eventId: "substring" })],
    NOW + 200,
  );
  const hits = searchConversation(
    database,
    [MAIN_SESSION_KEY, thread],
    "tuesday deploy",
    6,
    NOW + 300,
  );
  assert.deepEqual(
    hits.map((hit) => [hit.sessionKey, hit.entry.words]),
    [[MAIN_SESSION_KEY, "Deploy? Tuesday, we said."]],
    "only the line carrying every token as a word is a hit, in any order, case, or punctuation",
  );
  assert.equal(
    searchConversation(database, [MAIN_SESSION_KEY, thread], "deployment", 6, NOW + 300).length,
    6,
    "the limit still bounds the whole answer across the conversations named",
  );
  raiseConversationCutoff(database, MAIN_SESSION_KEY, NOW);
  assert.equal(
    searchConversation(database, [MAIN_SESSION_KEY, thread], "tuesday deploy", 6, NOW + 300).length,
    0,
    "a cleared conversation's lines are not reached by any page of the scan",
  );
  const many = Array.from({ length: CONVERSATION_SEARCH_MAXIMUM_SCANNED_ROWS }, (_, index) =>
    line(`deployments ${index}`, NOW + 1000 + index, { eventId: `many-${index}` }),
  );
  appendConversation(database, thread, many, NOW + 5000);
  appendConversation(
    database,
    thread,
    [line("deploy now", NOW + 500, { eventId: "behind" })],
    NOW + 5000,
  );
  assert.equal(
    searchConversation(database, [thread], "deploy", 6, NOW + 6000).length,
    0,
    "a match behind more substring-only lines than the scan bound is not found: the bound is the documented limit",
  );
  assert.equal(
    searchConversation(
      database,
      [thread],
      "deploy",
      6,
      NOW + 1000 + CONVERSATION_SEARCH_MAXIMUM_SCANNED_ROWS - 2,
    ).length,
    1,
    "and the same match is found once fewer lines stand in front of it",
  );
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
  appendConversation(database, MAIN_SESSION_KEY, [atCutoff], cutoff);
  // The Clear's marker lands; the thread's erasure does not (the disk refused it).
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    state: { ...freshBrainState("gen-cleared", cutoff), reset: { clearedAt: cutoff } },
  });
  assert.deepEqual(listConversation(database, MAIN_SESSION_KEY, cutoff + 1), []);
  // The marker's generation expires and an unmarked successor replaces it at exactly cutoff + lifetime,
  // when the retained-age comparison alone would still admit a line stamped at the cutoff.
  const expiry = cutoff + BRAIN_GENERATION_LIFETIME_MS;
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-cleared",
    state: freshBrainState("gen-after", expiry),
  });
  assert.equal(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.reset, undefined);
  assert.equal(conversationClearedAt(database, MAIN_SESSION_KEY), cutoff);
  assert.deepEqual(listConversation(database, MAIN_SESSION_KEY, expiry), []);
  assert.equal(appendConversation(database, MAIN_SESSION_KEY, [atCutoff], expiry).changed, false);
  // A later cutoff only raises it; an older marker never lowers it.
  raiseConversationCutoff(database, MAIN_SESSION_KEY, expiry + 5);
  saveBrainEnvelope(database, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    expectGeneration: "gen-after",
    state: { ...freshBrainState("gen-late", expiry + 6), reset: { clearedAt: cutoff } },
  });
  assert.equal(conversationClearedAt(database, MAIN_SESSION_KEY), expiry + 5);
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
  appendConversation(
    first,
    MAIN_SESSION_KEY,
    [line("ERASED_SYNTHETIC", cutoff, { eventId: "e" })],
    cutoff,
  );
  const store = new BrainStateStore({
    automaticReset: true,
    repository: repository(first),
    createGenerationId: () => `gen-${++ids}`,
    now: () => clock,
  });
  await store.load();
  // The Clear: the marker lands, the erasure is never asked for (the disk refused it).
  assert.equal(await store.clear(cutoff), true);
  assert.deepEqual(listConversation(first, MAIN_SESSION_KEY, cutoff + 1), []);
  // Exactly one lifetime later the marked generation expires through the store itself.
  clock = cutoff + BRAIN_GENERATION_LIFETIME_MS;
  assert.equal(store.expireIfDue(clock), true);
  await store.flush();
  assert.equal(loadBrainEnvelope(first, MAIN_SESSION_KEY).state?.reset, undefined);
  assert.deepEqual(listConversation(first, MAIN_SESSION_KEY, clock), []);
  first.close();
  // The next launch opens the same file: the cutoff is the conversation's, not the dead generation's.
  const relaunch = StoreDatabase.open(location);
  assert.equal(conversationClearedAt(relaunch, MAIN_SESSION_KEY), cutoff);
  assert.deepEqual(listConversation(relaunch, MAIN_SESSION_KEY, clock), []);
  assert.deepEqual(listConversation(relaunch, MAIN_SESSION_KEY, clock + 1), []);
  assert.equal(
    appendConversation(
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
  const appended = appendConversation(
    database,
    MAIN_SESSION_KEY,
    [line(words, NOW, { eventId: "multiline" })],
    NOW,
  );
  assert.equal(appended.entries[0]?.words, words);
  database.close();
  const relaunch = StoreDatabase.open(location);
  assert.equal(listConversation(relaunch, MAIN_SESSION_KEY, NOW)[0]?.words, words);
  relaunch.close();
});

test("the checkpoint stamp lives on the generation: an empty foreign checkpoint keeps it, a delta may set it, and no item row carries one", () => {
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
        checkpointFormat: { stamp: native },
        items: { keepPrefix: 0, append: [{ type: "message", role: "user", content: "hi" }] },
      },
    }),
    true,
  );
  const restamped = loadBrainEnvelope(database, MAIN_SESSION_KEY);
  assert.equal(restamped.state?.checkpointFormat, native);
  assert.equal(restamped.state?.items.length, 1);
  // The stamp is the generation's alone: an item row carries none of its own.
  // SAFETY: PRAGMA table_info answers one text column named name per column of the table.
  const columns = database.prepare("PRAGMA table_info(runtime_checkpoints)").all() as {
    name: string;
  }[];
  assert.equal(
    columns.some((column) => column.name === "format"),
    false,
  );
});

test("a database from before the rename opens with its lines, archives, and requests carried under the new names, and a newer one is never guessed at", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-runtime-store-"));
  const location = path.join(directory, "agent.sqlite");
  const seeded = StoreDatabase.open(location);
  createConversation(seeded, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    name: "main",
    now: NOW,
  });
  saveBrainEnvelope(seeded, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    state: populatedState("gen-kept"),
  });
  appendConversation(seeded, MAIN_SESSION_KEY, [line("kept", NOW, { eventId: "k" })], NOW);
  raiseConversationCutoff(seeded, MAIN_SESSION_KEY, NOW - 1);
  seeded.close();

  // The shape version 10 wrote: the same rows under the old table and column names.
  const older = new DatabaseSync(location);
  older.exec(
    "ALTER TABLE conversations RENAME COLUMN next_conversation_sequence TO next_history_sequence",
  );
  older.exec(
    "ALTER TABLE conversations RENAME COLUMN conversation_cleared_at TO history_cleared_at",
  );
  older.exec("ALTER TABLE requests RENAME COLUMN performed_actions TO performed_acts");
  older.exec("ALTER TABLE requests RENAME COLUMN unknown_actions TO unknown_acts");
  older.exec("ALTER TABLE requests RENAME COLUMN conversation_recorded_at TO history_recorded_at");
  older.exec("ALTER TABLE conversation_events RENAME TO history_events");
  older.exec("ALTER TABLE conversation_archives RENAME TO history_archives");
  older.exec("ALTER TABLE history_archives RENAME COLUMN conversation_lines TO history_lines");
  older.exec("UPDATE schema_version SET version = 10");
  older.close();

  const database = StoreDatabase.open(location);
  // SAFETY: the schema_version table has one integer column.
  const version = database.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  assert.equal(version.version, STORE_SCHEMA_VERSION);
  // SAFETY: sqlite_master's name column is text.
  const names = new Set(
    (database.prepare("SELECT name FROM sqlite_master").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  for (const gone of ["history_events", "history_archives", "history_events_by_key"]) {
    assert.equal(names.has(gone), false, gone);
  }
  for (const stands of [
    "conversation_events",
    "conversation_archives",
    "conversation_events_by_key",
    "conversation_events_by_time",
    "conversation_events_once_published",
  ]) {
    assert.equal(names.has(stands), true, stands);
  }
  assert.equal(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.generationId, "gen-kept");
  assert.deepEqual(
    listConversation(database, MAIN_SESSION_KEY, NOW).map((entry) => entry.words),
    ["kept"],
  );
  assert.equal(conversationClearedAt(database, MAIN_SESSION_KEY), NOW - 1);
  // The renamed table keeps its constraints: a second publication of the same line is one line.
  assert.equal(
    appendConversation(database, MAIN_SESSION_KEY, [line("kept", NOW, { eventId: "k" })], NOW)
      .changed,
    false,
  );
  database.close();
  // Reopening at the current version is a no-op, and a newer database is refused.
  StoreDatabase.open(location).close();
  const newer = new DatabaseSync(location);
  newer.exec("UPDATE schema_version SET version = 99");
  newer.close();
  assert.throws(() => StoreDatabase.open(location), /schema version 99/u);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("a version-1 database is walked forward: its item-tagged generation gains the legacy stamp and its row the later columns", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-store-"));
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

  const database = StoreDatabase.open(location);
  const loaded = loadBrainEnvelope(database, MAIN_SESSION_KEY);
  assert.equal(loaded.state?.checkpointFormat, "tool-loop@1:openai-responses-input/1");
  assert.equal(loaded.state?.items.length, 1);
  // SAFETY: the schema_version table has one integer column.
  const version = database.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  assert.equal(version.version, STORE_SCHEMA_VERSION);
  // SAFETY: the columns version 3 and 11 gave the conversation row.
  const migrated = database
    .prepare(
      "SELECT kind, last_activity_at, next_conversation_sequence FROM conversations WHERE session_key = ?",
    )
    .get(MAIN_SESSION_KEY) as {
    kind: string;
    last_activity_at: number;
    next_conversation_sequence: number;
  };
  assert.equal(migrated.kind, "main");
  assert.equal(migrated.last_activity_at, NOW);
  assert.equal(migrated.next_conversation_sequence, 1);
  assert.deepEqual(
    appendConversation(
      database,
      MAIN_SESSION_KEY,
      [line("first", NOW, { eventId: "f" })],
      NOW,
    ).entries.map((entry) => entry.words),
    ["first"],
  );
  database.close();
  StoreDatabase.open(location).close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("a database still carrying the retired memory tables opens with them dropped and everything else intact", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-store-"));
  const location = path.join(directory, "agent.sqlite");
  const seeded = StoreDatabase.open(location);
  createConversation(seeded, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    name: "main",
    now: NOW,
  });
  saveBrainEnvelope(seeded, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    state: populatedState("gen-kept"),
  });
  appendConversation(seeded, MAIN_SESSION_KEY, [line("kept", NOW, { eventId: "k" })], NOW);
  seeded.close();

  // The shape a build before the memory tables went: their rows stand under
  // the pre-rename table names, and the version is the one before the
  // migration that drops them.
  const older = new DatabaseSync(location);
  older.exec("CREATE TABLE memory_candidates (candidate_id TEXT PRIMARY KEY, words TEXT NOT NULL)");
  older.prepare("INSERT INTO memory_candidates VALUES (?, ?)").run("c-1", "CANDIDATE_SECRET");
  older.exec("ALTER TABLE conversation_events RENAME TO history_events");
  older.exec("UPDATE schema_version SET version = 9");
  older.close();

  const database = StoreDatabase.open(location);
  // SAFETY: the query selects the one column its row type names.
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'memory_%'")
    .all() as { name: string }[];
  const names = new Set(tables.map((row) => row.name));
  assert.equal(names.has("memory_candidates"), false);
  assert.equal(names.has("memory_index_chunks"), true);
  assert.equal(names.has("memory_flush_state"), true);
  // SAFETY: as above.
  const version = database.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  assert.equal(version.version, STORE_SCHEMA_VERSION);
  assert.equal(loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.generationId, "gen-kept");
  assert.deepEqual(
    listConversation(database, MAIN_SESSION_KEY, NOW).map((entry) => entry.words),
    ["kept"],
  );
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("the observation inbox and capture cursors round-trip, amend whole, and cascade with the generation", () => {
  const database = openTestDatabase();
  const state = populatedState("gen-inbox");
  const entry = {
    id: "entry-1",
    kind: "hook" as const,
    providerId: "claude-code",
    providerSessionId: "abc",
    hookEvent: "Stop",
    atMs: NOW,
    capturedAt: NOW + 1,
    session: { title: "synthetic session", status: "waiting" },
    delta: { text: "synthetic delta", truncated: false, status: "accepted" as const },
    cursor: "abc-2",
  };
  const captured: BrainPersistedState = {
    ...state,
    captureCursors: { "claude-code": { abc: "abc-2" } },
    inbox: [entry],
  };
  assert.equal(
    saveBrainEnvelope(database, MAIN_SESSION_KEY, { kind: SAVE_KIND.REPLACE, state: captured }),
    true,
  );
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state, captured);
  // Consumption: the inbox emptied and the consumed cursor moved, in one amendment.
  const consumed: BrainPersistedState = {
    ...captured,
    cursors: { "claude-code": { abc: "abc-2" } },
    inbox: [],
  };
  const tracker = new EnvelopeTracker();
  tracker.observe(loadBrainEnvelope(database, MAIN_SESSION_KEY));
  const save = tracker.saveFor(consumed);
  assert.equal(save.kind, SAVE_KIND.AMEND);
  if (save.kind === SAVE_KIND.AMEND) {
    assert.deepEqual(save.delta.inbox, []);
    assert.deepEqual(save.delta.cursors, { "claude-code": { abc: "abc-2" } });
    assert.equal(save.delta.captureCursors, undefined);
  }
  assert.equal(saveBrainEnvelope(database, MAIN_SESSION_KEY, save), true);
  assert.deepEqual(loadBrainEnvelope(database, MAIN_SESSION_KEY).state, consumed);
  // An entry this build cannot read makes the generation unreadable rather than half-read.
  database
    .prepare(
      "INSERT INTO observation_inbox (session_id, ordinal, entry_id, payload) VALUES (?, ?, ?, ?)",
    )
    .run("gen-inbox", 0, "bad", JSON.stringify({ id: "bad" }));
  assert.equal(loadBrainEnvelope(database, MAIN_SESSION_KEY).unreadable, true);
});

test("a database from before the run accounting opens with the two columns added, and a record's usage and response ids round-trip through them", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-runtime-store-"));
  const location = path.join(directory, "agent.sqlite");
  const seeded = StoreDatabase.open(location);
  createConversation(seeded, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    name: "main",
    now: NOW,
  });
  saveBrainEnvelope(seeded, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    state: populatedState("gen-kept"),
  });
  seeded.close();
  const older = new DatabaseSync(location);
  older.exec("ALTER TABLE requests DROP COLUMN usage_json");
  older.exec("ALTER TABLE requests DROP COLUMN response_ids_json");
  older.exec("UPDATE schema_version SET version = 11");
  older.close();

  const database = StoreDatabase.open(location);
  // SAFETY: the schema_version table has one integer column.
  const version = database.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  assert.equal(version.version, STORE_SCHEMA_VERSION);
  // SAFETY: PRAGMA table_info answers one text column named name per column of the table.
  const columns = new Set(
    (database.prepare("PRAGMA table_info(requests)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  assert.equal(columns.has("usage_json"), true);
  assert.equal(columns.has("response_ids_json"), true);
  // A record from before the columns reads with neither field, not with empty ones.
  const kept = loadBrainEnvelope(database, MAIN_SESSION_KEY).state;
  assert.equal(kept?.generationId, "gen-kept");
  assert.equal(kept?.requests[0] !== undefined && "usage" in kept.requests[0], false);
  assert.equal(kept?.requests[0] !== undefined && "responseIds" in kept.requests[0], false);

  const usage = {
    inputTokens: 1900,
    outputTokens: 50,
    cachedInputTokens: 1664,
    reasoningTokens: 30,
  };
  assert.equal(
    saveBrainEnvelope(database, MAIN_SESSION_KEY, {
      kind: SAVE_KIND.REPLACE,
      expectGeneration: "gen-kept",
      state: {
        ...populatedState("gen-next"),
        requests: [
          request("run-1", {
            status: BRAIN_REQUEST_STATUS.SUCCEEDED,
            usage,
            responseIds: ["resp_1", "resp_2"],
          }),
        ],
      },
    }),
    true,
  );
  const reloaded = loadBrainEnvelope(database, MAIN_SESSION_KEY).state?.requests[0];
  assert.deepEqual(reloaded?.usage, usage);
  assert.deepEqual(reloaded?.responseIds, ["resp_1", "resp_2"]);
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
