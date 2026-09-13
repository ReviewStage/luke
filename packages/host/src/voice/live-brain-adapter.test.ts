import assert from "node:assert/strict";
import {
  BRAIN_RUN_EVENT,
  type BrainAnticipation,
  type BrainAnticipationFacts,
  type BrainRunEvent,
  type BrainRunEventBody,
} from "@sidecar/brain";
import {
  BRAIN_ASK_REFUSAL,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainSubmission,
} from "@sidecar/brain/requests";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { Effect, Exit, PubSub, Scope, Stream } from "effect";
import { afterAll, test } from "vitest";
import { brainAgentLiveBrain, type LiveBrainAgent } from "./live-brain-adapter.js";

/** The scope every adapter in this file is built in; its close is what ends their pumps. */
const scope = Effect.runSync(Scope.make());

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

const liveBrain = (agent: () => LiveBrainAgent | undefined) =>
  Effect.runPromise(Scope.provide(brainAgentLiveBrain({ agent }), scope));

/** The adapter pumps the agent's stream on a fiber of its own, so a fired event is heard a turn later. */
const settle = () => Effect.runPromise(Effect.repeat(Effect.yieldNow, { times: 20 }));

/** The stamp every run event carries beside its own fields, as the agent's teller adds it: the conversation, the turn, its place in it. */
function stamped(published: PubSub.PubSub<BrainRunEvent>) {
  let sequence = 0;
  return {
    fire: (body: BrainRunEventBody) => {
      sequence += 1;
      // SAFETY: the body's own kind fields are BrainRunEventBody's; the stamp adds only the fields the agent's teller always adds.
      const event = {
        ...body,
        conversationId: MAIN_SESSION_KEY,
        turnId: "runId" in body ? body.runId : body.kind,
        sequence,
      } as BrainRunEvent;
      PubSub.publishUnsafe(published, event);
    },
  };
}

function fakeAgent(options: { reject?: boolean } = {}) {
  const published = Effect.runSync(PubSub.unbounded<BrainRunEvent>());
  const events = stamped(published);
  const submissions: BrainSubmission[] = [];
  const agent: LiveBrainAgent = {
    runEvents: Effect.map(PubSub.subscribe(published), Stream.fromSubscription),
    submitAsk: (submission) =>
      Effect.sync(() => {
        submissions.push(submission);
        if (options.reject) {
          return {
            outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
            reason: BRAIN_SUBMISSION_REJECTION.FULL,
          };
        }
        return { outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED, runId: "run-1", acceptedAt: 1 };
      }),
  };
  return { agent, events, submissions };
}

test("a spoken ask crosses under the spoken origin with the caller's submission id, and an acceptance names the run", async () => {
  const fake = fakeAgent();
  const brain = await liveBrain(() => fake.agent);
  const result = await Effect.runPromise(
    brain.submitAsk({ submissionId: "sub-1", question: "Developer: hi" }),
  );
  assert.deepEqual(result, { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: "run-1" });
  assert.deepEqual(fake.submissions, [
    { submissionId: "sub-1", question: "Developer: hi", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
  ]);
});

test("a rejection carries the brain's standing refusal for its reason, and no agent at all the absent one", async () => {
  const fake = fakeAgent({ reject: true });
  const brain = await liveBrain(() => fake.agent);
  assert.deepEqual(await Effect.runPromise(brain.submitAsk({ submissionId: "s", question: "q" })), {
    outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
    refusal: BRAIN_ASK_REFUSAL[BRAIN_SUBMISSION_REJECTION.FULL],
  });
  const absent = await liveBrain(() => undefined);
  assert.deepEqual(
    await Effect.runPromise(absent.submitAsk({ submissionId: "s", question: "q" })),
    {
      outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
      refusal: BRAIN_ASK_REFUSAL[BRAIN_SUBMISSION_REJECTION.ABSENT],
    },
  );
});

test("the run seams are read by name and translated; a kind this build does not know is dropped", async () => {
  const fake = fakeAgent();
  const brain = await liveBrain(() => fake.agent);
  const heard: LiveBrainRunEvent[] = [];
  brain.onRunEvent((event) => heard.push(event));
  await Effect.runPromise(brain.submitAsk({ submissionId: "s", question: "q" }));
  fake.events.fire({ kind: BRAIN_RUN_EVENT.SLOW_STEP, runId: "run-1", step: "transcript_read" });
  fake.events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  fake.events.fire({ kind: BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Done." });
  // SAFETY: a later brain may fire kinds this adapter has never heard of; the test hands one in as such.
  fake.events.fire({ kind: "tool_call", runId: "run-1" } as unknown as BrainRunEvent);
  fake.events.fire({
    kind: BRAIN_RUN_EVENT.ENDED,
    runId: "run-1",
    status: BRAIN_REQUEST_STATUS.SUCCEEDED,
  });
  fake.events.fire({
    kind: BRAIN_RUN_EVENT.ENDED,
    runId: "run-2",
    status: BRAIN_REQUEST_STATUS.CANCELLED,
  });
  fake.events.fire({
    kind: BRAIN_RUN_EVENT.ENDED,
    runId: "run-3",
    status: BRAIN_REQUEST_STATUS.INTERRUPTED,
  });
  fake.events.fire({
    kind: BRAIN_RUN_EVENT.ENDED,
    runId: "run-4",
    status: BRAIN_REQUEST_STATUS.TIMED_OUT,
  });
  await settle();
  assert.deepEqual(heard, [
    { kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP, runId: "run-1", step: "transcript_read" },
    { kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" },
    { kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Done." },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: "run-1", end: LIVE_BRAIN_RUN_END.COMPLETED },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: "run-2", end: LIVE_BRAIN_RUN_END.CANCELLED },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: "run-3", end: LIVE_BRAIN_RUN_END.CANCELLED },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: "run-4", end: LIVE_BRAIN_RUN_END.FAILED },
  ]);
});

test("an ask follows the agent before it submits, so the first event of the run it opens is heard", async () => {
  const published = Effect.runSync(PubSub.unbounded<BrainRunEvent>());
  const events = stamped(published);
  const agent: LiveBrainAgent = {
    // A subscription that takes a tick of its own, as the agent's does once a
    // fiber stands between the caller and the pubsub it subscribes to.
    runEvents: Effect.andThen(
      Effect.yieldNow,
      Effect.map(PubSub.subscribe(published), Stream.fromSubscription),
    ),
    submitAsk: () =>
      Effect.sync(() => {
        events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
        return { outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED, runId: "run-1", acceptedAt: 1 };
      }),
  };
  const brain = await liveBrain(() => agent);
  const heard: string[] = [];
  brain.onRunEvent((event) => heard.push(event.runId));
  await Effect.runPromise(brain.submitAsk({ submissionId: "s", question: "q" }));
  await settle();
  assert.deepEqual(heard, ["run-1"]);
});

test("an agent rebuilt between asks is followed once each, and a listener let go hears nothing more", async () => {
  const first = fakeAgent();
  const second = fakeAgent();
  let current = first;
  const brain = await liveBrain(() => current.agent);
  const heard: string[] = [];
  const stop = brain.onRunEvent((event) => heard.push(event.runId));
  await Effect.runPromise(brain.submitAsk({ submissionId: "a", question: "q" }));
  await Effect.runPromise(brain.submitAsk({ submissionId: "b", question: "q" }));
  current = second;
  await Effect.runPromise(brain.submitAsk({ submissionId: "c", question: "q" }));
  first.events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "from-first" });
  second.events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "from-second" });
  await settle();
  assert.deepEqual(heard, ["from-first", "from-second"]);
  stop();
  second.events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "unheard" });
  await settle();
  assert.deepEqual(heard, ["from-first", "from-second"]);
});

/** An agent with the read prefetch's three seams, recording what reached them. */
function anticipatingAgent() {
  const base = fakeAgent();
  const anticipations: BrainAnticipation[] = [];
  const factsListeners = new Set<(facts: BrainAnticipationFacts) => void>();
  let drops = 0;
  const agent: LiveBrainAgent = {
    ...base.agent,
    anticipateAsk: (anticipation) =>
      Effect.sync(() => {
        anticipations.push(anticipation);
      }),
    dropAnticipation: () => {
      drops += 1;
    },
    onAnticipationFacts: (listener) => {
      factsListeners.add(listener);
      return () => {
        factsListeners.delete(listener);
      };
    },
  };
  const facts = {
    fire: (heard: BrainAnticipationFacts) => {
      for (const listener of [...factsListeners]) listener(heard);
    },
  };
  return { agent, anticipations, facts, drops: () => drops };
}

test("an anticipation crosses with the row as the brain's key, a drop reaches the agent, and facts come back under the row they were read for", async () => {
  const fake = anticipatingAgent();
  const brain = await liveBrain(() => fake.agent);
  const heard: { rowId: number; text: string }[] = [];
  brain.onAnticipationFacts?.((facts) => heard.push(facts));
  await Effect.runPromise(
    brain.anticipate?.({ rowId: 7, partialAsk: "what is", recentTurns: "Developer: what is" }) ??
      Effect.void,
  );
  assert.deepEqual(fake.anticipations, [
    { id: "7", partialAsk: "what is", recentTurns: "Developer: what is" },
  ]);
  fake.facts.fire({ id: "7", text: "The agent finished the tests." });
  fake.facts.fire({ id: "not-a-row", text: "dropped" });
  assert.deepEqual(heard, [{ rowId: 7, text: "The agent finished the tests." }]);
  await Effect.runPromise(brain.dropAnticipation?.() ?? Effect.void);
  assert.equal(fake.drops(), 1);
});

test("an agent without the prefetch, or no agent at all, takes no anticipation and reports no facts", async () => {
  const plain = fakeAgent();
  const brain = await liveBrain(() => plain.agent);
  await Effect.runPromise(
    brain.anticipate?.({ rowId: 1, partialAsk: "hi", recentTurns: "Developer: hi" }) ?? Effect.void,
  );
  await Effect.runPromise(brain.dropAnticipation?.() ?? Effect.void);
  const absent = await liveBrain(() => undefined);
  await Effect.runPromise(
    absent.anticipate?.({ rowId: 1, partialAsk: "hi", recentTurns: "Developer: hi" }) ??
      Effect.void,
  );
  await Effect.runPromise(absent.dropAnticipation?.() ?? Effect.void);
  assert.deepEqual(plain.submissions, []);
});
