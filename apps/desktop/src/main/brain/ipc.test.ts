import assert from "node:assert/strict";
import test from "node:test";
import type { BrainAgent, BrainRequestRecord, BrainSubmission } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import {
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  maximumTypedAskLength,
} from "@sidecar/realtime";
import { BRAIN_ASK_REFUSAL, brainReplyWords } from "#shared/wire/brain";
import { followBrainRequests, publishRuns, submitBrainAsk } from "./ipc";

const NOW = 1_800_000_000_000;

function record(overrides: Partial<BrainRequestRecord> = {}): BrainRequestRecord {
  return {
    runId: "run-1",
    submissionId: "sub-1",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: "what needs me?",
    status: BRAIN_REQUEST_STATUS.SUCCEEDED,
    revision: 3,
    acceptedAt: NOW,
    startedAt: NOW + 1,
    settledAt: NOW + 2,
    text: "Two agents are waiting.",
    performedActs: 0,
    unknownActs: 0,
    askRecordedAt: NOW,
    ...overrides,
  };
}

/** A brain that accepts every submission into one run and remembers what it was asked. */
function acceptingBrain(asked: BrainSubmission[]): BrainAgent {
  // SAFETY: the ask path reads only `submitAsk` and `request` off the agent; the fixture stands in for the rest.
  return {
    submitAsk: async (submission: BrainSubmission) => {
      asked.push(submission);
      return { outcome: "accepted", runId: "run-1", acceptedAt: NOW };
    },
    request: () =>
      record({
        status: BRAIN_REQUEST_STATUS.QUEUED,
        question: "the accepted words",
        origin: asked.at(-1)?.origin ?? BRAIN_REQUEST_ORIGIN.TYPED,
        askRecordedAt: undefined,
      }),
    markAskRecorded: async (runId: string) => {
      askMarks.push(runId);
      return true;
    },
  } as unknown as BrainAgent;
}

const askMarks: string[] = [];

/** A thread the tests write into, as the main process's store would. */
function thread(fail = () => false) {
  let entries: readonly ConversationEntry[] = [];
  const recorded: { entry: ConversationEntry; at: number }[] = [];
  return {
    entries: () => entries,
    recorded,
    record: (entry: ConversationEntry, at: number) => {
      if (fail()) return false;
      recorded.push({ entry, at });
      entries = appendConversationThreadEntry(entries, entry, NOW + 100, at);
      return true;
    },
  };
}

/** A brain that only remembers which runs were marked recorded. */
function markingBrain(
  marked: string[],
  records: () => readonly BrainRequestRecord[] = () => [],
): Pick<BrainAgent, "markHistoryRecorded" | "markAskRecorded" | "request"> {
  return {
    markHistoryRecorded: async (runId) => {
      marked.push(runId);
      return true;
    },
    markAskRecorded: async (runId) => {
      marked.push(`ask ${runId}`);
      return true;
    },
    request: (runId) => records().find((record) => record.runId === runId),
  };
}

test("an ask with no brain is refused in fixed words, and nothing is recorded", async () => {
  const written = thread();
  const result = await submitBrainAsk(
    undefined,
    { submissionId: "sub-1", question: "what needs me?", origin: BRAIN_REQUEST_ORIGIN.TYPED },
    written.record,
  );
  assert.deepEqual(result, { outcome: "rejected", reason: "absent" });
  assert.equal(BRAIN_ASK_REFUSAL.absent.includes("OpenAI key"), true);
  assert.deepEqual(written.recorded, []);
});

test("a typed ask is bounded, handed to the brain whole, and recorded in the accepted record's words", async () => {
  const asked: BrainSubmission[] = [];
  const written = thread();
  const long = `  ${"a".repeat(maximumTypedAskLength + 50)}`;
  const result = await submitBrainAsk(
    acceptingBrain(asked),
    { submissionId: "sub-1", question: long, origin: BRAIN_REQUEST_ORIGIN.TYPED },
    written.record,
  );
  assert.deepEqual(result, { outcome: "accepted", runId: "run-1", acceptedAt: NOW });
  assert.equal(asked[0]?.question.length, maximumTypedAskLength);
  assert.equal(asked[0]?.submissionId, "sub-1");
  // The line is the run's own words at the run's own moment — what a retry
  // that found an earlier run would otherwise misquote.
  assert.deepEqual(written.recorded, [
    {
      entry: {
        kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
        words: "the accepted words",
        requestId: "run-1",
      },
      at: NOW,
    },
  ]);
  assert.equal(written.entries()[0]?.recordedAt, NOW);
});

test("a spoken ask records nothing here: the voice service's transcript is its line", async () => {
  const asked: BrainSubmission[] = [];
  const written = thread();
  await submitBrainAsk(
    acceptingBrain(asked),
    { submissionId: "call-1", question: "send it", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
    written.record,
  );
  assert.equal(asked[0]?.origin, BRAIN_REQUEST_ORIGIN.SPOKEN);
  assert.deepEqual(written.recorded, []);
});

test("a run's end reaches the thread once, at the moment it settled, decided against the live record", async () => {
  const written = thread();
  const marked: string[] = [];
  let live: BrainRequestRecord[] = [
    record({ status: BRAIN_REQUEST_STATUS.RUNNING, revision: 1, text: undefined }),
  ];
  const agent = markingBrain(marked, () => live);
  await publishRuns(agent, live, written.record);
  assert.equal(written.recorded.length, 0);
  live = [record()];
  await publishRuns(agent, live, written.record);
  assert.equal(written.recorded.length, 1);
  const [firstWrite] = written.recorded;
  assert.equal(firstWrite?.at, NOW + 2);
  assert.equal(written.entries()[0]?.recordedAt, NOW + 2);
  assert.deepEqual(marked, ["run-1"]);
  // Once marked, the live record says so: an unrelated later report, an
  // older report captured before the mark, a rebuilt follower, or a thread
  // that has since let the line go all leave it alone.
  live = [{ ...record(), historyRecordedAt: NOW + 2 }];
  await publishRuns(agent, [record()], written.record);
  live = [
    ...live,
    record({ runId: "run-2", status: BRAIN_REQUEST_STATUS.CANCELLED, text: undefined }),
  ];
  await publishRuns(agent, live, written.record);
  assert.equal(written.recorded.length, 2);
  const [, secondWrite] = written.recorded;
  assert.equal(secondWrite?.entry.words, "Cancelled.");
  assert.deepEqual(marked, ["run-1", "run-2"]);
  // A run the live agent no longer knows — the generation was reset — is not written.
  live = [];
  await publishRuns(agent, [record({ runId: "run-3" })], written.record);
  assert.equal(written.recorded.length, 2);
});

test("a retired follower stops between two records, and the second waits for a live report", async () => {
  const written = thread();
  const marked: string[] = [];
  const live = [record({ runId: "run-1" }), record({ runId: "run-2" })];
  let holdMark: (() => void) | undefined;
  const agent: Pick<BrainAgent, "request" | "markHistoryRecorded" | "markAskRecorded"> = {
    request: (runId) => live.find((entry) => entry.runId === runId),
    markAskRecorded: async () => true,
    markHistoryRecorded: (runId) =>
      new Promise((resolve) => {
        marked.push(runId);
        holdMark = () => resolve(true);
      }),
  };
  let following = true;
  const publishing = publishRuns(agent, live, written.record, () => following);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(marked, ["run-1"]);
  following = false;
  holdMark?.();
  await publishing;
  assert.equal(written.recorded.length, 1);
  assert.deepEqual(marked, ["run-1"]);
});

test("a run whose line the thread refused stays unmarked and is written on the next report", async () => {
  let refuse = true;
  const written = thread(() => refuse);
  const marked: string[] = [];
  const live = [record()];
  const agent = markingBrain(marked, () => live);
  await publishRuns(agent, live, written.record);
  assert.deepEqual(marked, []);
  assert.equal(written.recorded.length, 0);
  refuse = false;
  await publishRuns(agent, live, written.record);
  assert.deepEqual(marked, ["run-1"]);
  assert.equal(written.recorded.length, 1);
});

test("a typed ask whose line the thread refused at acceptance is written by a later report, at its acceptance", async () => {
  let refuse = true;
  const written = thread(() => refuse);
  const marked: string[] = [];
  const live = [
    record({
      status: BRAIN_REQUEST_STATUS.RUNNING,
      text: undefined,
      revision: 1,
      askRecordedAt: undefined,
    }),
  ];
  const agent = markingBrain(marked, () => live);
  await publishRuns(agent, live, written.record);
  assert.equal(written.recorded.length, 0);
  refuse = false;
  await publishRuns(agent, live, written.record);
  assert.deepEqual(marked, ["ask run-1"]);
  assert.equal(written.recorded[0]?.entry.kind, CONVERSATION_ENTRY_KIND.TYPED_ASK);
  assert.equal(written.recorded[0]?.entry.words, "what needs me?");
  assert.equal(written.recorded[0]?.at, NOW);
  // The end, written later, still lands after the ask in the thread.
  live[0] = { ...record(), askRecordedAt: NOW };
  await publishRuns(agent, live, written.record);
  assert.deepEqual(
    written.entries().map((entry) => entry.kind),
    [CONVERSATION_ENTRY_KIND.TYPED_ASK, CONVERSATION_ENTRY_KIND.REPLY],
  );
});

test("an end without a reply is worded from what was done, never from a provider's words", () => {
  const acted = { performedActs: 2, text: undefined };
  assert.equal(
    brainReplyWords(record({ status: BRAIN_REQUEST_STATUS.FAILED, failure: "model", ...acted })),
    "I did 2 things you asked, but I couldn't put the reply into words.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.FAILED, failure: "model", text: undefined }),
    ),
    "I couldn't work that one out. Ask me again in a moment.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.FAILED, failure: "persistence", performedActs: 1 }),
    ),
    "Two agents are waiting. I did one thing you asked, but I couldn't save my notes about it.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.SUCCEEDED, text: undefined, performedActs: 1 }),
    ),
    "Done: I did one thing you asked.",
  );
  assert.equal(
    brainReplyWords(record({ status: BRAIN_REQUEST_STATUS.TIMED_OUT, text: undefined })),
    "That ask ran out of time.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.INTERRUPTED, text: undefined, performedActs: 1 }),
    ),
    "That ask was interrupted, though I did one thing you asked.",
  );
  assert.equal(brainReplyWords(record({ status: BRAIN_REQUEST_STATUS.QUEUED })), undefined);
  // An act nobody confirmed is said as such, never as refused and never as done.
  assert.equal(
    brainReplyWords(
      record({
        status: BRAIN_REQUEST_STATUS.FAILED,
        failure: "model",
        text: undefined,
        unknownActs: 1,
      }),
    ),
    "one act may have gone through without confirming, so I won't repeat it on my own, but I couldn't put the reply into words.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.SUCCEEDED, unknownActs: 2, text: "Sent." }),
    ),
    "Sent. 2 acts may have gone through without confirming, so I won't repeat them on my own.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.FAILED, failure: "incomplete", text: undefined }),
    ),
    "I ran out of room before finishing that. Ask me again, perhaps in smaller pieces.",
  );
});

test("following a brain relays every report, writes and marks the ended runs, and stops when unfollowed", async () => {
  let listener: ((records: readonly BrainRequestRecord[]) => void) | undefined;
  const marked: string[] = [];
  const ready = record({
    status: BRAIN_REQUEST_STATUS.INTERRUPTED,
    text: undefined,
    askRecordedAt: NOW,
  });
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
    request: (runId: string) => [ready, record({ runId: "run-2" })].find((r) => r.runId === runId),
    markAskRecorded: async () => true,
    markHistoryRecorded: async (runId: string) => {
      marked.push(runId);
      return true;
    },
  } as unknown as BrainAgent;
  const broadcasts: (readonly BrainRequestRecord[])[] = [];
  const written = thread();
  const unfollow = followBrainRequests(agent, {
    recordConversationEntry: written.record,
    broadcastRequests: (snapshots) => broadcasts.push(snapshots),
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  // The launch's interrupted run is written and relayed once it is read.
  assert.equal(broadcasts.length, 1);
  assert.equal(written.entries()[0]?.words, "That ask was interrupted before I could finish it.");
  assert.deepEqual(marked, ["run-1"]);
  listener?.([{ ...ready, historyRecordedAt: NOW + 2 }, record({ runId: "run-2" })]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(broadcasts.length, 2);
  assert.equal(written.entries().length, 2);
  unfollow();
  assert.equal(listener, undefined);
});

test("a retired follower relays nothing a late report carries", async () => {
  let listener: ((records: readonly BrainRequestRecord[]) => void) | undefined;
  let releaseReady: (() => void) | undefined;
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
    markAskRecorded: async () => true,
    markHistoryRecorded: async () => true,
  } as unknown as BrainAgent;
  const broadcasts: (readonly BrainRequestRecord[])[] = [];
  const written = thread();
  const unfollow = followBrainRequests(agent, {
    recordConversationEntry: written.record,
    broadcastRequests: (snapshots) => broadcasts.push(snapshots),
  });
  unfollow();
  releaseReady?.();
  listener?.([record()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(broadcasts, []);
  assert.deepEqual(written.recorded, []);
});
