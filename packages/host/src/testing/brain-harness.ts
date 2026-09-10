import assert from "node:assert/strict";
import {
  BRAIN_REQUEST_ORIGIN,
  BrainAgent,
  type BrainAgentOptions,
  BrainStateStore,
  LOOK_SUBJECT,
  responsesModelAnswer,
  toolLoopRuntimeOver,
} from "@sidecar/brain";
import type { BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import {
  type BareResponsesModel,
  bareModelAdapter,
  fakeActionPerformer,
  fakeBrainStateRepository,
} from "@sidecar/brain/testing";
import { MAIN_SESSION_KEY, type ModelResponse } from "@sidecar/runtime/vocabulary";
import {
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { BrainHost } from "../brain/host.js";
import { followBrainRequests } from "../brain/publication.js";
import { operatorOverBrain } from "./operator-over-brain.js";

/** The instant every clock in a brain fixture reads. */
const NOW = 1_800_000_000_000;

/** A model that answers nothing until the test says so. */
export function heldModel(): BareResponsesModel & { release: (answer: ModelResponse) => void } {
  const waiting: ((answer: ModelResponse) => void)[] = [];
  return {
    respond: () =>
      new Promise((resolve) => {
        waiting.push(resolve);
      }),
    quietUntil: () => undefined,
    release: (answer) => {
      for (const resolve of waiting.splice(0)) resolve(answer);
    },
  };
}

/**
 * The real agent, store, host, follower, and submission path composed as the
 * main process composes them, with only the model and the disk synthetic.
 */
export function brainHarness() {
  const repository = fakeBrainStateRepository();
  let ids = 0;
  const store = new BrainStateStore({
    repository,
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  let thread: readonly ConversationEntry[] = [];
  let refuseWrites = false;
  const broadcasts: (readonly BrainRequestSnapshot[])[] = [];
  const record = (entry: ConversationEntry, at: number) => {
    if (refuseWrites) return false;
    thread = appendConversationThreadEntry(thread, entry, NOW + 1000, at);
    return true;
  };
  const host = new BrainHost({
    follow: (agent) =>
      followBrainRequests(agent, {
        recordConversationEntry: record,
        broadcastRequests: (snapshots) => {
          broadcasts.push(snapshots);
        },
      }),
    publishEmpty: () => broadcasts.push([]),
  });
  /** Submits as a window does, through the operator over the standing brain; the ask's own line is written here. */
  const { submit } = operatorOverBrain({
    current: () => host.current(),
    recordConversationEntry: record,
  });
  const submitMany = async (count: number, from = 0) => {
    const runIds: string[] = [];
    for (let index = from; index < from + count; index += 1) {
      const result = await submit({
        submissionId: `sub-${index}`,
        question: `ask ${index}`,
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
      });
      assert.equal(result.outcome, "accepted");
      if (result.outcome === "accepted") runIds.push(result.runId);
    }
    return runIds;
  };
  const build = (client: BareResponsesModel, options: Partial<BrainAgentOptions> = {}) => {
    const model = bareModelAdapter(client);
    return new BrainAgent({
      conversationId: MAIN_SESSION_KEY,
      observes: { kind: LOOK_SUBJECT.NONE },
      ...options,
      runtime: toolLoopRuntimeOver(model),
      prepareTurn: () => ({ prompt: "instructions", layers: {} }),
      actions: fakeActionPerformer().actions,
      roster: () => ({ text: "", identities: [] }),
      standingContext: () => "",
      readTranscriptSince: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
      readTranscript: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
      deliver: () => undefined,
      store,
      createRunId: () => `run-${++ids}`,
      report: () => {},
      now: () => NOW,
      // A run left in flight at a test's end must not hold the process open:
      // its deadline timers are unreferenced, as the test's own would be.
      schedule: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        timer.unref();
        return timer;
      },
      // SAFETY: the handle is what `schedule` above returned, which is always a `setTimeout` timer.
      cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });
  };
  return {
    repository,
    store,
    host,
    build,
    submit,
    thread: () => thread,
    replies: (runId: string) =>
      thread.filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY && e.requestId === runId),
    submitMany,
    broadcasts,
    refuse: (value: boolean) => {
      refuseWrites = value;
    },
  };
}

/** A raw Responses payload as the adapter would normalize it. */
export function answerOf(payload: WireRecord): ModelResponse {
  const answer = responsesModelAnswer(payload);
  assert.ok(answer);
  return answer;
}
