import assert from "node:assert/strict";
import test from "node:test";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BRAIN_STATE_VERSION,
  type BrainPersistedState,
  brainGenerationExpired,
  brainPersistedStateFromWire,
  freshBrainState,
  retainedBrainState,
} from "./envelope.js";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS, type BrainRequestStatus } from "./requests.js";

/**
 * The envelope itself: what a stored file reads as, what it never reads as,
 * and what retention lets go of. Nothing here writes a disk — the store's own
 * queue, fences, and bounds are `state-store.test.ts`'s.
 */

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
        performedActions: 0,
        unknownActions: 0,
        conversationRecordedAt: NOW + 3,
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

function terminal(index: number, overrides: Partial<BrainPersistedState["requests"][number]> = {}) {
  const base = complete().requests[0];
  assert.ok(base);
  return {
    ...base,
    runId: `run-${index}`,
    submissionId: `sub-${index}`,
    acceptedAt: NOW + index,
    settledAt: NOW + index + 1,
    conversationRecordedAt: NOW + index + 2,
    ...overrides,
  };
}

/** The same record with no settled instant at all: a run still going. */
function going(index: number, status: BrainRequestStatus) {
  const { settledAt: _unsettled, ...record } = terminal(index);
  return { ...record, status };
}

/** The same record with no recorded instant at all: an end Conversation has not taken. */
function unpublished(index: number) {
  const { conversationRecordedAt: _untaken, ...record } = terminal(index);
  return record;
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

test("retention keeps 200 records, oldest ended runs and their journals going first, and never touches a run still going", () => {
  const requests = [
    ...Array.from({ length: 205 }, (_, index) => terminal(index)),
    going(900, BRAIN_REQUEST_STATUS.RUNNING),
    going(901, BRAIN_REQUEST_STATUS.QUEUED),
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
    index < 3 ? unpublished(index) : terminal(index),
  );
  const retained = retainedBrainState({ ...freshBrainState("gen-1", NOW), requests, journal: [] });
  // The three unpublished are the oldest, yet the next three go instead.
  assert.deepEqual(retained.prunedRunIds, ["run-3", "run-4", "run-5"]);
  assert.equal(retained.state.requests.length, 200);
});

test("the parser refuses a lifetime other than the build's and a marker dated after its generation's birth", () => {
  const state = complete();
  const read = (value: WireBoundaryInput) => brainPersistedStateFromWire(unparsedWire(value));
  assert.equal(read({ ...raw(state), expiresAt: state.expiresAt + 1 }), undefined);
  assert.equal(read({ ...raw(state), createdAt: state.createdAt - 1 }), undefined);
  assert.deepEqual(read({ ...raw(state), reset: { clearedAt: NOW } })?.reset, { clearedAt: NOW });
  assert.equal(read({ ...raw(state), reset: { clearedAt: NOW + 1 } }), undefined);
});
