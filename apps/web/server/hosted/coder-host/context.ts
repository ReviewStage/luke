import type { CodingAgentContextRow } from "@luke/database/models/coding-agent-store";
import {
  CONTEXT_WINDOW,
  type CodingAgentContext,
  type ContextWindow,
} from "@luke/features/coding-agent-wire";
import { CODER } from "@luke/service/agents/coder-host/bounds";
import type { OfferedModel } from "@luke/service/providers/model-catalog";

/**
 * context.ts -- what a coding agent's model's context holds, as its tab's context ring reads it.
 *
 * The newest step the coder host recorded on the agent's row is told
 * against the window of the model the agent runs on now, since that is what
 * the next step reads against and what eve compacts it against: the window
 * the catalog lists for the model, or the fallback a step is told where it
 * lists none, and the count past which eve compacts, the same share of it
 * eve is told (`bounds.ts`). The brief's estimate is told only while eve
 * has never compacted the conversation, because a compaction's summary may
 * have folded the plan or task in with the rest. Nothing here reaches eve,
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

/** The agent's context as the wire carries it, against the window given; nothing before its first step. */
export function codingAgentContextOf(
  row: CodingAgentContextRow,
  windowTokens: number,
): CodingAgentContext | undefined {
  const step = row.lastStep;
  if (step === null) return undefined;
  const compacted = row.compactedAt !== null;
  return {
    windowTokens,
    // eve's own rounding of the threshold it compacts at, so the two read one count.
    compactionThresholdTokens: Math.max(
      1,
      Math.floor(windowTokens * CODER.COMPACTION_THRESHOLD_SHARE),
    ),
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
