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
import { followBrainRequests, recordEndedRuns, submitBrainAsk } from "./brain";

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
    request: () => record({ status: BRAIN_REQUEST_STATUS.QUEUED, question: "the accepted words" }),
  } as unknown as BrainAgent;
}

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
function markingBrain(marked: string[]): Pick<BrainAgent, "markHistoryRecorded"> {
  return {
    markHistoryRecorded: async (runId) => {
      marked.push(runId);
    },
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

test("a run's end reaches the thread once, at the moment it settled, and is then marked rather than re-read", async () => {
  const written = thread();
  const marked: string[] = [];
  const agent = markingBrain(marked);
  const running = record({ status: BRAIN_REQUEST_STATUS.RUNNING, revision: 1, text: undefined });
  await recordEndedRuns(agent, [running], written.record);
  assert.equal(written.recorded.length, 0);
  const ended = record();
  await recordEndedRuns(agent, [ended], written.record);
  assert.equal(written.recorded.length, 1);
  const [firstWrite] = written.recorded;
  assert.equal(firstWrite?.at, NOW + 2);
  assert.equal(written.entries()[0]?.recordedAt, NOW + 2);
  assert.deepEqual(marked, ["run-1"]);
  // Once marked, the record itself says so: an unrelated later report, a
  // rebuilt follower, or a thread that has since let the line go all leave
  // it alone.
  const published = { ...ended, historyRecordedAt: NOW + 2 };
  await recordEndedRuns(agent, [published], written.record);
  await recordEndedRuns(
    agent,
    [
      published,
      record({ runId: "run-2", status: BRAIN_REQUEST_STATUS.CANCELLED, text: undefined }),
    ],
    written.record,
  );
  assert.equal(written.recorded.length, 2);
  const [, secondWrite] = written.recorded;
  assert.equal(secondWrite?.entry.words, "Cancelled.");
  assert.deepEqual(marked, ["run-1", "run-2"]);
});

test("a run whose line the thread refused stays unmarked and is written on the next report", async () => {
  let refuse = true;
  const written = thread(() => refuse);
  const marked: string[] = [];
  const agent = markingBrain(marked);
  await recordEndedRuns(agent, [record()], written.record);
  assert.deepEqual(marked, []);
  assert.equal(written.recorded.length, 0);
  refuse = false;
  await recordEndedRuns(agent, [record()], written.record);
  assert.deepEqual(marked, ["run-1"]);
  assert.equal(written.recorded.length, 1);
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
  const ready = record({ status: BRAIN_REQUEST_STATUS.INTERRUPTED, text: undefined });
  // SAFETY: the follower reads only these four members off the agent.
  const agent = {
    subscribe: (next: (records: readonly BrainRequestRecord[]) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    ready: () => Promise.resolve(),
    requests: () => [ready],
    markHistoryRecorded: async (runId: string) => {
      marked.push(runId);
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
    markHistoryRecorded: async () => undefined,
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
