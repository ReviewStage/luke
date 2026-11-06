import type { SessionKey } from "@repo/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireRecord,
} from "@repo/wire";
import type { UIMessage } from "ai";
import type { RunModelUsage, RunStatus, RunUsage, TurnFailure } from "./requests.js";
import { spokenProse } from "./spoken-prose.js";
import type { TurnTrigger } from "./turn.js";

export const RUN_EVENT = {
  SLOW_STEP: "slow_step",
  QUESTION_QUEUED: "question_queued",
  QUESTION_WITHDRAWN: "question_withdrawn",
  CALL_ENDING: "call_ending",
  ACTIONS_SETTLED: "actions_settled",
  REPLY_SENTENCE: "reply_sentence",
  ENDED: "ended",
  TURN_STARTED: "turn_started",
  STEP_STARTED: "step_started",
  TOOL_CALL_STARTED: "tool_call_started",
  TOOL_CALL_SETTLED: "tool_call_settled",
  REASONING_COMPLETED: "reasoning_completed",
  MESSAGE_COMPLETED: "message_completed",
  TEXT_DRAFTED: "text_drafted",
  TURN_ENDED: "turn_ended",
} as const;

export const SLOW_STEP_KIND = {
  TRANSCRIPT_READ: "transcript_read",
  PROVIDER_WRITE: "provider_write",
  REPOSITORY_READ: "repository_read",
} as const;

type SlowStepKind = (typeof SLOW_STEP_KIND)[keyof typeof SLOW_STEP_KIND];

export const RUN_TURN_ORIGIN = {
  TYPED: "typed",
  SPOKEN: "spoken",
  CHILD: "child",
} as const;

export type RunTurnOrigin = (typeof RUN_TURN_ORIGIN)[keyof typeof RUN_TURN_ORIGIN];

export const TOOL_CALL_SETTLEMENT = {
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

const TOOL_REFUSAL_STATUS = {
  REJECTED: ACTION_RESULT_STATUS.REJECTED,
  UNSUPPORTED: ACTION_RESULT_STATUS.UNSUPPORTED,
  REFUSED: "refused",
} as const;

type ToolRefusalStatus = (typeof TOOL_REFUSAL_STATUS)[keyof typeof TOOL_REFUSAL_STATUS];

const TOOL_REFUSAL_STATUS_LIST: readonly string[] = Object.values(TOOL_REFUSAL_STATUS);

function isToolRefusalStatus(status: string): status is ToolRefusalStatus {
  return TOOL_REFUSAL_STATUS_LIST.includes(status);
}

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

interface RunEventBase {
  readonly conversationId: SessionKey;
  readonly turnId: string;
  readonly sequence: number;
}

export type RunEventBody =
  | {
      readonly kind: typeof RUN_EVENT.SLOW_STEP;
      readonly runId: string;
      readonly step: SlowStepKind;
    }
  | {
      readonly kind: typeof RUN_EVENT.QUESTION_QUEUED;
      readonly runId: string;
      readonly question: string;
      readonly recommendation: string;
    }
  | {
      readonly kind: typeof RUN_EVENT.QUESTION_WITHDRAWN;
      readonly runId: string;
      readonly question: string;
    }
  | { readonly kind: typeof RUN_EVENT.CALL_ENDING; readonly runId: string }
  | { readonly kind: typeof RUN_EVENT.ACTIONS_SETTLED; readonly runId: string }
  | {
      readonly kind: typeof RUN_EVENT.REPLY_SENTENCE;
      readonly runId: string;
      readonly sentence: string;
    }
  | {
      readonly kind: typeof RUN_EVENT.ENDED;
      readonly runId: string;
      readonly status: RunStatus;
      readonly text?: string;
      readonly failure?: TurnFailure;
      readonly usage?: RunUsage;
      readonly responseIds?: readonly string[];
    }
  | {
      readonly kind: typeof RUN_EVENT.TURN_STARTED;
      readonly origin: RunTurnOrigin;
      readonly trigger: TurnTrigger;
      readonly at: number;
    }
  | {
      readonly kind: typeof RUN_EVENT.STEP_STARTED;
      readonly step: number;
    }
  | {
      readonly kind: typeof RUN_EVENT.TOOL_CALL_STARTED;
      readonly callId: string;
      readonly name: string;
      readonly input: UnparsedWireValue;
    }
  | {
      readonly kind: typeof RUN_EVENT.TOOL_CALL_SETTLED;
      readonly callId: string;
      readonly name: string;
      readonly settlement: ToolCallSettlement;
      readonly input?: UnparsedWireValue;
    }
  | {
      readonly kind: typeof RUN_EVENT.REASONING_COMPLETED;
      readonly summary: string;
      readonly item: WireRecord;
    }
  | { readonly kind: typeof RUN_EVENT.MESSAGE_COMPLETED; readonly message: UIMessage }
  | {
      readonly kind: typeof RUN_EVENT.TEXT_DRAFTED;
      readonly step: number;
      readonly text: string;
    }
  | {
      readonly kind: typeof RUN_EVENT.TURN_ENDED;
      readonly status: RunStatus;
      readonly failure?: TurnFailure;
      readonly failureDetail?: string;
      readonly usage?: RunUsage;
      readonly usageByModel?: readonly RunModelUsage[];
      readonly responseIds: readonly string[];
      readonly at: number;
    };

export type RunEvent = RunEventBody & RunEventBase;

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

const OPEN_SPAN = /\*+(?=[^\s*])|(?<![\w_])_+(?=[^\s_])|~~(?=\S)|`|\[/u;

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

export function replySentences(text: string): readonly string[] {
  return spokenProse(text)
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
