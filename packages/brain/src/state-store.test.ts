import assert from "node:assert/strict";
import test from "node:test";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { BrainGenerationClock } from "./generation-clock.js";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "./requests.js";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BRAIN_STATE_BOUNDS,
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
} from "./state-store.js";

const NOW = 1_800_000_000_000;
const { MAXIMUM_TERMINAL_REQUESTS, MAXIMUM_SERIALIZED_BYTES } = BRAIN_STATE_BOUNDS;
/** Wide enough that a handful of records overflow the byte cap the build fixes. */
const WIDE_TEXT_CHARS = Math.ceil(MAXIMUM_SERIALIZED_BYTES / 3);

/** A record as it would come off the wire: the same fields, with no domain type attached. */
function raw(value: BrainPersistedState | BrainPersistedState["requests"][number] | undefined) {
  // SAFETY: a JSON round trip of a plain record is boundary input by construction.
  return JSON.parse(JSON.stringify(value)) as Record<string, WireBoundaryInput>;
}

function complete(): BrainPersistedState {
  return {
    ...freshBrainState("gen-1", NOW),
    // A well-formed stamp, as `checkpointFormatTag` writes this build's own.
    checkpointFormat: "tool-loop@1:openai-responses-input/1",
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

test("the checkpoint stamp is kept as written, and absent wherever none was written", () => {
  const read = (value: WireBoundaryInput) => brainPersistedStateFromWire(unparsedWire(value));
  const { checkpointFormat: _stamp, ...unstamped } = raw(complete());
  const held = read(unstamped);
  assert.ok(held && !("checkpointFormat" in held));
  const empty = read({ ...unstamped, items: [] });
  assert.ok(empty && !("checkpointFormat" in empty));
  // An empty checkpoint of another runtime keeps saying whose it is.
  const foreign = "other-runtime@3:anthropic-messages/2";
  assert.equal(
    read({ ...unstamped, items: [], checkpointFormat: foreign })?.checkpointFormat,
    foreign,
  );
  assert.equal(read({ ...unstamped, checkpointFormat: foreign })?.checkpointFormat, foreign);
  assert.equal(read({ ...unstamped, checkpointFormat: "not a stamp" }), undefined);
  assert.equal(read({ ...unstamped, checkpointFormat: 7 }), undefined);
});

class MemoryStorage implements BrainStateStorage {
  file: string | undefined;
  refuse = false;
  readonly log: string[] = [];
  read(): string | undefined | Promise<string | undefined> {
    this.log.push("read");
    return this.file;
  }
  write(contents: string): boolean | Promise<boolean> {
    this.log.push("write");
    if (this.refuse) return false;
    this.file = contents;
    return true;
  }
}

test("the store loads once, serializes writes, and fences a write against a replaced generation", async () => {
  const storage = new MemoryStorage();
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: true,
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
    new BrainStateStore({
      automaticReset: true,
      storage,
      createGenerationId: () => "gen-new",
      now: () => clock,
    });
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
    automaticReset: true,
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

test("retention keeps 200 records, oldest ended runs and their journals going first, and never touches a run still going", () => {
  const requests = [
    ...Array.from({ length: 205 }, (_, index) => terminal(index)),
    terminal(900, { status: BRAIN_REQUEST_STATUS.RUNNING, settledAt: undefined }),
    terminal(901, { status: BRAIN_REQUEST_STATUS.QUEUED, settledAt: undefined }),
  ];
  const journal = requests.flatMap((record) => journalFor(record.runId));
  const retained = retainedBrainState({ ...freshBrainState("gen-1", NOW), requests, journal });
  // The bound counts every record, the two still going included, so seven go.
  assert.deepEqual(retained.prunedRunIds, [
    "run-0",
    "run-1",
    "run-2",
    "run-3",
    "run-4",
    "run-5",
    "run-6",
  ]);
  assert.equal(retained.state.requests.length, 200);
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
  const storage = new MemoryStorage();
  const store = new BrainStateStore({
    automaticReset: true,
    storage,
    createGenerationId: () => "gen-1",
    now: () => NOW,
  });
  const lease = store.lease();
  await store.load();
  const big = (index: number) => terminal(index, { text: "x".repeat(WIDE_TEXT_CHARS) });
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
  assert.ok(brainStateRecord(held).length <= MAXIMUM_SERIALIZED_BYTES);

  // A running run's checkpoint cannot be pruned: growth past the cap with
  // nothing eligible left is refused, and the held copy and file stand.
  const active = terminal(50, {
    status: BRAIN_REQUEST_STATUS.RUNNING,
    settledAt: undefined,
    text: "y".repeat(MAXIMUM_SERIALIZED_BYTES + 1_000),
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
    automaticReset: true,
    storage: new MemoryStorage(),
    createGenerationId: () => "gen-1",
    now: () => NOW,
  });
  const oversizedLease = oversizedStore.lease();
  await oversizedStore.load();
  const items = Array.from({ length: 5 }, (_, index) => ({
    type: "message",
    role: "user",
    content: `${index}${"z".repeat(WIDE_TEXT_CHARS)}`,
  }));
  assert.equal(
    await oversizedStore.write(oversizedLease, "gen-1", (state) => ({ ...state, items })),
    false,
  );
  assert.equal(
    await oversizedStore.write(oversizedLease, "gen-1", (state) => ({
      ...state,
      items: [
        { type: "compaction", id: "cmp", encrypted_content: "z".repeat(WIDE_TEXT_CHARS * 4) },
      ],
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
    automaticReset: true,
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

test("the parser refuses a lifetime other than the build's and a marker dated after its generation's birth", () => {
  const state = complete();
  const read = (value: WireBoundaryInput) => brainPersistedStateFromWire(unparsedWire(value));
  assert.equal(read({ ...raw(state), expiresAt: state.expiresAt + 1 }), undefined);
  assert.equal(read({ ...raw(state), createdAt: state.createdAt - 1 }), undefined);
  assert.deepEqual(read({ ...raw(state), reset: { clearedAt: NOW } })?.reset, { clearedAt: NOW });
  assert.equal(read({ ...raw(state), reset: { clearedAt: NOW + 1 } }), undefined);
});

/** Storage whose next write waits until the test releases it. */
class HeldStorage extends MemoryStorage {
  #release: (() => void) | undefined;
  holdNext = false;
  override write(contents: string) {
    if (!this.holdNext) return super.write(contents);
    this.holdNext = false;
    return new Promise<boolean>((resolve) => {
      this.#release = () => resolve(super.write(contents));
    });
  }
  /** Releases the held write, or cancels a hold no write has taken yet. */
  release() {
    this.holdNext = false;
    this.#release?.();
    this.#release = undefined;
  }
  get holding() {
    return this.#release !== undefined;
  }
}

test("a Clear and an expiry fence synchronously, before any disk is waited on, and a write landing afterwards installs nothing", async () => {
  const storage = new HeldStorage();
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: true,
    storage,
    createGenerationId: () => `gen-${++generations}`,
    now: () => NOW,
  });
  const lease = store.lease();
  await store.load();
  const heard: string[] = [];
  store.onReplaced((state) => heard.push(state.generationId));

  // A write is out on disk when the Clear is asked for.
  storage.holdNext = true;
  let committed = 0;
  const late = store.write(
    lease,
    "gen-1",
    (state) => ({ ...state, cursors: { p: { s: "LATE_CURSOR" } } }),
    () => {
      committed += 1;
    },
  );
  await Promise.resolve();
  assert.ok(storage.holding, "the write is on disk");
  const clearing = store.clear(NOW + 1);
  // Fenced at once: nothing waited for the disk.
  assert.equal(store.holdsGeneration("gen-1"), false);
  assert.equal(store.generationId(), "gen-2");
  assert.deepEqual(heard, ["gen-2"]);
  assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 1, generationId: "gen-1" });
  storage.release();
  assert.equal(await late, false);
  assert.equal(committed, 0);
  assert.deepEqual(store.current()?.cursors, {});
  assert.equal(await clearing, true);
  const stored = brainStateFromStored(storage.file);
  assert.equal(stored?.generationId, "gen-2");
  assert.ok(!String(storage.read()).includes("LATE_CURSOR"));

  // The same for an expiry asked for while a write is out.
  storage.holdNext = true;
  const later = store.write(lease, "gen-2", (state) => ({
    ...state,
    cursors: { p: { s: "LATER_CURSOR" } },
  }));
  await Promise.resolve();
  const expiresAt = stored?.expiresAt ?? 0;
  assert.equal(store.expireIfDue(expiresAt), true);
  assert.equal(store.holdsGeneration("gen-2"), false);
  assert.deepEqual(heard, ["gen-2", "gen-3"]);
  storage.release();
  assert.equal(await later, false);
  await store.flush();
  assert.equal(brainStateFromStored(storage.file)?.generationId, "gen-3");
  assert.ok(!String(storage.read()).includes("LATER_CURSOR"));
  assert.equal(store.expireIfDue(expiresAt), false);
});

test("a Clear on a store that never loaded still leaves the marker, learning the erased id from the file and reading nothing else", async () => {
  const storage = new MemoryStorage();
  const old = {
    ...complete(),
    items: [{ type: "message", role: "user", content: "OLD_COLD_SECRET" }],
  };
  storage.file = brainStateRecord(old);
  const store = new BrainStateStore({
    automaticReset: true,
    storage,
    createGenerationId: () => "gen-cold",
    now: () => NOW,
  });
  const heard: string[] = [];
  store.onReplaced((state) => heard.push(state.generationId));
  const clearing = store.clear(NOW + 5);
  assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 5 });
  assert.deepEqual(heard, ["gen-cold"]);
  assert.equal(await clearing, true);
  assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 5, generationId: "gen-1" });
  assert.deepEqual(brainStateFromStored(storage.file)?.reset, {
    clearedAt: NOW + 5,
    generationId: "gen-1",
  });
  assert.ok(!String(storage.read()).includes("OLD_COLD_SECRET"));
  // The old file is never read into memory afterwards.
  assert.equal((await store.load()).generationId, "gen-cold");

  // With no brain file at all the marker still carries the instant.
  const empty = new MemoryStorage();
  const bare = new BrainStateStore({
    automaticReset: true,
    storage: empty,
    createGenerationId: () => "gen-bare",
    now: () => NOW,
  });
  assert.equal(await bare.clear(NOW + 6), true);
  assert.deepEqual(brainStateFromStored(empty.file)?.reset, { clearedAt: NOW + 6 });
});

test("load admits a file only within its bounds and rewrites the disk to match what it admitted", async () => {
  const reports: string[] = [];
  const make = (storage: MemoryStorage, now = NOW) =>
    new BrainStateStore({
      automaticReset: true,
      storage,
      createGenerationId: () => "gen-fresh",
      now: () => now,
      report: (message) => reports.push(message),
    });

  // Expired: discarded and replaced on disk in the same load.
  const expired = new MemoryStorage();
  const stale = {
    ...complete(),
    items: [{ type: "message", role: "user", content: "EXPIRED_SECRET" }],
  };
  expired.file = brainStateRecord(stale);
  assert.equal((await make(expired, stale.expiresAt).load()).generationId, "gen-fresh");
  assert.ok(!String(expired.read()).includes("EXPIRED_SECRET"));
  assert.equal(brainStateFromStored(expired.file)?.generationId, "gen-fresh");

  // Unreadable and version-1: replaced likewise.
  const broken = new MemoryStorage();
  broken.file = '{"version":1,"items":[{"content":"V1_SECRET"}],"cursors":{}}\n';
  await make(broken).load();
  assert.ok(!String(broken.read()).includes("V1_SECRET"));

  // Pruned at load: the admitted copy and the file both hold the cap.
  const crowdedIndexes = Array.from({ length: MAXIMUM_TERMINAL_REQUESTS + 2 }, (_, at) => at);
  const crowded = new MemoryStorage();
  crowded.file = brainStateRecord({
    ...freshBrainState("gen-1", NOW),
    requests: crowdedIndexes.map((index) => terminal(index)),
    journal: crowdedIndexes.flatMap((index) => journalFor(`run-${index}`)),
  });
  const pruned = await make(crowded).load();
  assert.deepEqual(
    pruned.requests.map((record) => record.runId),
    crowdedIndexes.slice(2).map((index) => `run-${index}`),
  );
  assert.equal(brainStateFromStored(crowded.file)?.requests.length, MAXIMUM_TERMINAL_REQUESTS);
  assert.equal(brainStateFromStored(crowded.file)?.journal.length, MAXIMUM_TERMINAL_REQUESTS);

  // Past its bounds with nothing eligible: refused whole, replaced, reported.
  const overfull = new MemoryStorage();
  overfull.file = brainStateRecord({
    ...freshBrainState("gen-1", NOW),
    requests: Array.from({ length: MAXIMUM_TERMINAL_REQUESTS + 1 }, (_, index) =>
      terminal(index, { historyRecordedAt: undefined }),
    ),
  });
  assert.equal((await make(overfull).load()).requests.length, 0);
  assert.equal(brainStateFromStored(overfull.file)?.generationId, "gen-fresh");
  assert.ok(reports.some((message) => message.includes("past its bounds")));

  // A refused rewrite is reported, and the memory still holds the fresh generation.
  const refusing = new MemoryStorage();
  refusing.file = brainStateRecord(stale);
  refusing.refuse = true;
  const held = make(refusing, stale.expiresAt);
  assert.equal((await held.load()).generationId, "gen-fresh");
  assert.ok(reports.some((message) => message.includes("expired generation")));
  assert.ok(String(refusing.read()).includes("EXPIRED_SECRET"));
});

test("the record count is a hard bound: admission closes at capacity and a write that would add past it is refused", async () => {
  const storage = new MemoryStorage();
  const store = new BrainStateStore({
    automaticReset: true,
    storage,
    createGenerationId: () => "gen-1",
    now: () => NOW,
  });
  const lease = store.lease();
  await store.load();
  const unpublished = (index: number) => terminal(index, { historyRecordedAt: undefined });
  assert.equal(store.admits("gen-1"), true);
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      requests: Array.from({ length: MAXIMUM_TERMINAL_REQUESTS - 1 }, (_, index) =>
        unpublished(index),
      ),
    })),
    true,
  );
  assert.equal(store.admits("gen-1"), true);
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      requests: [...state.requests, unpublished(MAXIMUM_TERMINAL_REQUESTS - 1)],
    })),
    true,
  );
  assert.equal(store.admits("gen-1"), false);
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      requests: [...state.requests, unpublished(MAXIMUM_TERMINAL_REQUESTS)],
    })),
    false,
  );
  // A write that does not add a record — an end's mark — still lands, and
  // once an end is in the thread the room opens again.
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      requests: state.requests.map((record) =>
        record.runId === "run-0" ? { ...record, historyRecordedAt: NOW } : record,
      ),
    })),
    true,
  );
  assert.equal(store.admits("gen-1"), true);
  assert.equal(store.admits("gen-other"), false);
});

/** Storage whose next read waits until the test releases it. */
class HeldReadStorage extends MemoryStorage {
  #release: (() => void) | undefined;
  holdNextRead = false;
  override read(): string | undefined | Promise<string | undefined> {
    if (!this.holdNextRead) return super.read();
    this.holdNextRead = false;
    return new Promise<string | undefined>((resolve) => {
      this.#release = () => resolve(super.read());
    });
  }
  release() {
    this.holdNextRead = false;
    this.#release?.();
    this.#release = undefined;
  }
  get holding() {
    return this.#release !== undefined;
  }
}

test("a load whose read was out when a Clear landed adopts the successor, never the file, and the marker still lands", async () => {
  for (const refuseDisk of [false, true]) {
    const storage = new HeldReadStorage();
    storage.file = brainStateRecord({
      ...complete(),
      items: [{ type: "message", role: "user", content: "OLD_LOAD_SECRET" }],
    });
    let generations = 0;
    const store = new BrainStateStore({
      automaticReset: true,
      storage,
      createGenerationId: () => `fresh-${++generations}`,
      now: () => NOW,
    });
    const heard: string[] = [];
    store.onReplaced((state) => heard.push(state.generationId));
    storage.holdNextRead = true;
    const loading = store.load();
    await Promise.resolve();
    assert.ok(storage.holding);
    const clearing = store.clear(NOW + 1);
    assert.equal(store.generationId(), "fresh-1");
    storage.refuse = refuseDisk;
    storage.release();
    const loaded = await loading;
    assert.equal(loaded.generationId, "fresh-1");
    assert.equal(await clearing, !refuseDisk);
    assert.equal(store.generationId(), "fresh-1");
    assert.deepEqual(heard, ["fresh-1"]);
    // The erased id was learned from the file's identity alone.
    assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 1, generationId: "gen-1" });
    assert.deepEqual(store.current()?.items, []);
    if (refuseDisk) {
      assert.ok(String(storage.file).includes("OLD_LOAD_SECRET"));
      storage.refuse = false;
      const lease = store.lease();
      assert.equal(await store.write(lease, "fresh-1", (state) => state), true);
    }
    assert.ok(!String(storage.file).includes("OLD_LOAD_SECRET"));
    assert.deepEqual(brainStateFromStored(storage.file)?.reset, {
      clearedAt: NOW + 1,
      generationId: "gen-1",
    });
  }
});

test("a load's own cleanup write and a replacement both yield to a Clear or expiry raised while they were out", async () => {
  // Startup cleanup write held, Clear during it.
  const storage = new HeldStorage();
  const stale = {
    ...complete(),
    items: [{ type: "message", role: "user", content: "EXPIRED_SECRET" }],
  };
  storage.file = brainStateRecord(stale);
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: true,
    storage,
    createGenerationId: () => `fresh-${++generations}`,
    now: () => stale.expiresAt,
  });
  storage.holdNext = true;
  const loading = store.load();
  await settleTicks();
  assert.ok(storage.holding, "the cleanup write is on disk");
  const clearing = store.clear(stale.expiresAt + 1);
  assert.equal(store.generationId(), "fresh-2");
  storage.release();
  assert.equal((await loading).generationId, "fresh-2");
  assert.equal(await clearing, true);
  assert.equal(brainStateFromStored(storage.file)?.generationId, "fresh-2");
  assert.deepEqual(brainStateFromStored(storage.file)?.reset, {
    clearedAt: stale.expiresAt + 1,
    generationId: "fresh-1",
  });
  assert.ok(!String(storage.file).includes("EXPIRED_SECRET"));

  // A replacement is fenced synchronously and its write yields to a Clear.
  const heard: string[] = [];
  store.onReplaced((state) => heard.push(state.generationId));
  storage.holdNext = true;
  const replacement = {
    ...complete(),
    generationId: "replacement",
    createdAt: stale.expiresAt,
    expiresAt: stale.expiresAt + BRAIN_GENERATION_LIFETIME_MS,
  };
  const replacing = store.replace({
    ...replacement,
    items: [{ type: "message", role: "user", content: "REPLACEMENT_SECRET" }],
  });
  assert.equal(store.generationId(), "replacement");
  assert.deepEqual(heard, ["replacement"]);
  const cleared = store.clear(stale.expiresAt + 2);
  assert.equal(store.generationId(), "fresh-3");
  storage.release();
  assert.equal(await replacing, false);
  assert.equal(await cleared, true);
  assert.equal(store.generationId(), "fresh-3");
  assert.deepEqual(store.resetMarker(), {
    clearedAt: stale.expiresAt + 2,
    generationId: "replacement",
  });
  assert.ok(!String(storage.file).includes("REPLACEMENT_SECRET"));

  // And to an expiry raised in the same tick, the same way: the replacement
  // never reaches the disk, the successor does.
  const late = store.replace(replacement);
  assert.equal(store.generationId(), "replacement");
  assert.equal(store.expireIfDue(replacement.expiresAt), true);
  assert.equal(store.generationId(), "fresh-4");
  assert.equal(await late, false);
  await store.flush();
  assert.equal(brainStateFromStored(storage.file)?.generationId, "fresh-4");

  // Two Clears in a row leave the newest cutoff standing.
  const first = store.clear(NOW + 10);
  const second = store.clear(NOW + 11);
  assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 11, generationId: "fresh-5" });
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(brainStateFromStored(storage.file)?.reset, {
    clearedAt: NOW + 11,
    generationId: "fresh-5",
  });
});

function settleTicks(): Promise<void> {
  return new Promise((resolve) => {
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      if (ticks > 10) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

test("default policy keeps an existing checkpoint beyond its legacy deadline and arms no reset timer", async () => {
  const storage = new MemoryStorage();
  const previous = complete();
  storage.file = brainStateRecord(previous);
  let now = previous.expiresAt + BRAIN_GENERATION_LIFETIME_MS;
  const store = new BrainStateStore({
    storage,
    createGenerationId: () => "explicit-reset",
    now: () => now,
  });
  assert.deepEqual(await store.load(), previous);
  assert.equal(store.automaticReset, false);
  assert.equal(store.expireIfDue(now), false);
  let scheduled = false;
  const clock = new BrainGenerationClock({
    store,
    now: () => now,
    schedule: () => {
      scheduled = true;
      throw new Error("default policy must not schedule expiry");
    },
  });
  await clock.start();
  now += BRAIN_GENERATION_LIFETIME_MS;
  assert.equal((await store.load()).generationId, previous.generationId);
  assert.deepEqual(store.current()?.items, previous.items);
  assert.equal(scheduled, false);
  assert.equal(await store.reset(now), true);
  assert.equal(store.current()?.generationId, "explicit-reset");
  assert.deepEqual(store.current()?.items, []);
  clock.stop();
});
