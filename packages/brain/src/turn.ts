import { queueSummaryText, type ToolDescriptor, type ToolPolicyLayers } from "@sidecar/runtime";
import { RUN_ORIGIN, type RunOrigin } from "@sidecar/runtime/vocabulary";
import type { Generation } from "./generation.js";
import type { RunEnd } from "./ledger.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  type BrainRequestOrigin,
  type BrainRequestRecord,
  type BrainRunUsage,
} from "./requests.js";
import type { ScheduledTimer } from "./seam.js";
import type { SteeredDeliveries } from "./steered-deliveries.js";
import type { RecordingContextEngine } from "./transcript-recorder.js";
import type { TurnEvents } from "./turn-events.js";
import type { BrainWakeEvent } from "./wake-events.js";

export const BRAIN_TURN_TRIGGER = {
  WAKE: "wake",
  ROSTER: "roster",
  ASK: "ask",
  HOLD_RELEASED: "hold-released",
  /** A child's own run: the delegated task, whose final text is the result its requester is handed. */
  CHILD_TASK: "child-task",
  /** A requester's turn opened by a child's completion, when no run of its own was there to steer. */
  CHILD_COMPLETION: "child-completion",
} as const;

export type BrainTurnTrigger = (typeof BRAIN_TURN_TRIGGER)[keyof typeof BRAIN_TURN_TRIGGER];

/** Who or what opened a turn of this kind: attribution for the record and the trace, never a permission. */
export function runOriginOf(trigger: BrainTurnTrigger): RunOrigin {
  switch (trigger) {
    case BRAIN_TURN_TRIGGER.ASK:
      return RUN_ORIGIN.USER;
    case BRAIN_TURN_TRIGGER.CHILD_TASK:
      return RUN_ORIGIN.CHILD;
    case BRAIN_TURN_TRIGGER.CHILD_COMPLETION:
      return RUN_ORIGIN.CHILD_COMPLETION;
    default:
      return RUN_ORIGIN.OBSERVATION;
  }
}

export const TURN_OUTCOME = {
  DONE: "done",
  QUIET: "quiet",
  FAILED: "failed",
  /** The model stopped without a reply: an incomplete output, or the loop guard's end. */
  INCOMPLETE: "incomplete",
  REVOKED: "revoked",
  /** The generation's checkpoint was written by a runtime this agent does not run; nothing was read or written. */
  INCOMPATIBLE: "incompatible",
} as const;

export type TurnOutcome = (typeof TURN_OUTCOME)[keyof typeof TURN_OUTCOME];

/** The outcomes a turn's own conversation reports to the host as a notice; the rest never ran. */
export const REPORTED_OUTCOMES: ReadonlySet<TurnOutcome> = new Set([
  TURN_OUTCOME.DONE,
  TURN_OUTCOME.QUIET,
  TURN_OUTCOME.FAILED,
  TURN_OUTCOME.INCOMPLETE,
]);

export type TurnResult =
  | { outcome: typeof TURN_OUTCOME.DONE; text: string; briefings: readonly string[] }
  | { outcome: typeof TURN_OUTCOME.QUIET; until: number }
  | { outcome: typeof TURN_OUTCOME.FAILED }
  | { outcome: typeof TURN_OUTCOME.INCOMPLETE }
  | { outcome: typeof TURN_OUTCOME.REVOKED }
  | { outcome: typeof TURN_OUTCOME.INCOMPATIBLE };

/**
 * One developer run's live controls: the signal its model and read work are
 * aborted through, and the flags every `isRevoked` reads. A run's execution
 * is revoked by the developer's cancel, by the deadline, by the agent
 * stopping, and by the store's generation being replaced under it.
 */
export interface RunControl {
  runId: string;
  /** Whether a request record stands behind this run, for the checkpoint to carry its accounting. */
  recorded: boolean;
  generation: Generation;
  abort: AbortController;
  cancelled: boolean;
  timedOut: boolean;
  deadline?: ScheduledTimer;
  /** Whether a checkpoint failed inside this run, after which no further action may be dispatched. */
  checkpointFailed: boolean;
  /** Whether the context had to be compacted before the run could be sent and could not be; the context stands as it was. */
  compactionFailed?: boolean;
  performedActions: number;
  unknownActions: number;
  /** What the run's inferences have cost so far, summed over every answer; nothing before the first. */
  usage?: BrainRunUsage;
  /** The id of every response the run was answered with, in order. */
  responseIds: string[];
}

/** A run's live controls as every run starts: nothing revoked, nothing failed, nothing yet done. */
export function newRunControl(
  runId: string,
  generation: Generation,
  recorded: boolean,
): RunControl {
  return {
    runId,
    generation,
    recorded,
    abort: new AbortController(),
    cancelled: false,
    timedOut: false,
    checkpointFailed: false,
    performedActions: 0,
    unknownActions: 0,
    responseIds: [],
  };
}

/**
 * What a run's end is read from: the flags its own execution set and the
 * generation it ran in. A rider's end is the primary's flags with its own
 * record, so nothing has to fabricate a control to reuse the reading.
 */
type RunEndFlags = Pick<
  RunControl,
  "generation" | "cancelled" | "timedOut" | "checkpointFailed" | "compactionFailed"
>;

/** How a run ended, as its record takes it: the status and what rides beside it. */
interface RunOutcome {
  status: BrainRequestRecord["status"];
  end: RunEnd;
}

/** How a run's turn result reads as its record's end. */
export function runOutcomeOf(flags: RunEndFlags, result: TurnResult, stopped: boolean): RunOutcome {
  const end: RunEnd = {};
  let status: BrainRequestRecord["status"];
  if (flags.timedOut) {
    status = BRAIN_REQUEST_STATUS.TIMED_OUT;
    end.failure = BRAIN_REQUEST_FAILURE.DEADLINE;
  } else if (flags.cancelled) {
    status = BRAIN_REQUEST_STATUS.CANCELLED;
  } else if (stopped || flags.generation.abort.signal.aborted) {
    status = BRAIN_REQUEST_STATUS.INTERRUPTED;
  } else if (flags.checkpointFailed) {
    // What the run did may be unrecorded; that outranks whatever the model
    // did afterwards, and the reply, if one formed, still travels.
    status = BRAIN_REQUEST_STATUS.FAILED;
    end.failure = BRAIN_REQUEST_FAILURE.PERSISTENCE;
    if (result.outcome === TURN_OUTCOME.DONE && result.text) end.text = result.text;
  } else if (flags.compactionFailed) {
    status = BRAIN_REQUEST_STATUS.FAILED;
    end.failure = BRAIN_REQUEST_FAILURE.COMPACTION;
  } else if (result.outcome === TURN_OUTCOME.INCOMPLETE) {
    status = BRAIN_REQUEST_STATUS.FAILED;
    end.failure = BRAIN_REQUEST_FAILURE.INCOMPLETE;
  } else if (result.outcome !== TURN_OUTCOME.DONE) {
    status = BRAIN_REQUEST_STATUS.FAILED;
    end.failure = BRAIN_REQUEST_FAILURE.MODEL;
  } else {
    status = BRAIN_REQUEST_STATUS.SUCCEEDED;
    if (result.text) end.text = result.text;
  }
  return { status, end };
}

/**
 * One ask as its turn reads it: the run that records it and the words the
 * model is shown for it, its question or, once the overflow folded it, the
 * one summary line the queue cut it to.
 */
export interface AskInput {
  readonly run: RunControl;
  readonly text: string;
  readonly folded: boolean;
}

/** The question one turn opens with for the asks that opened it: the overflow's summary first, then each ask's words. */
export function askQuestion(opened: readonly AskInput[]): string {
  const summaryLines = opened.filter((input) => input.folded).map((input) => input.text);
  const summary = queueSummaryText({
    entries: [],
    summaryLines,
    summarizedCount: summaryLines.length,
  });
  return [
    ...(summary === undefined ? [] : [summary]),
    ...opened.filter((input) => !input.folded).map((input) => input.text),
  ].join("\n\n");
}

interface TurnPlanBase {
  events: readonly BrainWakeEvent[];
  /** The words the turn opens with, each ingested as the developer's or the host's, in order. */
  open: (events: readonly BrainWakeEvent[], now: number) => readonly string[];
  /**
   * What the turn owes about the words in it: its opening words, and the
   * words steered into its run. Answered by the checkpoints that land and by
   * nothing else, so a host owed an answer about those words — a child's
   * completion — reads what is on disk, not how the turn ended.
   */
  deliveries: SteeredDeliveries;
  run?: RunControl;
  /**
   * The generation the work was queued in. A turn that reaches the front of
   * the queue in another generation is obsolete — a held briefing or a wake
   * of a memory that has since been discarded — and opens nothing.
   */
  generation: Generation;
}

export interface TurnPlan extends TurnPlanBase {
  trigger: BrainTurnTrigger;
  /** Where the ask that opened an ask's turn came from, for the prompt it is prepared under. */
  askOrigin?: BrainRequestOrigin;
}

/** The generation a turn opened in, the context it runs over, and the one signal every wait of the turn settles on. */
export interface TurnContext {
  generation: Generation;
  context: RecordingContextEngine;
  run: RunControl;
  signal: AbortSignal;
  /** The turn's one emitter of run events, so a compaction the maintenance folds after the turn is numbered in the turn's sequence. */
  events: TurnEvents;
  /** The inbox entries this turn opened with, consumed by its checkpoint and by nothing sooner. */
  consumes?: readonly string[];
}

/**
 * Whether a turn's work may still have an effect: its own signal covers the
 * developer's cancel, the deadline, and the generation's replacement, and the
 * agent's stop is the one flag the signal does not carry.
 */
export function turnRevoked(stopped: boolean, context: Pick<TurnContext, "signal">): boolean {
  return stopped || context.signal.aborted;
}

/**
 * What a host prepared a turn with: the prompt the model reads, the
 * configured policy layers, and the catalog they resolve over. The host
 * never resolves the policy itself; the agent does, once, adding the turn's
 * own layer, so the schemas the model is offered and the gate every dispatch
 * meets come from one resolution.
 */
export interface BrainTurnPreparation {
  readonly prompt: string;
  readonly layers: ToolPolicyLayers;
  /** The catalog the layers resolve over; the brain's own catalog when absent. */
  readonly catalog?: readonly ToolDescriptor[];
}

export const BRAIN_TURN_KIND = {
  /** A turn a model runs: an ask, a wake, a roster look, or a hold's release. */
  TURN: "turn",
  /** The housekeeping compaction after a turn, which reads the prompt and runs no tools. */
  MAINTENANCE: "maintenance",
} as const;

/** What a host is asked to prepare a turn for; an ask's turn says where its ask came from. */
export type BrainTurnDescription =
  | {
      readonly kind: typeof BRAIN_TURN_KIND.TURN;
      readonly trigger: BrainTurnTrigger;
      readonly askOrigin?: BrainRequestOrigin;
    }
  | { readonly kind: typeof BRAIN_TURN_KIND.MAINTENANCE };
