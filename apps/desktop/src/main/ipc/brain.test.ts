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
    ...overrides,
  };
}

/** A brain that accepts every submission into one run and remembers what it was asked. */
function acceptingBrain(asked: BrainSubmission[]): BrainAgent {
  // SAFETY: the ask path reads only `submitAsk` off the agent; the fixture stands in for the rest.
  return {
    submitAsk: async (submission: BrainSubmission) => {
      asked.push(submission);
      return { outcome: "accepted", runId: "run-1", acceptedAt: NOW };
    },
  } as unknown as BrainAgent;
}

test("an ask with no brain is refused in fixed words, and nothing is recorded", async () => {
  const recorded: ConversationEntry[] = [];
  const result = await submitBrainAsk(
    undefined,
    { submissionId: "sub-1", question: "what needs me?", origin: BRAIN_REQUEST_ORIGIN.TYPED },
    (entry) => recorded.push(entry),
  );
  assert.deepEqual(result, { outcome: "rejected", reason: "absent" });
  assert.equal(BRAIN_ASK_REFUSAL.absent.includes("OpenAI key"), true);
  assert.deepEqual(recorded, []);
});

test("a typed ask is bounded, handed to the brain whole, and recorded under its run", async () => {
  const asked: BrainSubmission[] = [];
  const recorded: ConversationEntry[] = [];
  const long = `  ${"a".repeat(maximumTypedAskLength + 50)}`;
  const result = await submitBrainAsk(
    acceptingBrain(asked),
    { submissionId: "sub-1", question: long, origin: BRAIN_REQUEST_ORIGIN.TYPED },
    (entry) => recorded.push(entry),
  );
  assert.deepEqual(result, { outcome: "accepted", runId: "run-1", acceptedAt: NOW });
  assert.equal(asked[0]?.question.length, maximumTypedAskLength);
  assert.equal(asked[0]?.submissionId, "sub-1");
  assert.deepEqual(recorded, [
    {
      kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
      words: "a".repeat(maximumTypedAskLength),
      requestId: "run-1",
    },
  ]);
});

test("a spoken ask records nothing here: the voice service's transcript is its line", async () => {
  const asked: BrainSubmission[] = [];
  const recorded: ConversationEntry[] = [];
  await submitBrainAsk(
    acceptingBrain(asked),
    { submissionId: "call-1", question: "send it", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
    (entry) => recorded.push(entry),
  );
  assert.equal(asked[0]?.origin, BRAIN_REQUEST_ORIGIN.SPOKEN);
  assert.deepEqual(recorded, []);
});

test("a run's end reaches the thread exactly once, worded by the build, however often it is reported", () => {
  let thread: readonly ConversationEntry[] = [];
  const recordInThread = (entry: ConversationEntry) => {
    thread = appendConversationThreadEntry(thread, entry, NOW);
  };
  const line = (index: number): ConversationEntry | undefined => thread[index];
  const running = record({ status: BRAIN_REQUEST_STATUS.RUNNING, revision: 1, text: undefined });
  recordEndedRuns([running], recordInThread);
  assert.deepEqual(thread, []);
  const ended = record();
  recordEndedRuns([ended], recordInThread);
  recordEndedRuns([ended], recordInThread);
  recordEndedRuns([{ ...ended, revision: 4 }], recordInThread);
  assert.equal(thread.length, 1);
  assert.equal(line(0)?.kind, CONVERSATION_ENTRY_KIND.REPLY);
  assert.equal(line(0)?.words, "Two agents are waiting.");
  assert.equal(line(0)?.requestId, "run-1");
  // A second run's end is its own line.
  recordEndedRuns(
    [ended, record({ runId: "run-2", status: BRAIN_REQUEST_STATUS.CANCELLED, text: undefined })],
    recordInThread,
  );
  assert.equal(thread.length, 2);
  assert.equal(line(1)?.words, "Cancelled.");
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
    "That ask was interrupted after one thing you asked had gone through.",
  );
  assert.equal(brainReplyWords(record({ status: BRAIN_REQUEST_STATUS.QUEUED })), undefined);
});

test("following a brain relays every report and writes the ended runs, and stops when unfollowed", async () => {
  let listener: ((records: readonly BrainRequestRecord[]) => void) | undefined;
  const ready = record({ status: BRAIN_REQUEST_STATUS.INTERRUPTED, text: undefined });
  // SAFETY: the follower reads only these three members off the agent.
  const agent = {
    subscribe: (next: (records: readonly BrainRequestRecord[]) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    ready: () => Promise.resolve(),
    requests: () => [ready],
  } as unknown as BrainAgent;
  const broadcasts: (readonly BrainRequestRecord[])[] = [];
  let thread: readonly ConversationEntry[] = [];
  const unfollow = followBrainRequests(agent, {
    recordConversationEntry: (entry) => {
      thread = appendConversationThreadEntry(thread, entry, NOW);
    },
    broadcastRequests: (snapshots) => broadcasts.push(snapshots),
  });
  await new Promise((resolve) => setImmediate(resolve));
  // The launch's interrupted run is written and relayed once it is read.
  assert.equal(broadcasts.length, 1);
  assert.equal(thread[0]?.words, "That ask was interrupted before I could finish it.");
  listener?.([ready, record({ runId: "run-2" })]);
  assert.equal(broadcasts.length, 2);
  assert.equal(thread.length, 2);
  unfollow();
  assert.equal(listener, undefined);
});
