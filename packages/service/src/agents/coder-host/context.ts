import type { AgentContextRow } from "@repo/database/models/agent-store";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";
import { type AgentContext, CONTEXT_WINDOW, type ContextWindow } from "@repo/features/agent-wire";
import type { OfferedModel } from "../../providers/model-catalog.js";
import { CODER } from "./bounds.js";

export function contextWindowOf(
  offered: readonly OfferedModel[],
  modelId: string,
  chosen: ContextWindow,
): number {
  const model = offered.find((each) => each.id === modelId);
  const windows = model?.contextWindows;
  if (windows !== undefined) {
    return chosen === CONTEXT_WINDOW.LONG ? windows.longTokens : windows.standardTokens;
  }
  return model?.contextWindow ?? CODER.FALLBACK_CONTEXT_WINDOW_TOKENS;
}

function compactionThresholdOf(windowTokens: number, runtime: ConversationRuntime): number {
  const threshold =
    runtime === CONVERSATION_RUNTIME.CLAUDE_CODE
      ? windowTokens - CODER.CLAUDE_CODE_COMPACTION_RESERVE_TOKENS
      : Math.floor(windowTokens * CODER.COMPACTION_THRESHOLD_SHARE);
  return Math.max(1, threshold);
}

export function agentContextOf(
  row: AgentContextRow,
  windowTokens: number,
  runtime: ConversationRuntime,
): AgentContext | undefined {
  const step = row.lastStep;
  if (step === null) return undefined;
  const compacted = row.compactedAt !== null;
  return {
    windowTokens,
    compactionThresholdTokens: compactionThresholdOf(windowTokens, runtime),
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    ...(step.cachedInputTokens === undefined
      ? undefined
      : { cachedInputTokens: step.cachedInputTokens }),
    ...(step.cacheWriteTokens === undefined
      ? undefined
      : { cacheWriteTokens: step.cacheWriteTokens }),
    estimated: {
      systemPromptTokens: step.systemPromptTokens,
      toolDefinitionTokens: step.toolDefinitionTokens,
      ...(compacted ? undefined : { briefTokens: step.briefTokens }),
    },
    measuredAt: step.at,
    ...(row.compactedAt === null ? undefined : { compactedAt: row.compactedAt.getTime() }),
  };
}
