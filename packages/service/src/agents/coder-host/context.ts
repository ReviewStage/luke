import type { AgentContextRow } from "@repo/database/models/agent-store";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";
import { type AgentContext, CONTEXT_WINDOW, type ContextWindow } from "@repo/features/agent-wire";
import type { OfferedModel } from "../../providers/model-catalog.js";
import { CODER } from "./bounds.js";

/**
 * context.ts -- what a coding agent's model's context holds, as its tab's context ring reads it.
 *
 * The newest step the coder host recorded on the agent's row is told
 * against the window of the model the agent runs on now, since that is what
 * the next step reads against and what its harness compacts it against: the window
 * the catalog lists for the model, or the fallback a step is told where it
 * lists none, and the count past which its harness compacts: Claude Code's
 * window less what it holds back, or for Codex and the retired runtime the share
 * the retired runtime compacted at (`bounds.ts`). The brief's estimate is told only while the harness
 * has never compacted the conversation, because a compaction's summary may
 * have folded the description or task in with the rest. Nothing here reaches a harness,
 * since the routes read it.
 */

/** The window a step on the model is told: the one chosen where the model offers two, else the catalog's one for it, or the fallback where it lists none. */
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

/** The count past which the runtime compacts a conversation on the window given, rounded as it rounds it, and never under one token. */
function compactionThresholdOf(windowTokens: number, runtime: ConversationRuntime): number {
  const threshold =
    runtime === CONVERSATION_RUNTIME.CLAUDE_CODE
      ? windowTokens - CODER.CLAUDE_CODE_COMPACTION_RESERVE_TOKENS
      : Math.floor(windowTokens * CODER.COMPACTION_THRESHOLD_SHARE);
  return Math.max(1, threshold);
}

/** The agent's context as the wire carries it, against the window given and the runtime it runs on; nothing before its first step. */
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
