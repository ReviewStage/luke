import assert from "node:assert/strict";
import test from "node:test";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { BrainGenerationClock } from "./generation-clock.js";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "./requests.js";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BRAIN_STATE_VERSION,
  type BrainPersistedState,
  BrainStateStore,
  brainGenerationExpired,
  brainPersistedStateFromWire,
  freshBrainState,
  MAXIMUM_TERMINAL_REQUESTS,
  retainedBrainState,
} from "./state-store.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "./testing.js";

const NOW = 1_800_000_000_000;

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
  assert.deepEqual(brainPersistedStateFromWire(unparsedWire(raw(state))), state);
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

test("the store loads once, serializes writes, and fences a write against a replaced generation", async () => {
  const repository = fakeBrainStateRepository();
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
    createGenerationId: () => `gen-${++generations}`,
    now: () => NOW,
  });
  assert.equal(store.current(), undefined);
  const lease = store.lease();
  const loaded = await store.load();
  assert.equal(loaded.generationId, "gen-1");
  assert.equal(repository.state === undefined, true);
  await store.load();
  assert.equal(repository.loads, 1);

  const first = store.write(lease, "gen-1", (state) => ({ ...state, cursors: { p: { s: "1" } } }));
  const second = store.write(lease, "gen-1", (state) => ({
    ...state,
    cursors: { ...state.cursors, q: { t: "2" } },
  }));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(store.current()?.cursors, { p: { s: "1" }, q: { t: "2" } });
  assert.equal(repository.state?.cursors.q?.t, "2");

  const replaced: BrainPersistedState[] = [];
  store.onReplaced((state) => replaced.push(state));
  assert.equal(await store.clear(), true);
  // The file now holds the empty successor and the content-free marker of
  // the erasure, and nothing of the generation that was cleared.
  const afterClear = repository.state;
  assert.deepEqual(afterClear?.reset, { generationId: "gen-1", clearedAt: NOW });
  assert.deepEqual(afterClear?.cursors, {});
  assert.ok(!repository.words().includes('"s":"1"'));
  assert.equal(store.generationId(), "gen-2");
  assert.deepEqual(store.resetMarker(), { generationId: "gen-1", clearedAt: NOW });
  assert.equal(store.holdsGeneration("gen-1"), false);
  assert.equal(store.holdsGeneration("gen-2"), true);
  assert.equal(replaced[0]?.generationId, "gen-2");
  // A writer still holding the old generation lands nowhere.
  assert.equal(await store.write(lease, "gen-1", (state) => state), false);
  assert.equal(repository.saves, 3);
  assert.equal(await store.write(lease, "gen-2", (state) => state), true);

  // A repository refusing leaves the held copy as it was.
  repository.refuse();
  assert.equal(
    await store.write(lease, "gen-2", (state) => ({ ...state, cursors: { z: { z: "z" } } })),
    false,
  );
  assert.deepEqual(store.current()?.cursors, {});
  repository.accept();

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
  assert.deepEqual(brainPersistedStateFromWire(unparsedWire(raw(cleared))), cleared);
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
  const repository = fakeBrainStateRepository(stale);
  let clock = stale.expiresAt - 1;
  const fresh = () =>
    new BrainStateStore({
      automaticReset: true,
      repository,
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
  const repository = fakeBrainStateRepository();
  let generations = 0;
  let clock = NOW;
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
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
  assert.equal(repository.state?.expiresAt, born.expiresAt);

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
  assert.ok(!repository.words().includes("OLD_COMPACTION_SECRET"));
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

test("a write that would still leave the envelope over the count is refused, and one that shrinks it lands", async () => {
  const repository = fakeBrainStateRepository();
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
    createGenerationId: () => "gen-1",
    now: () => NOW,
  });
  const lease = store.lease();
  await store.load();
  // Every record is a run still going, so retention has nothing eligible to
  // let go of and the bound can only be met by writing fewer.
  const going = (index: number) =>
    terminal(index, { status: BRAIN_REQUEST_STATUS.RUNNING, settledAt: undefined });
  const over = Array.from({ length: MAXIMUM_TERMINAL_REQUESTS + 5 }, (_, index) => going(index));
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({ ...state, requests: over })),
    false,
    "the first oversized write has nothing to shrink from",
  );
  assert.deepEqual(store.current()?.requests, []);
  assert.equal(repository.saves, 0);

  // An envelope already over its bound may still be written smaller: only a
  // write that would grow it is refused.
  const planted = { ...freshBrainState("gen-9", NOW), requests: over, journal: [] };
  const shrinking = new BrainStateStore({
    repository: fakeBrainStateRepository(planted),
    createGenerationId: () => "gen-fresh",
    now: () => NOW,
    report: () => undefined,
  });
  // A file past its bounds is refused whole at load, so the shrinking write
  // is made against a generation the store composed itself.
  assert.equal((await shrinking.load()).generationId, "gen-fresh");
  const shrinkingLease = shrinking.lease();
  assert.equal(
    await shrinking.write(shrinkingLease, "gen-fresh", (state) => ({
      ...state,
      requests: over.slice(0, MAXIMUM_TERMINAL_REQUESTS),
    })),
    true,
  );
});

test("a Clear whose marker the repository refuses still fences the old generation and answers incomplete", async () => {
  const repository = fakeBrainStateRepository();
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
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
  repository.refuse();
  assert.equal(await store.clear(NOW + 1), false);
  // Fenced and forgotten in memory, announced to every listener; the file
  // still holds the old content, which is what "incomplete" reports.
  assert.deepEqual(replaced, ["gen-2"]);
  assert.equal(store.holdsGeneration("gen-1"), false);
  assert.deepEqual(store.current()?.items, []);
  assert.deepEqual(store.resetMarker(), { generationId: "gen-1", clearedAt: NOW + 1 });
  assert.ok(repository.words().includes("OLD_GENERATION_SECRET"));
  assert.equal(await store.write(lease, "gen-1", (state) => state), false);
  // The next write that lands supersedes the old content entirely.
  repository.accept();
  assert.equal(await store.write(lease, "gen-2", (state) => state), true);
  assert.ok(!repository.words().includes("OLD_GENERATION_SECRET"));
  assert.deepEqual(repository.state?.reset, {
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

test("a Clear and an expiry fence synchronously, before any disk is waited on, and a write landing afterwards installs nothing", async () => {
  const repository = fakeBrainStateRepository();
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
    createGenerationId: () => `gen-${++generations}`,
    now: () => NOW,
  });
  const lease = store.lease();
  await store.load();
  const heard: string[] = [];
  store.onReplaced((state) => heard.push(state.generationId));

  // A write is out on disk when the Clear is asked for.
  const release = repository.hold();
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
  assert.ok(repository.holding, "the write is on disk");
  const clearing = store.clear(NOW + 1);
  // Fenced at once: nothing waited for the disk.
  assert.equal(store.holdsGeneration("gen-1"), false);
  assert.equal(store.generationId(), "gen-2");
  assert.deepEqual(heard, ["gen-2"]);
  assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 1, generationId: "gen-1" });
  release(true);
  assert.equal(await late, false);
  assert.equal(committed, 0);
  assert.deepEqual(store.current()?.cursors, {});
  assert.equal(await clearing, true);
  const stored = repository.state;
  assert.equal(stored?.generationId, "gen-2");
  assert.ok(!repository.words().includes("LATE_CURSOR"));

  // The same for an expiry asked for while a write is out.
  const releaseLater = repository.hold();
  const later = store.write(lease, "gen-2", (state) => ({
    ...state,
    cursors: { p: { s: "LATER_CURSOR" } },
  }));
  await Promise.resolve();
  const expiresAt = stored?.expiresAt ?? 0;
  assert.equal(store.expireIfDue(expiresAt), true);
  assert.equal(store.holdsGeneration("gen-2"), false);
  assert.deepEqual(heard, ["gen-2", "gen-3"]);
  releaseLater(true);
  assert.equal(await later, false);
  await store.flush();
  assert.equal(repository.state?.generationId, "gen-3");
  assert.ok(!repository.words().includes("LATER_CURSOR"));
  assert.equal(store.expireIfDue(expiresAt), false);
});

test("a Clear on a store that never loaded still leaves the marker, learning the erased id from the file and reading nothing else", async () => {
  const old = {
    ...complete(),
    items: [{ type: "message", role: "user", content: "OLD_COLD_SECRET" }],
  };
  const repository = fakeBrainStateRepository(old);
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
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
  assert.deepEqual(repository.state?.reset, {
    clearedAt: NOW + 5,
    generationId: "gen-1",
  });
  assert.ok(!repository.words().includes("OLD_COLD_SECRET"));
  // The old file is never read into memory afterwards.
  assert.equal((await store.load()).generationId, "gen-cold");

  // With no brain file at all the marker still carries the instant.
  const empty = fakeBrainStateRepository();
  const bare = new BrainStateStore({
    automaticReset: true,
    repository: empty,
    createGenerationId: () => "gen-bare",
    now: () => NOW,
  });
  assert.equal(await bare.clear(NOW + 6), true);
  assert.deepEqual(empty.state?.reset, { clearedAt: NOW + 6 });
});

test("load admits a file only within its bounds and rewrites the disk to match what it admitted", async () => {
  const reports: string[] = [];
  const make = (repository: FakeBrainStateRepository, now = NOW) =>
    new BrainStateStore({
      automaticReset: true,
      repository,
      createGenerationId: () => "gen-fresh",
      now: () => now,
      report: (message) => reports.push(message),
    });

  // Expired: discarded and replaced on disk in the same load.
  const stale = {
    ...complete(),
    items: [{ type: "message", role: "user", content: "EXPIRED_SECRET" }],
  };
  const expired = fakeBrainStateRepository(stale);
  assert.equal((await make(expired, stale.expiresAt).load()).generationId, "gen-fresh");
  assert.ok(!expired.words().includes("EXPIRED_SECRET"));
  assert.equal(expired.state?.generationId, "gen-fresh");

  // A generation the repository holds but no build can read: replaced likewise.
  const broken = fakeBrainStateRepository({ unreadable: true });
  assert.equal((await make(broken).load()).generationId, "gen-fresh");
  assert.equal(broken.state?.generationId, "gen-fresh");
  assert.ok(reports.some((message) => message.includes("unreadable state file")));

  // Pruned at load: the admitted copy and the file both hold the cap.
  const crowdedIndexes = Array.from({ length: MAXIMUM_TERMINAL_REQUESTS + 2 }, (_, at) => at);
  const crowded = fakeBrainStateRepository({
    ...freshBrainState("gen-1", NOW),
    requests: crowdedIndexes.map((index) => terminal(index)),
    journal: crowdedIndexes.flatMap((index) => journalFor(`run-${index}`)),
  });
  const pruned = await make(crowded).load();
  assert.deepEqual(
    pruned.requests.map((record) => record.runId),
    crowdedIndexes.slice(2).map((index) => `run-${index}`),
  );
  assert.equal(crowded.state?.requests.length, MAXIMUM_TERMINAL_REQUESTS);
  assert.equal(crowded.state?.journal.length, MAXIMUM_TERMINAL_REQUESTS);

  // Past its bounds with nothing eligible: refused whole, replaced, reported.
  const overfull = fakeBrainStateRepository({
    ...freshBrainState("gen-1", NOW),
    requests: Array.from({ length: MAXIMUM_TERMINAL_REQUESTS + 1 }, (_, index) =>
      terminal(index, { historyRecordedAt: undefined }),
    ),
  });
  assert.equal((await make(overfull).load()).requests.length, 0);
  assert.equal(overfull.state?.generationId, "gen-fresh");
  assert.ok(reports.some((message) => message.includes("past its bounds")));

  // A refused rewrite is reported, and the memory still holds the fresh generation.
  const refusing = fakeBrainStateRepository(stale);
  refusing.refuse();
  const held = make(refusing, stale.expiresAt);
  assert.equal((await held.load()).generationId, "gen-fresh");
  assert.ok(reports.some((message) => message.includes("expired generation")));
  assert.ok(refusing.words().includes("EXPIRED_SECRET"));
});

test("the record count is a hard bound: admission closes at capacity and a write that would add past it is refused", async () => {
  const repository = fakeBrainStateRepository();
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
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

test("a load whose read was out when a Clear landed adopts the successor, never the file, and the marker still lands", async () => {
  for (const refuseDisk of [false, true]) {
    const repository = fakeBrainStateRepository({
      ...complete(),
      items: [{ type: "message", role: "user", content: "OLD_LOAD_SECRET" }],
    });
    let generations = 0;
    const store = new BrainStateStore({
      automaticReset: true,
      repository,
      createGenerationId: () => `fresh-${++generations}`,
      now: () => NOW,
    });
    const heard: string[] = [];
    store.onReplaced((state) => heard.push(state.generationId));
    const releaseRead = repository.holdRead();
    const loading = store.load();
    await Promise.resolve();
    assert.ok(repository.holding);
    const clearing = store.clear(NOW + 1);
    assert.equal(store.generationId(), "fresh-1");
    if (refuseDisk) repository.refuse();
    releaseRead();
    const loaded = await loading;
    assert.equal(loaded.generationId, "fresh-1");
    assert.equal(await clearing, !refuseDisk);
    assert.equal(store.generationId(), "fresh-1");
    assert.deepEqual(heard, ["fresh-1"]);
    // The erased id was learned from the file's identity alone.
    assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 1, generationId: "gen-1" });
    assert.deepEqual(store.current()?.items, []);
    if (refuseDisk) {
      assert.ok(repository.words().includes("OLD_LOAD_SECRET"));
      repository.accept();
      const lease = store.lease();
      assert.equal(await store.write(lease, "fresh-1", (state) => state), true);
    }
    assert.ok(!repository.words().includes("OLD_LOAD_SECRET"));
    assert.deepEqual(repository.state?.reset, {
      clearedAt: NOW + 1,
      generationId: "gen-1",
    });
  }
});

test("a load's own cleanup write and a replacement both yield to a Clear or expiry raised while they were out", async () => {
  // Startup cleanup write held, Clear during it.
  const stale = {
    ...complete(),
    items: [{ type: "message", role: "user", content: "EXPIRED_SECRET" }],
  };
  const repository = fakeBrainStateRepository(stale);
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
    createGenerationId: () => `fresh-${++generations}`,
    now: () => stale.expiresAt,
  });
  const release = repository.hold();
  const loading = store.load();
  await settleTicks();
  assert.ok(repository.holding, "the cleanup write is on disk");
  const clearing = store.clear(stale.expiresAt + 1);
  assert.equal(store.generationId(), "fresh-2");
  release(true);
  assert.equal((await loading).generationId, "fresh-2");
  assert.equal(await clearing, true);
  assert.equal(repository.state?.generationId, "fresh-2");
  assert.deepEqual(repository.state?.reset, {
    clearedAt: stale.expiresAt + 1,
    generationId: "fresh-1",
  });
  assert.ok(!repository.words().includes("EXPIRED_SECRET"));

  // A replacement is fenced synchronously and its write yields to a Clear.
  const heard: string[] = [];
  store.onReplaced((state) => heard.push(state.generationId));
  const releaseReplacement = repository.hold();
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
  releaseReplacement(true);
  assert.equal(await replacing, false);
  assert.equal(await cleared, true);
  assert.equal(store.generationId(), "fresh-3");
  assert.deepEqual(store.resetMarker(), {
    clearedAt: stale.expiresAt + 2,
    generationId: "replacement",
  });
  assert.ok(!repository.words().includes("REPLACEMENT_SECRET"));

  // And to an expiry raised in the same tick, the same way: the replacement
  // never reaches the disk, the successor does.
  const late = store.replace(replacement);
  assert.equal(store.generationId(), "replacement");
  assert.equal(store.expireIfDue(replacement.expiresAt), true);
  assert.equal(store.generationId(), "fresh-4");
  assert.equal(await late, false);
  await store.flush();
  assert.equal(repository.state?.generationId, "fresh-4");

  // Two Clears in a row leave the newest cutoff standing.
  const first = store.clear(NOW + 10);
  const second = store.clear(NOW + 11);
  assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 11, generationId: "fresh-5" });
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(repository.state?.reset, {
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
  const previous = complete();
  const repository = fakeBrainStateRepository(previous);
  let now = previous.expiresAt + BRAIN_GENERATION_LIFETIME_MS;
  const store = new BrainStateStore({
    repository,
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
