import type { ModelUsage } from "@repo/runtime/vocabulary";

export const RUN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "cancelled",
  TIMED_OUT: "timed_out",
  INTERRUPTED: "interrupted",
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export const TURN_FAILURE = {
  MODEL: "model",
  PERSISTENCE: "persistence",
  DEADLINE: "deadline",
  INCOMPLETE: "incomplete",
  COMPACTION: "compaction",
  ABANDONED: "abandoned",
  SESSION_ENDED: "session_ended",
} as const;

export type TurnFailure = (typeof TURN_FAILURE)[keyof typeof TURN_FAILURE];

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  cacheWriteTokens?: number;
}

export interface RunModelUsage extends RunUsage {
  readonly model: string;
}

export function addModelUsage(total: RunUsage | undefined, usage: ModelUsage): RunUsage {
  return {
    inputTokens: (total?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (total?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    cachedInputTokens: (total?.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
    reasoningTokens: (total?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
    ...(total?.cacheWriteTokens === undefined && usage.cacheWriteTokens === undefined
      ? undefined
      : { cacheWriteTokens: (total?.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0) }),
  };
}
