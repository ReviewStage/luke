import { PROVIDER_KEY_STATUS } from "@repo/features/provider-key-wire";
import type { RunUsage, ToolCallSettlement } from "@repo/features/turn-run";
import type { UnparsedWireValue, WireValue } from "@repo/wire";

export const NATIVE_MOMENT = {
  LINE_ACCEPTED: "line_accepted",
  SESSION: "session",
  ACTIVE: "active",
  STEP: "step",
  STEP_CLOSED: "step_closed",
  TEXT_DELTA: "text_delta",
  TEXT: "text",
  REASONING: "reasoning",
  TOOL_STARTED: "tool_started",
  TOOL_SETTLED: "tool_settled",
  SUBAGENT_RUNNING: "subagent_running",
  SUBAGENT_ENDED: "subagent_ended",
  USAGE: "usage",
  CONTEXT: "context",
  USAGE_TOTAL: "usage_total",
  RESULT: "result",
  COMPACTED: "compacted",
  RATE_LIMIT: "rate_limit",
  PLAN: "plan",
  WAITING: "waiting",
  ENDED: "ended",
} as const;

export const NATIVE_ENDING = {
  DONE: "done",
  STOPPED: "stopped",
  FAILED: "failed",
} as const;
type NativeEnding = (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING];

export const PLAN_STATUS = {
  VERIFIED: PROVIDER_KEY_STATUS.VERIFIED,
  INVALID: PROVIDER_KEY_STATUS.INVALID,
  LIMIT_REACHED: PROVIDER_KEY_STATUS.LIMIT_REACHED,
  INELIGIBLE: PROVIDER_KEY_STATUS.INELIGIBLE,
} as const;
export type PlanStatus = (typeof PLAN_STATUS)[keyof typeof PLAN_STATUS];

export type NativeMoment =
  | { readonly kind: typeof NATIVE_MOMENT.LINE_ACCEPTED; readonly clientId: string }
  | { readonly kind: typeof NATIVE_MOMENT.SESSION; readonly sessionId: string }
  | { readonly kind: typeof NATIVE_MOMENT.ACTIVE }
  | { readonly kind: typeof NATIVE_MOMENT.STEP; readonly key?: string }
  | { readonly kind: typeof NATIVE_MOMENT.STEP_CLOSED }
  | { readonly kind: typeof NATIVE_MOMENT.TEXT_DELTA; readonly text: string }
  | { readonly kind: typeof NATIVE_MOMENT.TEXT; readonly text: string }
  | { readonly kind: typeof NATIVE_MOMENT.REASONING; readonly text: string }
  | {
      readonly kind: typeof NATIVE_MOMENT.TOOL_STARTED;
      readonly callId: string;
      readonly name: string;
      readonly input: UnparsedWireValue;
    }
  | {
      readonly kind: typeof NATIVE_MOMENT.TOOL_SETTLED;
      readonly callId: string;
      readonly settlement: ToolCallSettlement;
      readonly input?: UnparsedWireValue;
    }
  | {
      readonly kind: typeof NATIVE_MOMENT.SUBAGENT_RUNNING;
      readonly callId: string;
      readonly key: string;
      readonly input?: WireValue;
    }
  | {
      readonly kind: typeof NATIVE_MOMENT.SUBAGENT_ENDED;
      readonly key: string;
      readonly settlement: ToolCallSettlement;
    }
  | { readonly kind: typeof NATIVE_MOMENT.USAGE; readonly usage: RunUsage }
  | { readonly kind: typeof NATIVE_MOMENT.CONTEXT; readonly usage: NativeContextUsage }
  | { readonly kind: typeof NATIVE_MOMENT.USAGE_TOTAL; readonly total: RunUsage }
  | { readonly kind: typeof NATIVE_MOMENT.RESULT; readonly failure?: string }
  | { readonly kind: typeof NATIVE_MOMENT.COMPACTED }
  | {
      readonly kind: typeof NATIVE_MOMENT.RATE_LIMIT;
      readonly refused: boolean;
      readonly detail: string;
      readonly resetsAt?: number;
    }
  | { readonly kind: typeof NATIVE_MOMENT.PLAN; readonly status: PlanStatus }
  | { readonly kind: typeof NATIVE_MOMENT.WAITING }
  | {
      readonly kind: typeof NATIVE_MOMENT.ENDED;
      readonly ending: NativeEnding;
      readonly detail?: string;
      readonly warm?: boolean;
      readonly launchFailed?: boolean;
      readonly wakeups?: readonly NativeWakeup[];
    };

export interface NativeContextUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
}

export interface NativeWakeup {
  readonly at: number;
  readonly prompt: string;
}

export interface NativeHeld {
  readonly callName: (callId: string) => string | undefined;
  readonly session: string | undefined;
  readonly sequence: number;
}
