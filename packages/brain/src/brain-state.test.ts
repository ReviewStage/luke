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
  brainPersistedStateFromWire,
  brainStateFromStored,
  brainStateRecord,
  freshBrainState,
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
  const loaded = await store.load();
  assert.equal(loaded.generationId, "gen-1");
  assert.equal(storage.file, undefined);
  await store.load();
  assert.deepEqual(storage.log, ["read"]);

  const first = store.write("gen-1", (state) => ({ ...state, cursors: { p: { s: "1" } } }));
  const second = store.write("gen-1", (state) => ({
    ...state,
    cursors: { ...state.cursors, q: { t: "2" } },
  }));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(store.current()?.cursors, { p: { s: "1" }, q: { t: "2" } });
  assert.equal(brainStateFromStored(storage.file)?.cursors.q?.t, "2");

  const replaced: BrainPersistedState[] = [];
  store.onReplaced((state) => replaced.push(state));
  assert.equal(await store.reset(), true);
  assert.equal(storage.file, undefined);
  assert.equal(store.generationId(), "gen-2");
  assert.equal(replaced[0]?.generationId, "gen-2");
  // A writer still holding the old generation lands nowhere.
  assert.equal(await store.write("gen-1", (state) => state), false);
  assert.equal(storage.log.filter((entry) => entry === "write").length, 2);
  assert.equal(await store.write("gen-2", (state) => state), true);

  // Storage refusing leaves the held copy as it was.
  storage.refuse = true;
  assert.equal(
    await store.write("gen-2", (state) => ({ ...state, cursors: { z: { z: "z" } } })),
    false,
  );
  assert.deepEqual(store.current()?.cursors, {});
  storage.refuse = false;

  const whole = { ...complete(), generationId: "gen-9" };
  assert.equal(await store.replace(whole), true);
  assert.equal(store.generationId(), "gen-9");
  assert.equal(replaced.at(-1)?.generationId, "gen-9");
  await store.flush();
});
