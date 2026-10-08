import type { CompactionSource, SessionKey } from "@sidecar/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireRecord,
} from "@sidecar/wire";
import type { UIMessage } from "ai";
import type { BrainRequestFailure, BrainRequestStatus, BrainRunUsage } from "./requests.js";
import { spokenProse } from "./spoken-prose.js";
import type { BrainTurnTrigger } from "./turn.js";

/**
 * What a turn tells whoever is listening, as it happens. Two audiences hear
 * one stream. A relay into
 * a live conversation reads the recorded run's moments: the one step worth a
 * spoken update, the moment every write it took has its result journaled,
 * the answer a sentence at a time once that moment has passed — the words of
 * a step that only read are the reply forming and are told as they come,
 * since nothing they describe is still uncertain — and the
 * record's end. A writer keeping the conversation reads the turn whole: its
 * start and origin, each step as an inference answers and opens it, each
 * tool call before it runs and its output or error after, each reasoning
 * item's summary beside the provider's opaque item, the
 * messages the turn completed as AI SDK `UIMessage`s, a compaction it folded,
 * and its end with the status, the usage split four ways, and the response
 * ids. Every event carries the conversation's key, the turn's id, and its
 * place in the turn's sequence, numbered from one by the turn's one teller,
 * the hosted brain host's relay, which fires them in order, so a consumer can
 * verify it heard the turn whole. A listener that throws ends no turn.
 */

export const BRAIN_RUN_EVENT = {
  /** The run began a step slow enough to be worth telling the developer about; fired once per run. */
  SLOW_STEP: "slow_step",
  /** A planning run queued one question for the voice to put to the developer when it reaches it; told as the call is journaled, before the run ends. */
  QUESTION_QUEUED: "question_queued",
  /** Every write the run has dispatched by now has its result journaled, so the sentences after it describe nothing still uncertain; a run that has only read tells it at its first words. */
  ACTIONS_SETTLED: "actions_settled",
  /** One sentence of the answer, in order, after every write the run took has settled. */
  REPLY_SENTENCE: "reply_sentence",
  /** The run's record reached a terminal status. */
  ENDED: "ended",
  /** The turn opened past its door and is about to read its opening words. */
  TURN_STARTED: "turn_started",
  /** One inference answered and opened a step: every reasoning item, word, and call it carried is told after this and before the next. */
  STEP_STARTED: "step_started",
  /** The model asked for a tool; nothing of the call has run yet. */
  TOOL_CALL_STARTED: "tool_call_started",
  /** The tool answered, or was refused, and its output is in the context. */
  TOOL_CALL_SETTLED: "tool_call_settled",
  /** One reasoning item of an answer is in the context. */
  REASONING_COMPLETED: "reasoning_completed",
  /** A message of the turn is complete: the words the turn opened with, words steered in, or the model's finished answer. */
  MESSAGE_COMPLETED: "message_completed",
  /** A step's words so far, cut at their last finished sentence, while the turn still runs; the completed answer carries them whole. */
  TEXT_DRAFTED: "text_drafted",
  /** The context was folded, before the turn's first inference or inside the run. */
  COMPACTION_COMPLETED: "compaction_completed",
  /** The turn's execution is over, however it ended. */
  TURN_ENDED: "turn_ended",
} as const;

/** The kinds of step that count as slow: a whole transcript read, a write the provider carries, or a planning call's look into its repository. */
export const SLOW_STEP_KIND = {
  TRANSCRIPT_READ: "transcript_read",
  PROVIDER_WRITE: "provider_write",
  REPOSITORY_READ: "repository_read",
} as const;

type SlowStepKind = (typeof SLOW_STEP_KIND)[keyof typeof SLOW_STEP_KIND];

/** Who or what opened a turn, as the turn's record takes it: attribution, never a permission. */
export const BRAIN_TURN_ORIGIN = {
  /**
   * A developer's ask typed into a composer. No turn of this build opens
   * under it — Luke is voice only — but the stored rows an earlier build
   * wrote carry it, and the hosted store's row shape still spells it.
   */
  TYPED: "typed",
  /** A developer's ask spoken, relayed by the voice service. */
  SPOKEN: "spoken",
  /** A wake for one session, or the roster look on the observation pass. */
  OBSERVATION: "observation",
  /** A child's own delegated task. */
  CHILD: "child",
  /** A requester's turn opened by a child's completion. */
  CHILD_COMPLETION: "child_completion",
} as const;

export type BrainTurnOrigin = (typeof BRAIN_TURN_ORIGIN)[keyof typeof BRAIN_TURN_ORIGIN];

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
const TOOL_REFUSAL_STATUS = {
  REJECTED: ACTION_RESULT_STATUS.REJECTED,
  UNSUPPORTED: ACTION_RESULT_STATUS.UNSUPPORTED,
  /** An action envelope's own refusal word, which folds an adapter's rejected and unsupported into one. */
  REFUSED: "refused",
} as const;

type ToolRefusalStatus = (typeof TOOL_REFUSAL_STATUS)[keyof typeof TOOL_REFUSAL_STATUS];

const TOOL_REFUSAL_STATUS_LIST: readonly string[] = Object.values(TOOL_REFUSAL_STATUS);

function isToolRefusalStatus(status: string): status is ToolRefusalStatus {
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
interface TurnCompaction {
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
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.QUESTION_QUEUED;
      readonly runId: string;
      readonly question: string;
      readonly recommendation: string;
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
      readonly kind: typeof BRAIN_RUN_EVENT.STEP_STARTED;
      /** The step's place in the turn, numbered from one; a step told twice is one step. */
      readonly step: number;
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
      readonly kind: typeof BRAIN_RUN_EVENT.TEXT_DRAFTED;
      /** The step the words belong to, numbered from one as `STEP_STARTED` numbers it. */
      readonly step: number;
      /** Every word the step has formed so far, through its last finished sentence; it only grows. */
      readonly text: string;
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.COMPACTION_COMPLETED;
      readonly compaction: TurnCompaction;
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.TURN_ENDED;
      readonly status: BrainRequestStatus;
      readonly failure?: BrainRequestFailure;
      /** Why the run failed in the runtime's own words, bounded, for the record's diagnosis; never worded to the developer. */
      readonly failureDetail?: string;
      /** What the turn's inferences cost, split four ways, as the run kept them; absent when no inference answered. */
      readonly usage?: BrainRunUsage;
      /** The id of every response the turn was answered with, in order. */
      readonly responseIds: readonly string[];
      readonly at: number;
    };

export type BrainRunEvent = BrainRunEventBody & BrainRunEventBase;

/** How a tool's result reads as a tool part's settlement: an answer, or a refusal carrying the output's own reason. */
export function toolCallSettlementOf(
  outputJson: string,
  status: string | undefined,
): ToolCallSettlement {
  const output = valueFromJsonText(outputJson);
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

const SENTENCE_BOUNDARY = /(?<=[.!?…]["'”’)\]]*)\s+|\n+/;
const SENTENCE_BOUNDARIES = new RegExp(SENTENCE_BOUNDARY.source, "g");

/**
 * A delimiter left on a line once its Markdown is taken out that a later
 * delimiter could still close: a star or underscore run opening on a word, a
 * strikethrough, a tick, or a link's bracket. Note that this errs toward
 * waiting, since a sentence held to its line's end is only later, while one
 * said before its span closed is said with the syntax in it.
 */
const OPEN_SPAN = /\*+(?=[^\s*])|(?<![\w_])_+(?=[^\s_])|~~(?=\S)|`|\[/u;

/**
 * Words still forming, cut where their last finished sentence ends, so the
 * sentences of the cut are the first sentences of every text the words can
 * grow into. A finished line is always finished. Inside the line still
 * forming, a sentence end counts only where the words up to it read aloud
 * as the start of what the line reads now and leave no span open, because a
 * list marker or emphasis closed later changes how the line before it is
 * read. Empty while no sentence has finished.
 */
export function finishedSentencesOf(forming: string): string {
  const lineStart = forming.lastIndexOf("\n") + 1;
  const spoken = spokenProse(forming);
  const ends = [...forming.slice(lineStart).matchAll(SENTENCE_BOUNDARIES)].map(
    (boundary) => lineStart + boundary.index,
  );
  for (const end of ends.reverse()) {
    const said = spokenProse(forming.slice(0, end));
    const line = said.slice(said.lastIndexOf("\n") + 1);
    if (spoken.startsWith(said) && !OPEN_SPAN.test(line)) return forming.slice(0, end);
  }
  return forming.slice(0, Math.max(lineStart - 1, 0));
}

/**
 * A reply as the sentences it is spoken in: its Markdown taken out, split at
 * sentence ends and line breaks, each trimmed, none empty. The syntax goes
 * before the split, so emphasis that spans a sentence end is still read as a
 * pair and a list item is still a line of its own.
 */
export function replySentences(text: string): readonly string[] {
  return spokenProse(text)
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
