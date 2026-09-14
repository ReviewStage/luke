import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import { Effect, Fiber } from "effect";
import { test } from "vitest";
import { followBrainRequests, publishRuns } from "./publication.js";

const NOW = 1_800_000_000_000;

/**
 * Polls a synchronous condition by yielding to Effect's own fiber scheduler,
 * which correctly interleaves with real pending Promises.
 */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

type RecordOverrides = { [K in keyof BrainRequestRecord]?: BrainRequestRecord[K] | undefined };

function record(overrides: RecordOverrides = {}): BrainRequestRecord {
  // Object.assign rather than a spread: spreading a Partial marks every key it
  // could carry optional, and the result stops being a BrainRequestRecord.
  return Object.assign<BrainRequestRecord, RecordOverrides>(
    {
      runId: "run-1",
      submissionId: "sub-1",
      origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
      question: "what needs me?",
      status: BRAIN_REQUEST_STATUS.SUCCEEDED,
      revision: 3,
      acceptedAt: NOW,
      startedAt: NOW + 1,
      settledAt: NOW + 2,
      text: "Two agents are waiting.",
      performedActions: 0,
      unknownActions: 0,
    },
    overrides,
  );
}

/** A brain that only remembers which runs were marked taken, and when. */
function markingBrain(
  marked: { runId: string; at: number }[],
  records: () => readonly BrainRequestRecord[] = () => [],
): Pick<BrainAgent, "markConversationRecorded" | "request"> {
  return {
    markConversationRecorded: (runId, at) =>
      Effect.sync(() => {
        marked.push({ runId, at });
        return true;
      }),
    request: (runId) => records().find((record) => record.runId === runId),
  };
}

test("a run's end is marked taken once, at the moment it settled, decided against the live record", async () => {
  const marked: { runId: string; at: number }[] = [];
  let live: BrainRequestRecord[] = [
    record({ status: BRAIN_REQUEST_STATUS.RUNNING, revision: 1, text: undefined }),
  ];
  const agent = markingBrain(marked, () => live);
  await Effect.runPromise(publishRuns(agent, live));
  assert.deepEqual(marked, []);
  live = [record()];
  await Effect.runPromise(publishRuns(agent, live));
  assert.deepEqual(marked, [{ runId: "run-1", at: NOW + 2 }]);
  // Once marked, the live record says so: an unrelated later report, an
  // older report captured before the mark, or a rebuilt follower all leave
  // it alone. A plain stop is marked on the same terms as a reply.
  live = [{ ...record(), conversationRecordedAt: NOW + 2 }];
  await Effect.runPromise(publishRuns(agent, [record()]));
  live = [
    ...live,
    record({
      runId: "run-2",
      status: BRAIN_REQUEST_STATUS.CANCELLED,
      text: undefined,
      settledAt: undefined,
    }),
  ];
  await Effect.runPromise(publishRuns(agent, live));
  assert.deepEqual(marked, [
    { runId: "run-1", at: NOW + 2 },
    { runId: "run-2", at: NOW },
  ]);
  // A run the live agent no longer knows — the generation was reset — is not marked.
  live = [];
  await Effect.runPromise(publishRuns(agent, [record({ runId: "run-3" })]));
  assert.equal(marked.length, 2);
});

it.effect(
  "a retired follower stops between two records, and the second waits for a live report",
  () =>
    Effect.gen(function* () {
      const marked: string[] = [];
      const live = [record({ runId: "run-1" }), record({ runId: "run-2" })];
      let holdMark: (() => void) | undefined;
      const agent: Pick<BrainAgent, "request" | "markConversationRecorded"> = {
        request: (runId) => live.find((entry) => entry.runId === runId),
        markConversationRecorded: (runId) =>
          Effect.async((resume) => {
            marked.push(runId);
            holdMark = () => resume(Effect.succeed(true));
          }),
      };
      let following = true;
      const publishing = yield* Effect.fork(publishRuns(agent, live, () => following));
      yield* waitFor(() => marked.length === 1);
      assert.deepEqual(marked, ["run-1"]);
      following = false;
      holdMark?.();
      yield* Fiber.join(publishing);
      assert.deepEqual(marked, ["run-1"]);
    }),
);

it.effect(
  "following a brain relays every report, marks the ended runs, and stops when unfollowed",
  () =>
    Effect.gen(function* () {
      let listener: ((records: readonly BrainRequestRecord[]) => void) | undefined;
      const marked: string[] = [];
      const ready = record({ status: BRAIN_REQUEST_STATUS.INTERRUPTED, text: undefined });
      // The live records, which the mark lands on as the real agent's would.
      const live = new Map([
        ["run-1", ready],
        ["run-2", record({ runId: "run-2" })],
      ]);
      // SAFETY: the follower reads only these members off the agent.
      const agent = {
        subscribe: (next: (records: readonly BrainRequestRecord[]) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        ready: () => Effect.void,
        requests: () => [ready],
        request: (runId: string) => live.get(runId),
        markConversationRecorded: (runId: string, at: number) =>
          Effect.sync(() => {
            marked.push(runId);
            const held = live.get(runId);
            if (held) live.set(runId, { ...held, conversationRecordedAt: at });
            return true;
          }),
      } as unknown as BrainAgent;
      const broadcasts: (readonly BrainRequestRecord[])[] = [];
      const unfollow = yield* followBrainRequests(agent, {
        broadcastRequests: (snapshots) => broadcasts.push(snapshots),
      });
      // The launch's interrupted run is marked and relayed once it is read.
      yield* waitFor(() => broadcasts.length === 1 && marked.length === 1);
      assert.equal(broadcasts.length, 1);
      assert.deepEqual(marked, ["run-1"]);
      listener?.([{ ...ready, conversationRecordedAt: NOW + 2 }, record({ runId: "run-2" })]);
      yield* waitFor(() => broadcasts.length === 2 && marked.length === 2);
      assert.equal(broadcasts.length, 2);
      assert.deepEqual(marked, ["run-1", "run-2"]);
      yield* unfollow;
      assert.equal(listener, undefined);
    }),
);

it.effect("a retired follower relays nothing a late report carries", () =>
  Effect.gen(function* () {
    let listener: ((records: readonly BrainRequestRecord[]) => void) | undefined;
    let releaseReady: (() => void) | undefined;
    const marked: string[] = [];
    // SAFETY: the follower reads only these four members off the agent.
    const agent = {
      subscribe: (next: (records: readonly BrainRequestRecord[]) => void) => {
        listener = next;
        return () => undefined;
      },
      ready: () =>
        Effect.async<void>((resume) => {
          releaseReady = () => resume(Effect.void);
        }),
      requests: () => [record()],
      request: () => record(),
      markConversationRecorded: (runId: string) =>
        Effect.sync(() => {
          marked.push(runId);
          return true;
        }),
    } as unknown as BrainAgent;
    const broadcasts: (readonly BrainRequestRecord[])[] = [];
    const unfollow = yield* followBrainRequests(agent, {
      broadcastRequests: (snapshots) => broadcasts.push(snapshots),
    });
    yield* unfollow;
    releaseReady?.();
    listener?.([record()]);
    // Nothing should happen after retirement: give any wrongful follow-up a
    // full round to occur before asserting its absence.
    for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    assert.deepEqual(broadcasts, []);
    assert.deepEqual(marked, []);
  }),
);

test("a refused mark leaves the end for the next report, and a retired follower marks nothing late", async () => {
  let markRefused = true;
  let marked = false;
  const live = () => record({ conversationRecordedAt: marked ? NOW + 2 : undefined });
  const marks: number[] = [];
  // SAFETY: publication reads only these members off the agent.
  const agent = {
    request: () => live(),
    markConversationRecorded: (_runId: string, at: number) =>
      Effect.sync(() => {
        if (markRefused) return false;
        marks.push(at);
        marked = true;
        return true;
      }),
  } as unknown as BrainAgent;
  await Effect.runPromise(publishRuns(agent, [live()]));
  assert.equal(marked, false);
  markRefused = false;
  let following = true;
  // The follower retires while the mark is out: the end is marked, and
  // nothing further is marked on the retired follower's behalf.
  // SAFETY: publication reads only `request` and the mark off the agent; the fixture stands in for the rest.
  const retiringAgent = {
    ...agent,
    markConversationRecorded: (_runId: string, at: number) =>
      Effect.sync(() => {
        marks.push(at);
        marked = true;
        following = false;
        return true;
      }),
  } as unknown as BrainAgent;
  await Effect.runPromise(
    publishRuns(retiringAgent, [live(), record({ runId: "run-2" })], () => following),
  );
  assert.deepEqual(marks, [NOW + 2]);
  // Already marked: the next report finds the mark on the live record and asks for nothing.
  await Effect.runPromise(publishRuns(agent, [live()]));
  assert.deepEqual(marks, [NOW + 2]);
});
