import assert from "node:assert/strict";
import test from "node:test";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "./brain-requests.js";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BRAIN_STATE_VERSION,
  type BrainPersistedState,
  type BrainStateStorage,
  BrainStateStore,
  brainGenerationExpired,
  brainPersistedStateFromWire,
  brainStateFromStored,
  brainStateRecord,
  freshBrainState,
  retainedBrainState,
} from "./brain-state.js";

const NOW = 1_800_000_000_000;

/** A record as it would come off the wire: the same fields, with no domain type attached. */
function raw(value: BrainPersistedState | BrainPersistedState["requests"][number] | undefined) {
  // SAFETY: a JSON round trip of a plain record is boundary input by construction.
  return JSON.parse(JSON.stringify(value)) as Record<string, WireBoundaryInput>;
}

function complete(): BrainPersistedState {
  return {
    ...freshBrainState("gen-1", NOW),
    items: [{ type: "message", role: "user", content: [] }],
    cursors: { "claude-code": { abc: "7" } },
    requests: [
      {
        runId: "run-1",
        submissionId: "sub-1",
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
        question: "what's up?",
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        revision: 3,
        acceptedAt: NOW,
        startedAt: NOW + 1,
        settledAt: NOW + 2,
        text: "Nothing much.",
        performedActs: 0,
        unknownActs: 0,
        historyRecordedAt: NOW + 3,
      },
    ],
    journal: [
      {
        runId: "run-1",
        callId: "call-1",
        name: "send_session_message",
        argumentsJson: "{}",
        startedAt: NOW + 1,
        outputJson: '{"status":"accepted"}',
        settledAt: NOW + 2,
      },
    ],
  };
}

test("a fresh generation is born now and expires exactly one lifetime later", () => {
  const state = freshBrainState("gen-1", NOW);
  assert.equal(state.version, BRAIN_STATE_VERSION);
  assert.equal(state.expiresAt - state.createdAt, BRAIN_GENERATION_LIFETIME_MS);
  assert.deepEqual([state.items, state.requests, state.journal], [[], [], []]);
});

test("the envelope round-trips, and anything from another shape reads as nothing", () => {
  const state = complete();
  assert.deepEqual(brainStateFromStored(brainStateRecord(state)), state);
  assert.equal(brainStateFromStored(undefined), undefined);
  assert.equal(brainStateFromStored("not json"), undefined);
  // The version-1 file — items and cursors alone, of unknown age — is not
  // given a fresh lifetime; it reads as no state.
  const read = (value: WireBoundaryInput) => brainPersistedStateFromWire(unparsedWire(value));
  assert.equal(read({ version: 1, items: [], cursors: {} }), undefined);
  assert.equal(read({ ...raw(state), generationId: "" }), undefined);
  assert.equal(read({ ...raw(state), expiresAt: "soon" }), undefined);
  assert.equal(read({ ...raw(state), items: ["text"] }), undefined);
  assert.equal(read({ ...raw(state), cursors: { a: { b: 1 } } }), undefined);
  assert.equal(read({ ...raw(state), requests: [{ runId: "x" }] }), undefined);
  assert.equal(
    read({ ...raw(state), requests: [{ ...raw(state.requests[0]), status: "sleeping" }] }),
    undefined,
  );
  assert.equal(read({ ...raw(state), journal: [{ runId: "x" }] }), undefined);
});

class MemoryStorage implements BrainStateStorage {
  file: string | undefined;
  refuse = false;
  readonly log: string[] = [];
  read() {
    this.log.push("read");
    return this.file;
  }
  write(contents: string) {
    this.log.push("write");
    if (this.refuse) return false;
    this.file = contents;
    return true;
  }
  remove() {
    this.log.push("remove");
    this.file = undefined;
    return true;
  }
}

test("the store loads once, serializes writes, and fences a write against a replaced generation", async () => {
  const storage = new MemoryStorage();
  let generations = 0;
  const store = new BrainStateStore({
    storage,
    createGenerationId: () => `gen-${++generations}`,
    now: () => NOW,
  });
  assert.equal(store.current(), undefined);
  const lease = store.lease();
  const loaded = await store.load();
  assert.equal(loaded.generationId, "gen-1");
  assert.equal(storage.file, undefined);
  await store.load();
  assert.deepEqual(storage.log, ["read"]);

  const first = store.write(lease, "gen-1", (state) => ({ ...state, cursors: { p: { s: "1" } } }));
  const second = store.write(lease, "gen-1", (state) => ({
    ...state,
    cursors: { ...state.cursors, q: { t: "2" } },
  }));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(store.current()?.cursors, { p: { s: "1" }, q: { t: "2" } });
  assert.equal(brainStateFromStored(storage.file)?.cursors.q?.t, "2");

  const replaced: BrainPersistedState[] = [];
  store.onReplaced((state) => replaced.push(state));
  assert.equal(await store.clear(), true);
  // The file now holds the empty successor and the content-free marker of
  // the erasure, and nothing of the generation that was cleared.
  const afterClear = brainStateFromStored(storage.file);
  assert.deepEqual(afterClear?.reset, { generationId: "gen-1", clearedAt: NOW });
  assert.deepEqual(afterClear?.cursors, {});
  assert.ok(!String(storage.read()).includes('"s":"1"'));
  assert.equal(store.generationId(), "gen-2");
  assert.deepEqual(store.resetMarker(), { generationId: "gen-1", clearedAt: NOW });
  assert.equal(store.holdsGeneration("gen-1"), false);
  assert.equal(store.holdsGeneration("gen-2"), true);
  assert.equal(replaced[0]?.generationId, "gen-2");
  // A writer still holding the old generation lands nowhere.
  assert.equal(await store.write(lease, "gen-1", (state) => state), false);
  assert.equal(storage.log.filter((entry) => entry === "write").length, 3);
  assert.equal(await store.write(lease, "gen-2", (state) => state), true);

  // Storage refusing leaves the held copy as it was.
  storage.refuse = true;
  assert.equal(
    await store.write(lease, "gen-2", (state) => ({ ...state, cursors: { z: { z: "z" } } })),
    false,
  );
  assert.deepEqual(store.current()?.cursors, {});
  storage.refuse = false;

  // A later holder taking the lease fences the earlier one, generation or not.
  const successor = store.lease();
  assert.equal(await store.write(lease, "gen-2", (state) => state), false);
  assert.equal(await store.write(successor, "gen-2", (state) => state), true);

  const whole = { ...complete(), generationId: "gen-9" };
  assert.equal(await store.replace(whole), true);
  assert.equal(store.generationId(), "gen-9");
  assert.equal(replaced.at(-1)?.generationId, "gen-9");
  await store.flush();
});

function terminal(index: number, overrides: Partial<BrainPersistedState["requests"][number]> = {}) {
  const base = complete().requests[0];
  assert.ok(base);
  return {
    ...base,
    runId: `run-${index}`,
    submissionId: `sub-${index}`,
    acceptedAt: NOW + index,
    settledAt: NOW + index + 1,
    historyRecordedAt: NOW + index + 2,
    ...overrides,
  };
}

function journalFor(runId: string, calls = 1) {
  return Array.from({ length: calls }, (_, index) => ({
    runId,
    callId: `${runId}-call-${index}`,
    name: "send_session_message",
    argumentsJson: "{}",
    startedAt: NOW,
    outputJson: '{"status":"accepted"}',
    settledAt: NOW + 1,
  }));
}

test("a generation is expired at its expiry instant exactly, and not one millisecond before", () => {
  const state = freshBrainState("gen-1", NOW);
  assert.equal(brainGenerationExpired(state, state.expiresAt - 1), false);
  assert.equal(brainGenerationExpired(state, state.expiresAt), true);
  assert.equal(brainGenerationExpired(state, state.expiresAt + 1), true);
  assert.equal(state.expiresAt, NOW + 14 * 24 * 60 * 60 * 1000);
});

test("the reset marker round-trips, and a marker that is present but unreadable fails the whole envelope", () => {
  const cleared: BrainPersistedState = {
    ...freshBrainState("gen-2", NOW),
    reset: { generationId: "gen-1", clearedAt: NOW - 5 },
  };
  assert.deepEqual(brainStateFromStored(brainStateRecord(cleared)), cleared);
  const read = (value: WireBoundaryInput) => brainPersistedStateFromWire(unparsedWire(value));
  assert.equal(read({ ...raw(cleared), reset: { generationId: "" } }), undefined);
  assert.equal(
    read({ ...raw(cleared), reset: { generationId: "gen-1", clearedAt: -1 } }),
    undefined,
  );
  assert.equal(read({ ...raw(cleared), reset: "gone" }), undefined);
});

test("the store discards an expired file at load rather than giving old memory a fresh lifetime", async () => {
  const stale = complete();
  const storage = new MemoryStorage();
  storage.file = brainStateRecord(stale);
  let clock = stale.expiresAt - 1;
  const fresh = () =>
    new BrainStateStore({ storage, createGenerationId: () => "gen-new", now: () => clock });
  assert.equal((await fresh().load()).generationId, "gen-1");
  clock = stale.expiresAt;
  const loaded = await fresh().load();
  assert.equal(loaded.generationId, "gen-new");
  assert.deepEqual(
    [loaded.items, loaded.cursors, loaded.requests, loaded.journal],
    [[], {}, [], []],
  );
  assert.equal(loaded.reset, undefined);
  assert.equal(loaded.createdAt, clock);
});

test("writes and a compaction never move the expiry, and expireIfDue ends the generation on time", async () => {
  const storage = new MemoryStorage();
  let generations = 0;
  let clock = NOW;
  const store = new BrainStateStore({
    storage,
    createGenerationId: () => `gen-${++generations}`,
    now: () => clock,
  });
  const lease = store.lease();
  const born = await store.load();
  clock = NOW + 10 * 24 * 60 * 60 * 1000;
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      items: [{ type: "compaction", id: "cmp", encrypted_content: "OLD_COMPACTION_SECRET" }],
      cursors: { p: { s: "9" } },
    })),
    true,
  );
  assert.equal(store.current()?.expiresAt, born.expiresAt);
  assert.equal(store.current()?.createdAt, born.createdAt);
  assert.equal(brainStateFromStored(storage.file)?.expiresAt, born.expiresAt);

  const replaced: BrainPersistedState[] = [];
  store.onReplaced((state) => replaced.push(state));
  assert.equal(await store.expireIfDue(born.expiresAt - 1), false);
  assert.equal(store.generationId(), "gen-1");
  assert.equal(await store.expireIfDue(born.expiresAt), true);
  assert.equal(store.generationId(), "gen-2");
  assert.equal(replaced[0]?.generationId, "gen-2");
  assert.equal(replaced[0]?.createdAt, born.expiresAt);
  // The encrypted compaction and the cursors went with the generation, from
  // memory and from the file both.
  assert.ok(!String(storage.read()).includes("OLD_COMPACTION_SECRET"));
  assert.deepEqual(store.current()?.items, []);
  assert.deepEqual(store.current()?.cursors, {});
  assert.equal(await store.write(lease, "gen-1", (state) => state), false);
  assert.equal(await store.expireIfDue(born.expiresAt), false);
});

test("retention keeps the newest 200 ended runs, lets their journals go with them, and never touches a run still going", () => {
  const requests = [
    ...Array.from({ length: 205 }, (_, index) => terminal(index)),
    terminal(900, { status: BRAIN_REQUEST_STATUS.RUNNING, settledAt: undefined }),
    terminal(901, { status: BRAIN_REQUEST_STATUS.QUEUED, settledAt: undefined }),
  ];
  const journal = requests.flatMap((record) => journalFor(record.runId));
  const retained = retainedBrainState({ ...freshBrainState("gen-1", NOW), requests, journal });
  assert.deepEqual(retained.prunedRunIds, ["run-0", "run-1", "run-2", "run-3", "run-4"]);
  assert.equal(retained.state.requests.length, 202);
  assert.ok(retained.state.requests.some((record) => record.runId === "run-900"));
  assert.ok(retained.state.requests.some((record) => record.runId === "run-901"));
  assert.ok(!retained.state.requests.some((record) => record.runId === "run-0"));
  assert.ok(!retained.state.journal.some((entry) => entry.runId === "run-0"));
  assert.ok(retained.state.journal.some((entry) => entry.runId === "run-900"));
  assert.equal(retained.oversized, false);
});

test("an ended run whose end the thread has not taken is kept past the count, however old", () => {
  const requests = Array.from({ length: 203 }, (_, index) =>
    terminal(index, index < 3 ? { historyRecordedAt: undefined } : {}),
  );
  const retained = retainedBrainState({ ...freshBrainState("gen-1", NOW), requests, journal: [] });
  // The three unpublished are the oldest, yet the next three go instead.
  assert.deepEqual(retained.prunedRunIds, ["run-3", "run-4", "run-5"]);
  assert.equal(retained.state.requests.length, 200);
});

test("the byte cap prunes eligible ended runs first, and refuses a write that would still grow an oversized envelope", async () => {
  const bounds = { MAXIMUM_TERMINAL_REQUESTS: 200, MAXIMUM_SERIALIZED_BYTES: 4_000 } as const;
  const storage = new MemoryStorage();
  const store = new BrainStateStore({
    storage,
    createGenerationId: () => "gen-1",
    now: () => NOW,
    bounds,
  });
  const lease = store.lease();
  await store.load();
  const big = (index: number) => terminal(index, { text: "x".repeat(600) });
  const journal = [0, 1, 2, 3].flatMap((index) => journalFor(`run-${index}`));
  const pruned: string[][] = [];
  assert.equal(
    await store.write(
      lease,
      "gen-1",
      (state) => ({ ...state, requests: [big(0), big(1), big(2), big(3)], journal }),
      (commit) => pruned.push([...commit.prunedRunIds]),
    ),
    true,
  );
  // Oldest ended runs went, journals with them, until the envelope fit.
  assert.ok((pruned[0]?.length ?? 0) > 0);
  assert.deepEqual(pruned[0], pruned[0]?.slice().sort());
  assert.ok(pruned[0]?.includes("run-0"));
  const held = store.current();
  assert.ok(held);
  for (const runId of pruned[0] ?? []) {
    assert.ok(!held.requests.some((record) => record.runId === runId));
    assert.ok(!held.journal.some((entry) => entry.runId === runId));
  }
  assert.ok(brainStateRecord(held).length <= bounds.MAXIMUM_SERIALIZED_BYTES);

  // A running run's checkpoint cannot be pruned: growth past the cap with
  // nothing eligible left is refused, and the held copy and file stand.
  const active = terminal(50, {
    status: BRAIN_REQUEST_STATUS.RUNNING,
    settledAt: undefined,
    text: "y".repeat(5_000),
  });
  const before = storage.file;
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      requests: [...state.requests, active],
    })),
    false,
  );
  assert.equal(storage.file, before);
  assert.equal(
    store.current()?.requests.some((record) => record.runId === "run-50"),
    false,
  );

  // A write that does not grow an already-oversized envelope still lands.
  const oversizedStore = new BrainStateStore({
    storage: new MemoryStorage(),
    createGenerationId: () => "gen-1",
    now: () => NOW,
    bounds: { MAXIMUM_TERMINAL_REQUESTS: 200, MAXIMUM_SERIALIZED_BYTES: 400 },
  });
  const oversizedLease = oversizedStore.lease();
  await oversizedStore.load();
  const items = Array.from({ length: 5 }, (_, index) => ({
    type: "message",
    role: "user",
    content: `${index}${"z".repeat(200)}`,
  }));
  assert.equal(
    await oversizedStore.write(oversizedLease, "gen-1", (state) => ({ ...state, items })),
    false,
  );
  assert.equal(
    await oversizedStore.write(oversizedLease, "gen-1", (state) => ({
      ...state,
      items: [{ type: "compaction", id: "cmp", encrypted_content: "z".repeat(600) }],
    })),
    false,
    "the first oversized write has nothing to shrink from",
  );
  assert.deepEqual(oversizedStore.current()?.items, []);
});

test("a Clear whose marker the storage refuses still fences the old generation and answers incomplete", async () => {
  const storage = new MemoryStorage();
  let generations = 0;
  const store = new BrainStateStore({
    storage,
    createGenerationId: () => `gen-${++generations}`,
    now: () => NOW,
  });
  const lease = store.lease();
  await store.load();
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      items: [{ type: "message", role: "user", content: "OLD_GENERATION_SECRET" }],
    })),
    true,
  );
  const replaced: string[] = [];
  store.onReplaced((state) => replaced.push(state.generationId));
  storage.refuse = true;
  assert.equal(await store.clear(NOW + 1), false);
  // Fenced and forgotten in memory, announced to every listener; the file
  // still holds the old content, which is what "incomplete" reports.
  assert.deepEqual(replaced, ["gen-2"]);
  assert.equal(store.holdsGeneration("gen-1"), false);
  assert.deepEqual(store.current()?.items, []);
  assert.deepEqual(store.resetMarker(), { generationId: "gen-1", clearedAt: NOW + 1 });
  assert.ok(String(storage.read()).includes("OLD_GENERATION_SECRET"));
  assert.equal(await store.write(lease, "gen-1", (state) => state), false);
  // The next write that lands supersedes the old content entirely.
  storage.refuse = false;
  assert.equal(await store.write(lease, "gen-2", (state) => state), true);
  assert.ok(!String(storage.read()).includes("OLD_GENERATION_SECRET"));
  assert.deepEqual(brainStateFromStored(storage.file)?.reset, {
    generationId: "gen-1",
    clearedAt: NOW + 1,
  });
});
