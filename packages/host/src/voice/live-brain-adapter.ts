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
  type LiveBrainRunEnd,
  type LiveBrainRunEvent,
} from "./live-brain.js";

/** What the adapter says when no brain stands to take the ask at all. */
const NO_BRAIN_REFUSAL = BRAIN_ASK_REFUSAL[BRAIN_SUBMISSION_REJECTION.ABSENT];

/** The two things the adapter asks of the agent, so a test can stand in for it without the whole class. */
export type LiveBrainAgent = Pick<BrainAgent, "onRunEvent" | "submitAsk">;

export interface BrainAgentLiveBrainOptions {
  /** Main's brain as it stands now; nothing between credential transitions. */
  agent: () => LiveBrainAgent | undefined;
  /** The redacted roster view the brain's standing context carries. */
  rosterView: () => string;
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
 */
export function brainAgentLiveBrain(options: BrainAgentLiveBrainOptions): LiveBrain {
  const listeners = new Set<(event: LiveBrainRunEvent) => void>();
  const subscribed = new WeakSet<LiveBrainAgent>();

  function follow(agent: LiveBrainAgent): void {
    if (subscribed.has(agent)) return;
    subscribed.add(agent);
    agent.onRunEvent((event) => {
      const translated = liveRunEventOf(event);
      if (!translated) return;
      for (const listener of [...listeners]) listener(translated);
    });
  }

  return {
    submitAsk: async (ask) => {
      const agent = options.agent();
      if (!agent) return { outcome: LIVE_BRAIN_SUBMISSION.REFUSED, refusal: NO_BRAIN_REFUSAL };
      follow(agent);
      const result = await agent.submitAsk({
        submissionId: ask.submissionId,
        question: ask.question,
        origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
      });
      if (result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED) {
        return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: result.runId };
      }
      return { outcome: LIVE_BRAIN_SUBMISSION.REFUSED, refusal: BRAIN_ASK_REFUSAL[result.reason] };
    },
    onRunEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    standingRosterView: () => options.rosterView(),
  };
}
