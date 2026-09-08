import type { ScheduledTimer } from "@sidecar/realtime";
import type { ToolDescriptor, ToolPolicyLayers } from "@sidecar/runtime";
import { RUN_ORIGIN, type RunOrigin } from "@sidecar/runtime-contracts";
import type { WireRecord } from "@sidecar/wire";
import type { Generation } from "./generation.js";
import type { RecordingContextEngine } from "./transcript-recorder.js";
import type { BrainWakeEvent } from "./wake-events.js";

export const BRAIN_TURN_TRIGGER = {
  WAKE: "wake",
  ROSTER: "roster",
  ASK: "ask",
  HOLD_RELEASED: "hold-released",
  /** The scheduled review: the workspace's HEARTBEAT.md instructions, under the full prompt, normally saying nothing. */
  HEARTBEAT: "heartbeat",
} as const;

export type BrainTurnTrigger = (typeof BRAIN_TURN_TRIGGER)[keyof typeof BRAIN_TURN_TRIGGER];

/** Who or what opened a turn of this kind: attribution for the record and the trace, never a permission. */
export function runOriginOf(trigger: BrainTurnTrigger): RunOrigin {
  switch (trigger) {
    case BRAIN_TURN_TRIGGER.ASK:
      return RUN_ORIGIN.USER;
    case BRAIN_TURN_TRIGGER.HEARTBEAT:
      return RUN_ORIGIN.HEARTBEAT;
    default:
      return RUN_ORIGIN.OBSERVATION;
  }
}

export const REFUSAL_REASON = {
  UNOBSERVED_SESSION: "not an observed session",
  ANNOUNCE_IN_ASK: "reply in text: this is a developer ask, and your final text is the speech",
  NOT_ALLOWED: "not run: the tool policy does not offer this tool in this turn",
  NOT_OFFERED: "not run: no such tool in this turn",
  EMPTY_BRIEFING: "a briefing needs words",
  ACT_FAILED: "the act did not complete",
  READ_FAILED: "the transcript could not be read",
  RUN_REVOKED: "not run: this ask was cancelled or its run ended",
  NOT_CHECKPOINTED: "not run: the act could not be recorded before running, so it was not run",
  CALL_ID_REUSED: "not run: this call id was already used with different arguments",
  NO_WORKSPACE: "not run: this agent has no workspace",
  MALFORMED_ARGUMENTS: "not run: the call's arguments are not the strings the tool takes",
} as const;

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

export type TurnResult =
  | { outcome: typeof TURN_OUTCOME.DONE; text: string; briefings?: readonly string[] }
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
  /** Whether a checkpoint failed inside this run, after which no further act may be dispatched. */
  checkpointFailed: boolean;
  /** Whether the context had to be compacted before the run could be sent and could not be; the context stands as it was. */
  compactionFailed?: boolean;
  performedActs: number;
  unknownActs: number;
}

export interface TurnPlan {
  trigger: BrainTurnTrigger;
  events: readonly BrainWakeEvent[];
  /** The words the turn opens with, each ingested as the developer's or the host's, in order. */
  open: (events: readonly BrainWakeEvent[], now: number) => readonly string[];
  /** Whether a roster look's events with nothing new in their transcript are left out. */
  dropEmptyRosterDeltas?: boolean;
  /** Asks steered or collected into this turn, settled with its end. */
  companions?: RunControl[];
  run?: RunControl;
  /**
   * The generation the work was queued in. A turn that reaches the front of
   * the queue in another generation is obsolete — a held briefing or a wake
   * of a memory that has since been discarded — and opens nothing.
   */
  generation: Generation;
}

/** The generation a turn opened in, the context it runs over, and the one signal every wait of the turn settles on. */
export interface TurnContext {
  generation: Generation;
  context: RecordingContextEngine;
  run: RunControl;
  signal: AbortSignal;
  /** The inbox entries this turn opened with, consumed by its checkpoint and by nothing sooner. */
  consumes?: readonly string[];
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

/** What a host is asked to prepare a turn for. */
export type BrainTurnDescription =
  | { readonly kind: typeof BRAIN_TURN_KIND.TURN; readonly trigger: BrainTurnTrigger }
  | { readonly kind: typeof BRAIN_TURN_KIND.MAINTENANCE };

export interface DispatchOutcome {
  callId: string;
  output: WireRecord;
}
