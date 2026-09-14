import assert from "node:assert/strict";
import {
  BRAIN_REQUEST_ORIGIN,
  BrainAgent,
  type BrainAgentOptions,
  BrainStateStore,
  detachOn,
  LOOK_SUBJECT,
  responsesModelAnswer,
  toolLoopRuntimeOver,
} from "@sidecar/brain";
import {
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainSubmission,
  type BrainSubmissionResult,
} from "@sidecar/brain/requests";
import type { BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import {
  type BareResponsesModel,
  bareModelAdapter,
  fakeActionPerformer,
  fakeBrainStateRepository,
} from "@sidecar/brain/testing";
import { MAIN_SESSION_KEY, type ModelResponse } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { Context, Effect } from "effect";
import { BrainHost } from "../brain/host.js";
import { followBrainRequests } from "../brain/publication.js";

/** The instant every clock in a brain fixture reads. */
const NOW = 1_800_000_000_000;

export interface BrainHarness {
  readonly repository: ReturnType<typeof fakeBrainStateRepository>;
  readonly store: BrainStateStore;
  readonly host: BrainHost;
  readonly build: (
    client: BareResponsesModel,
    options?: Partial<BrainAgentOptions>,
  ) => Effect.Effect<BrainAgent>;
  /** Submits to the brain that stands, or answers the absent refusal when none does. */
  readonly submit: (submission: BrainSubmission) => Effect.Effect<BrainSubmissionResult>;
  readonly submitMany: (count: number, from?: number) => Effect.Effect<string[]>;
  readonly broadcasts: (readonly BrainRequestSnapshot[])[];
}

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
 * main process composes them, with only the model synthetic.
 */
export function brainHarness(): Effect.Effect<BrainHarness> {
  return Effect.sync(() => {
    const repository = fakeBrainStateRepository();
    let ids = 0;
    const store = new BrainStateStore({
      repository,
      createGenerationId: () => `gen-${++ids}`,
      now: () => NOW,
    });
    const broadcasts: (readonly BrainRequestSnapshot[])[] = [];
    // The agents this harness builds take no execution of their own, so the
    // detach here carries the same empty set of services they run their turns
    // under.
    const host = new BrainHost({
      detach: detachOn(Context.empty()),
      follow: (agent) =>
        followBrainRequests(agent, {
          broadcastRequests: (snapshots) => {
            broadcasts.push(snapshots);
          },
        }),
      publishEmpty: () => broadcasts.push([]),
    });
    /** Submits to the standing brain, as the service's submit method did before it went (LUKE-206). */
    const submit = (submission: BrainSubmission): Effect.Effect<BrainSubmissionResult> =>
      Effect.suspend(() => {
        const agent = host.current();
        return agent
          ? agent.submitAsk(submission)
          : Effect.succeed({
              outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
              reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
            });
      });
    const submitMany = (count: number, from = 0) =>
      Effect.gen(function* () {
        const runIds: string[] = [];
        for (let index = from; index < from + count; index += 1) {
          const result = yield* submit({
            submissionId: `sub-${index}`,
            question: `ask ${index}`,
            origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
          });
          assert.equal(result.outcome, "accepted");
          if (result.outcome === "accepted") runIds.push(result.runId);
        }
        return runIds;
      });
    const build = (
      client: BareResponsesModel,
      options: Partial<BrainAgentOptions> = {},
    ): Effect.Effect<BrainAgent> => {
      const model = bareModelAdapter(client);
      return BrainAgent.make({
        conversationId: MAIN_SESSION_KEY,
        observes: { kind: LOOK_SUBJECT.NONE },
        ...options,
        runtime: toolLoopRuntimeOver(model),
        prepareTurn: () => ({ prompt: "instructions", layers: {} }),
        actions: fakeActionPerformer().actions,
        roster: () => ({ text: "", identities: [] }),
        standingContext: () => "",
        readTranscriptSince: () =>
          Effect.succeed({
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: "no",
          }),
        readTranscript: () =>
          Effect.succeed({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
        deliver: () => undefined,
        store,
        createRunId: () => `run-${++ids}`,
        report: () => {},
      });
    };
    return {
      repository,
      store,
      host,
      build,
      submit,
      submitMany,
      broadcasts,
    };
  });
}

/** A raw Responses payload as the adapter would normalize it. */
export function answerOf(payload: WireRecord): ModelResponse {
  const answer = responsesModelAnswer(payload);
  assert.ok(answer);
  return answer;
}
