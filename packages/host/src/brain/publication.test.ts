import assert from "node:assert/strict";
import type { BrainAgent, BrainRequestRecord, BrainSubmission } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import { maximumAskLength } from "@sidecar/session";
import { test } from "vitest";
import { drainMicrotasks, operatorOverBrain } from "../testing/index.js";
import { followBrainRequests, publishRuns } from "./publication.js";

const NOW = 1_800_000_000_000;

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

/** A brain that accepts every submission into one run and remembers what it was asked. */
function acceptingBrain(asked: BrainSubmission[]): BrainAgent {
  // SAFETY: the ask path reads only `submitAsk` and `request` off the agent; the fixture stands in for the rest.
  return {
    submitAsk: async (submission: BrainSubmission) => {
      asked.push(submission);
      return { outcome: "accepted", runId: "run-1", acceptedAt: NOW };
    },
    request: () => record({ status: BRAIN_REQUEST_STATUS.QUEUED }),
  } as unknown as BrainAgent;
}

/** A brain that only remembers which runs were marked taken, and when. */
function markingBrain(
  marked: { runId: string; at: number }[],
  records: () => readonly BrainRequestRecord[] = () => [],
): Pick<BrainAgent, "markConversationRecorded" | "request"> {
  return {
    markConversationRecorded: async (runId, at) => {
      marked.push({ runId, at });
      return true;
    },
    request: (runId) => records().find((record) => record.runId === runId),
  };
}

test("an ask with no brain is refused in fixed words", async () => {
  const operator = await operatorOverBrain({ current: () => undefined });
  const result = await operator.submit({
    submissionId: "sub-1",
    question: "what needs me?",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.deepEqual(result, { outcome: "rejected", reason: "absent" });
});

test("an ask is bounded and handed to the brain whole under its own submission id", async () => {
  const asked: BrainSubmission[] = [];
  const long = `  ${"a".repeat(maximumAskLength + 50)}`;
  const operator = await operatorOverBrain({ current: () => acceptingBrain(asked) });
  const result = await operator.submit({
    submissionId: "sub-1",
    question: long,
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.deepEqual(result, { outcome: "accepted", runId: "run-1", acceptedAt: NOW });
  assert.equal(asked[0]?.question.length, maximumAskLength);
  assert.equal(asked[0]?.submissionId, "sub-1");
  assert.equal(asked[0]?.origin, BRAIN_REQUEST_ORIGIN.SPOKEN);
});

test("a run's end is marked taken once, at the moment it settled, decided against the live record", async () => {
  const marked: { runId: string; at: number }[] = [];
  let live: BrainRequestRecord[] = [
    record({ status: BRAIN_REQUEST_STATUS.RUNNING, revision: 1, text: undefined }),
  ];
  const agent = markingBrain(marked, () => live);
  await publishRuns(agent, live);
  assert.deepEqual(marked, []);
  live = [record()];
  await publishRuns(agent, live);
  assert.deepEqual(marked, [{ runId: "run-1", at: NOW + 2 }]);
  // Once marked, the live record says so: an unrelated later report, an
  // older report captured before the mark, or a rebuilt follower all leave
  // it alone. A plain stop is marked on the same terms as a reply.
  live = [{ ...record(), conversationRecordedAt: NOW + 2 }];
  await publishRuns(agent, [record()]);
  live = [
    ...live,
    record({
      runId: "run-2",
      status: BRAIN_REQUEST_STATUS.CANCELLED,
      text: undefined,
      settledAt: undefined,
    }),
  ];
  await publishRuns(agent, live);
  assert.deepEqual(marked, [
    { runId: "run-1", at: NOW + 2 },
    { runId: "run-2", at: NOW },
  ]);
  // A run the live agent no longer knows — the generation was reset — is not marked.
  live = [];
  await publishRuns(agent, [record({ runId: "run-3" })]);
  assert.equal(marked.length, 2);
});

test("a retired follower stops between two records, and the second waits for a live report", async () => {
  const marked: string[] = [];
  const live = [record({ runId: "run-1" }), record({ runId: "run-2" })];
  let holdMark: (() => void) | undefined;
  const agent: Pick<BrainAgent, "request" | "markConversationRecorded"> = {
    request: (runId) => live.find((entry) => entry.runId === runId),
    markConversationRecorded: (runId) =>
      new Promise((resolve) => {
        marked.push(runId);
        holdMark = () => resolve(true);
      }),
  };
  let following = true;
  const publishing = publishRuns(agent, live, () => following);
  await drainMicrotasks(1);
  assert.deepEqual(marked, ["run-1"]);
  following = false;
  holdMark?.();
  await publishing;
  assert.deepEqual(marked, ["run-1"]);
});

test("following a brain relays every report, marks the ended runs, and stops when unfollowed", async () => {
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
    ready: () => Promise.resolve(),
    requests: () => [ready],
    request: (runId: string) => live.get(runId),
    markConversationRecorded: async (runId: string, at: number) => {
      marked.push(runId);
      const held = live.get(runId);
      if (held) live.set(runId, { ...held, conversationRecordedAt: at });
      return true;
    },
  } as unknown as BrainAgent;
  const broadcasts: (readonly BrainRequestRecord[])[] = [];
  const unfollow = followBrainRequests(agent, {
    broadcastRequests: (snapshots) => broadcasts.push(snapshots),
  });
  await drainMicrotasks(1);
  await drainMicrotasks(1);
  // The launch's interrupted run is marked and relayed once it is read.
  assert.equal(broadcasts.length, 1);
  assert.deepEqual(marked, ["run-1"]);
  listener?.([{ ...ready, conversationRecordedAt: NOW + 2 }, record({ runId: "run-2" })]);
  await drainMicrotasks(1);
  await drainMicrotasks(1);
  assert.equal(broadcasts.length, 2);
  assert.deepEqual(marked, ["run-1", "run-2"]);
  unfollow();
  assert.equal(listener, undefined);
});

test("a retired follower relays nothing a late report carries", async () => {
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
      new Promise<void>((resolve) => {
        releaseReady = resolve;
      }),
    requests: () => [record()],
    request: () => record(),
    markConversationRecorded: async (runId: string) => {
      marked.push(runId);
      return true;
    },
  } as unknown as BrainAgent;
  const broadcasts: (readonly BrainRequestRecord[])[] = [];
  const unfollow = followBrainRequests(agent, {
    broadcastRequests: (snapshots) => broadcasts.push(snapshots),
  });
  unfollow();
  releaseReady?.();
  listener?.([record()]);
  await drainMicrotasks(1);
  assert.deepEqual(broadcasts, []);
  assert.deepEqual(marked, []);
});

test("a refused mark leaves the end for the next report, and a retired follower marks nothing late", async () => {
  let markRefused = true;
  let marked = false;
  const live = () => record({ conversationRecordedAt: marked ? NOW + 2 : undefined });
  const marks: number[] = [];
  // SAFETY: publication reads only these members off the agent.
  const agent = {
    request: () => live(),
    markConversationRecorded: async (_runId: string, at: number) => {
      if (markRefused) return false;
      marks.push(at);
      marked = true;
      return true;
    },
  } as unknown as BrainAgent;
  await publishRuns(agent, [live()]);
  assert.equal(marked, false);
  markRefused = false;
  let following = true;
  // The follower retires while the mark is out: the end is marked, and
  // nothing further is marked on the retired follower's behalf.
  // SAFETY: publication reads only `request` and the mark off the agent; the fixture stands in for the rest.
  const retiringAgent = {
    ...agent,
    markConversationRecorded: async (_runId: string, at: number) => {
      marks.push(at);
      marked = true;
      following = false;
      return true;
    },
  } as unknown as BrainAgent;
  await publishRuns(retiringAgent, [live(), record({ runId: "run-2" })], () => following);
  assert.deepEqual(marks, [NOW + 2]);
  // Already marked: the next report finds the mark on the live record and asks for nothing.
  await publishRuns(agent, [live()]);
  assert.deepEqual(marks, [NOW + 2]);
});
