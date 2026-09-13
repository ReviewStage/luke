import { BRAIN_RUN_EVENT, type BrainAgent, type BrainRunEvent } from "@sidecar/brain";
import {
  BRAIN_ASK_REFUSAL,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
} from "@sidecar/brain/requests";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAnticipationFacts,
  type LiveBrainAsk,
  type LiveBrainRunEnd,
  type LiveBrainRunEvent,
  type LiveBrainSubmission,
} from "@sidecar/voice/live-session";
import { Effect, Scope, Stream } from "effect";

/** What the adapter says when no brain stands to take the ask at all. */
const NO_BRAIN_REFUSAL = BRAIN_ASK_REFUSAL[BRAIN_SUBMISSION_REJECTION.ABSENT];

/**
 * What the adapter asks of the agent, so a test can stand in for it without
 * the whole class: the ask and its run seams always, and the read prefetch's
 * three where the agent has one.
 */
export type LiveBrainAgent = Pick<BrainAgent, "runEvents" | "submitAsk"> &
  Partial<Pick<BrainAgent, "anticipateAsk" | "dropAnticipation" | "onAnticipationFacts">>;

export interface BrainAgentLiveBrainOptions {
  /** Main's brain as it stands now; nothing between credential transitions. */
  agent: () => LiveBrainAgent | undefined;
}

function endOf(status: string): LiveBrainRunEnd {
  switch (status) {
    case BRAIN_REQUEST_STATUS.SUCCEEDED:
      return LIVE_BRAIN_RUN_END.COMPLETED;
    case BRAIN_REQUEST_STATUS.CANCELLED:
    case BRAIN_REQUEST_STATUS.INTERRUPTED:
      return LIVE_BRAIN_RUN_END.CANCELLED;
    default:
      return LIVE_BRAIN_RUN_END.FAILED;
  }
}

/**
 * The brain's run seams in the service's vocabulary, read by name: a kind
 * this build does not know is dropped, so a brain that gains kinds leaves
 * this adapter standing.
 */
function liveRunEventOf(event: BrainRunEvent): LiveBrainRunEvent | undefined {
  switch (event.kind) {
    case BRAIN_RUN_EVENT.SLOW_STEP:
      return { kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP, runId: event.runId, step: event.step };
    case BRAIN_RUN_EVENT.ACTIONS_SETTLED:
      return { kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: event.runId };
    case BRAIN_RUN_EVENT.REPLY_SENTENCE:
      return {
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: event.runId,
        sentence: event.sentence,
      };
    case BRAIN_RUN_EVENT.ENDED:
      return { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: event.runId, end: endOf(event.status) };
    default:
      return undefined;
  }
}

/**
 * Today's one implementation of the live brain: main's in-process agent. The
 * agent is rebuilt on every credential transition, so the adapter subscribes
 * to whichever agent stands when an ask is submitted, and forwards its events
 * for as long as it stands; a retired agent revokes its runs, and their ends
 * arrive through the subscription it had. Every ask reaches the agent through
 * `submitAsk` here — the host composes it from the live transcript — so
 * following the agent at submission is following every run it will report.
 * Following the same agent twice is one subscription.
 *
 * Built as a scoped effect, and answering effects: `LiveBrain`'s own faces
 * are effects, so everything the agent is asked for — its `submitAsk`, its
 * `anticipateAsk` — is yielded inside the effect the service runs, and the
 * adapter runs nothing itself. The run events are read as the `Stream` the
 * agent publishes rather than through a subscription face of its own:
 * following an agent takes its subscription on the fiber
 * that asked — which is why an ask follows before it submits, rather than
 * racing a subscription started beside it — and then pumps it into this
 * adapter's listeners on a fiber of the adapter's own scope. Closing that
 * scope ends every pump, and a listener that throws is logged rather than
 * left to end the pump it threw in, which is the guarantee the agent used to
 * hold.
 */
export function brainAgentLiveBrain(
  options: BrainAgentLiveBrainOptions,
): Effect.Effect<LiveBrain, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const listeners = new Set<(event: LiveBrainRunEvent) => void>();
    const factsListeners = new Set<(facts: LiveBrainAnticipationFacts) => void>();
    const subscribed = new WeakSet<LiveBrainAgent>();

    const follow = (agent: LiveBrainAgent): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (subscribed.has(agent)) return;
        subscribed.add(agent);
        const events = yield* Scope.provide(agent.runEvents, scope);
        yield* Effect.forkIn(
          Stream.runForEach(events, (event) =>
            Effect.catchAllDefect(
              Effect.sync(() => {
                const translated = liveRunEventOf(event);
                if (!translated) return;
                for (const listener of [...listeners]) listener(translated);
              }),
              (defect) =>
                Effect.logError("a listener failed while a run event was delivered", defect),
            ),
          ),
          scope,
        );
        // The brain keys an anticipation by the string the service handed it,
        // which is the service's own row number; it goes back as the number it
        // came from, and a key that is not one names no row and is dropped.
        agent.onAnticipationFacts?.((facts) => {
          const rowId = Number(facts.id);
          if (!Number.isInteger(rowId)) return;
          for (const listener of [...factsListeners]) listener({ rowId, text: facts.text });
        });
      });

    const spokenAsk = (ask: LiveBrainAsk): Effect.Effect<LiveBrainSubmission> =>
      Effect.gen(function* () {
        const agent = options.agent();
        if (!agent) return { outcome: LIVE_BRAIN_SUBMISSION.REFUSED, refusal: NO_BRAIN_REFUSAL };
        yield* follow(agent);
        const result = yield* agent.submitAsk({
          submissionId: ask.submissionId,
          question: ask.question,
          origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
        });
        if (result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED) {
          return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: result.runId };
        }
        return {
          outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
          refusal: BRAIN_ASK_REFUSAL[result.reason],
        };
      });

    return {
      anticipate: (anticipation) =>
        Effect.suspend(() => {
          const agent = options.agent();
          if (!agent?.anticipateAsk) return Effect.void;
          return Effect.andThen(
            follow(agent),
            agent.anticipateAsk({
              id: String(anticipation.rowId),
              partialAsk: anticipation.partialAsk,
              recentTurns: anticipation.recentTurns,
            }),
          );
        }),
      dropAnticipation: () =>
        Effect.sync(() => {
          options.agent()?.dropAnticipation?.();
        }),
      onAnticipationFacts: (listener) => {
        factsListeners.add(listener);
        return () => {
          factsListeners.delete(listener);
        };
      },
      submitAsk: spokenAsk,
      onRunEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  });
}
