import { ACTION_OUTPUT_STATUS } from "@sidecar/actions";
import { type EffectiveToolPolicy, TOOL_EFFECT, TOOL_EXECUTION } from "@sidecar/runtime";
import type { CompactionSource, RuntimeCompaction, SessionKey } from "@sidecar/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import type { UIMessage } from "ai";
import {
  BRAIN_REQUEST_ORIGIN,
  type BrainRequestFailure,
  type BrainRequestOrigin,
  type BrainRequestStatus,
  type BrainRunUsage,
} from "./requests.js";
import { BRAIN_TOOL } from "./tools.js";
import { BRAIN_TURN_TRIGGER, type BrainTurnTrigger } from "./turn.js";

/**
 * What a turn tells whoever is listening, as it happens, whichever kind of
 * turn it is: a developer's ask, an observation, a hold's release, a child's
 * task, or a child's completion. Two audiences hear one stream. A relay into
 * a live conversation reads the recorded run's moments: the one step worth a
 * spoken update, the moment every action it took has its result journaled,
 * the final answer a sentence at a time once that moment has passed, and the
 * record's end. A writer keeping the conversation reads the turn whole: its
 * start and origin, each tool call before it runs and its output or error
 * after, each reasoning item's summary beside the provider's opaque item, the
 * messages the turn completed as AI SDK `UIMessage`s, a compaction it folded,
 * and its end with the status, the usage split four ways, and the response
 * ids. Every event carries the conversation's key, the turn's id, and its
 * place in the turn's sequence, numbered from one by the turn's one teller
 * (`TurnEvents`), which fires them in order, so a consumer can verify it
 * heard the turn whole. A listener that throws ends no turn.
 */

export const BRAIN_RUN_EVENT = {
  /** The run began a step slow enough to be worth telling the developer about; fired once per run. */
  SLOW_STEP: "slow_step",
  /** Every action the run dispatched has its result journaled; nothing it did is still uncertain. */
  ACTIONS_SETTLED: "actions_settled",
  /** One sentence of the final answer, in order, after the actions settled. */
  REPLY_SENTENCE: "reply_sentence",
  /** The run's record reached a terminal status. */
  ENDED: "ended",
  /** The turn opened past its door and is about to read its opening words. */
  TURN_STARTED: "turn_started",
  /** The model asked for a tool; nothing of the call has run yet. */
  TOOL_CALL_STARTED: "tool_call_started",
  /** The tool answered, or was refused, and its output is in the context. */
  TOOL_CALL_SETTLED: "tool_call_settled",
  /** One reasoning item of an answer is in the context. */
  REASONING_COMPLETED: "reasoning_completed",
  /** A message of the turn is complete: the words the turn opened with, words steered in, or the model's finished answer. */
  MESSAGE_COMPLETED: "message_completed",
  /** The context was folded, before the turn's first inference or inside the run. */
  COMPACTION_COMPLETED: "compaction_completed",
  /** The turn's execution is over, however it ended. */
  TURN_ENDED: "turn_ended",
} as const;

export type BrainRunEventKind = (typeof BRAIN_RUN_EVENT)[keyof typeof BRAIN_RUN_EVENT];

/** The kinds of step that count as slow: a whole transcript read, or a write the provider carries. */
export const SLOW_STEP_KIND = {
  TRANSCRIPT_READ: "transcript_read",
  PROVIDER_WRITE: "provider_write",
} as const;

export type SlowStepKind = (typeof SLOW_STEP_KIND)[keyof typeof SLOW_STEP_KIND];

/** Who or what opened a turn, as the turn's record takes it: attribution, never a permission. */
export const BRAIN_TURN_ORIGIN = {
  /** A developer's ask typed into a composer. */
  TYPED: "typed",
  /** A developer's ask spoken, relayed by the voice service. */
  SPOKEN: "spoken",
  /** A provider's hook or the roster look on the observation pass. */
  OBSERVATION: "observation",
  /** A hold's release of briefings decided earlier. */
  HOLD_RELEASE: "hold_release",
  /** A child's own delegated task. */
  CHILD: "child",
  /** A requester's turn opened by a child's completion. */
  CHILD_COMPLETION: "child_completion",
} as const;

export type BrainTurnOrigin = (typeof BRAIN_TURN_ORIGIN)[keyof typeof BRAIN_TURN_ORIGIN];

/** The origin a turn's trigger and, for an ask, its ask's origin amount to. */
export function turnOriginOf(
  trigger: BrainTurnTrigger,
  askOrigin: BrainRequestOrigin | undefined,
): BrainTurnOrigin {
  switch (trigger) {
    case BRAIN_TURN_TRIGGER.ASK:
      return askOrigin === BRAIN_REQUEST_ORIGIN.SPOKEN
        ? BRAIN_TURN_ORIGIN.SPOKEN
        : BRAIN_TURN_ORIGIN.TYPED;
    case BRAIN_TURN_TRIGGER.CHILD_TASK:
      return BRAIN_TURN_ORIGIN.CHILD;
    case BRAIN_TURN_TRIGGER.CHILD_COMPLETION:
      return BRAIN_TURN_ORIGIN.CHILD_COMPLETION;
    case BRAIN_TURN_TRIGGER.HOLD_RELEASED:
      return BRAIN_TURN_ORIGIN.HOLD_RELEASE;
    case BRAIN_TURN_TRIGGER.WAKE:
    case BRAIN_TURN_TRIGGER.ROSTER:
      return BRAIN_TURN_ORIGIN.OBSERVATION;
  }
}

/** How a tool call settled, in the AI SDK's own words for a tool part's state. */
export const TOOL_CALL_SETTLEMENT = {
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

/**
 * The statuses under which a tool's output is a refusal rather than an
 * answer: a performer's rejection (the runtime's loop guard answers with it
 * too), an act the provider does not support, or an admission's refusal.
 * Only these settle a call as an error. An unknown outcome is not among them
 * on purpose: a call dispatched whose effect is uncertain did answer, and its
 * answer is the envelope saying so — the action performer's, or the
 * runtime's own for any tool that did not answer — which the record keeps
 * whole rather than folding into an error that would read as a refusal, the
 * opposite claim and one that would license doing it again.
 */
export const TOOL_REFUSAL_STATUS = {
  REJECTED: ACTION_RESULT_STATUS.REJECTED,
  UNSUPPORTED: ACTION_RESULT_STATUS.UNSUPPORTED,
  REFUSED: ACTION_OUTPUT_STATUS.REFUSED,
} as const;

export type ToolRefusalStatus = (typeof TOOL_REFUSAL_STATUS)[keyof typeof TOOL_REFUSAL_STATUS];

const TOOL_REFUSAL_STATUS_LIST: readonly string[] = Object.values(TOOL_REFUSAL_STATUS);

export function isToolRefusalStatus(status: string): status is ToolRefusalStatus {
  return TOOL_REFUSAL_STATUS_LIST.includes(status);
}

/**
 * A tool call's outcome: its output as the model read it, parsed, and the
 * status word the output carried. A refusal is an error, its text the
 * output's own reason, and only a refusal status can make one; every other
 * answer — an acceptance, a tool's plain output, or an envelope whose status
 * is unknown — is available, envelope and all.
 */
export type ToolCallSettlement =
  | {
      readonly state: typeof TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE;
      readonly output: UnparsedWireValue;
      readonly status?: string;
    }
  | {
      readonly state: typeof TOOL_CALL_SETTLEMENT.OUTPUT_ERROR;
      readonly output: UnparsedWireValue;
      readonly errorText: string;
      readonly status: ToolRefusalStatus;
    };

/** A compaction as the turn reports it: which way it folded, how much, and the summary where one was written. */
export interface TurnCompaction {
  readonly source: CompactionSource;
  readonly dropped: number;
  readonly summary?: string;
}

/** What every event of the stream carries beside its own fields. */
interface BrainRunEventBase {
  /** The conversation's key, which is its id in this build. */
  readonly conversationId: SessionKey;
  /** The turn the event belongs to: the primary run's id for an ask's turn, the turn's own for the rest. */
  readonly turnId: string;
  /**
   * The event's place in the turn, numbered from one. `TURN_ENDED` is the
   * last event of a turn, after every record that rode to its end has ended;
   * a rider withdrawn mid-turn ends where it was withdrawn, numbered in the
   * turn it left; a record's end that never opened a turn stands alone at one.
   */
  readonly sequence: number;
}

export type BrainRunEventBody =
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.SLOW_STEP;
      readonly runId: string;
      readonly step: SlowStepKind;
    }
  | { readonly kind: typeof BRAIN_RUN_EVENT.ACTIONS_SETTLED; readonly runId: string }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.REPLY_SENTENCE;
      readonly runId: string;
      readonly sentence: string;
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.ENDED;
      readonly runId: string;
      readonly status: BrainRequestStatus;
      readonly text?: string;
      readonly failure?: BrainRequestFailure;
      /** What the run's inferences cost, split four ways, when it was answered at all. */
      readonly usage?: BrainRunUsage;
      /** The id of every response OpenAI answered the run with, in order. */
      readonly responseIds?: readonly string[];
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.TURN_STARTED;
      readonly origin: BrainTurnOrigin;
      readonly trigger: BrainTurnTrigger;
      readonly at: number;
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.TOOL_CALL_STARTED;
      readonly callId: string;
      readonly name: string;
      /** The call's arguments parsed, or the raw arguments text when they do not parse. */
      readonly input: UnparsedWireValue;
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.TOOL_CALL_SETTLED;
      readonly callId: string;
      readonly name: string;
      readonly settlement: ToolCallSettlement;
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.REASONING_COMPLETED;
      readonly summary: string;
      /** The provider's item, opaque and whole, as the context ingested it. */
      readonly item: WireRecord;
    }
  | { readonly kind: typeof BRAIN_RUN_EVENT.MESSAGE_COMPLETED; readonly message: UIMessage }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.COMPACTION_COMPLETED;
      readonly compaction: TurnCompaction;
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.TURN_ENDED;
      readonly status: BrainRequestStatus;
      readonly failure?: BrainRequestFailure;
      /** What the turn's inferences cost, split four ways, as the run kept them; absent when no inference answered. */
      readonly usage?: BrainRunUsage;
      /** The id of every response the turn was answered with, in order. */
      readonly responseIds: readonly string[];
      readonly at: number;
    };

export type BrainRunEvent = BrainRunEventBody & BrainRunEventBase;

/** A compaction the runtime reported, as the turn's event carries it. */
export function turnCompactionOf(
  compaction: RuntimeCompaction & { compacted: true },
): TurnCompaction {
  return {
    source: compaction.source,
    dropped: compaction.dropped,
    ...(compaction.summary !== undefined ? { summary: compaction.summary } : undefined),
  };
}

/** JSON the runtime serialized, read back as data; text that is not JSON is kept as the text it is. */
function parsedJson(json: string): UnparsedWireValue {
  try {
    // SAFETY: JSON.parse answers a wire value; the callers keep it as data and read nothing off it but a reason.
    return JSON.parse(json) as UnparsedWireValue;
  } catch {
    return json;
  }
}

/** A call's arguments as the tool part keeps them: parsed when they parse, the raw text otherwise. */
export function toolCallInput(argumentsJson: string): UnparsedWireValue {
  return parsedJson(argumentsJson);
}

/** How a tool's result reads as a tool part's settlement: an answer, or a refusal carrying the output's own reason. */
export function toolCallSettlementOf(
  outputJson: string,
  status: string | undefined,
): ToolCallSettlement {
  const output = parsedJson(outputJson);
  if (status === undefined || !isToolRefusalStatus(status)) {
    return {
      state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
      output,
      ...(status !== undefined ? { status } : undefined),
    };
  }
  const reason = isRecord(output) && isWireString(output.reason) ? output.reason : outputJson;
  return { state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR, output, errorText: reason, status };
}

/** Which slow step a tool call the policy offers begins, or nothing for a call that is neither slow nor offered. */
export function slowStepOf(policy: EffectiveToolPolicy, name: string): SlowStepKind | undefined {
  const tool = policy.allowed.find((candidate) => candidate.schema.name === name);
  if (!tool) return undefined;
  if (
    tool.execution === TOOL_EXECUTION.PERFORMER ||
    (tool.execution === TOOL_EXECUTION.MEMORY && tool.effect === TOOL_EFFECT.WRITE)
  ) {
    return SLOW_STEP_KIND.PROVIDER_WRITE;
  }
  if (name === BRAIN_TOOL.READ_TRANSCRIPT) return SLOW_STEP_KIND.TRANSCRIPT_READ;
  return undefined;
}

const SENTENCE_BOUNDARY = /(?<=[.!?…]["'”’)\]]*)\s+|\n+/;

/** A reply as the sentences it is spoken in: split at sentence ends and line breaks, each trimmed, none empty. */
export function replySentences(text: string): readonly string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
