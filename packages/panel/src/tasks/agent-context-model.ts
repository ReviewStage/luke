import { AGENT_BRIEF, type AgentBrief, type AgentContext } from "@repo/features/agent-wire";
import { formatCompact } from "@repo/features/number-format";
import { agoText } from "@repo/features/time-format";

export const CONTEXT_LEVEL = {
  ROOM: "room",
  NEAR: "near",
  OVER: "over",
} as const;

export type ContextLevel = (typeof CONTEXT_LEVEL)[keyof typeof CONTEXT_LEVEL];

export const CONTEXT_PART = {
  SYSTEM_PROMPT: "system-prompt",
  TOOL_DEFINITIONS: "tool-definitions",
  BRIEF: "brief",
  CONVERSATION: "conversation",
} as const;

export type ContextPart = (typeof CONTEXT_PART)[keyof typeof CONTEXT_PART];

const NEAR_SHARE = 0.1;

const ESTIMATE_MARK = "~";

const BRIEF_LABEL = {
  [AGENT_BRIEF.DESCRIPTION]: "Description",
  [AGENT_BRIEF.PROMPT]: "Prompt",
  [AGENT_BRIEF.BLANK]: "First message",
} as const satisfies Record<AgentBrief, string>;

export interface ContextRow {
  readonly part: ContextPart;
  readonly label: string;
  readonly tokens: number;
  readonly estimated: boolean;
}

export interface ContextStat {
  readonly label: string;
  readonly value: string;
}

export function contextShare(context: AgentContext): number {
  return context.inputTokens / context.windowTokens;
}

function contextPercent(context: AgentContext): number {
  return Math.round(contextShare(context) * 100);
}

export function contextLevel(context: AgentContext): ContextLevel {
  const { inputTokens, compactionThresholdTokens, windowTokens } = context;
  if (inputTokens >= compactionThresholdTokens) return CONTEXT_LEVEL.OVER;
  if (inputTokens >= compactionThresholdTokens - NEAR_SHARE * windowTokens) {
    return CONTEXT_LEVEL.NEAR;
  }
  return CONTEXT_LEVEL.ROOM;
}

export function contextHint(context: AgentContext): string {
  const used = `${contextPercent(context)}% of context used`;
  return contextLevel(context) === CONTEXT_LEVEL.ROOM ? used : `${used}, near the limit`;
}

export function contextFullLine(context: AgentContext): string {
  return `${contextPercent(context)}% full`;
}

export function contextTotalLine(context: AgentContext): string {
  return `${ESTIMATE_MARK}${formatCompact(context.inputTokens)} / ${formatCompact(context.windowTokens)} tokens`;
}

export function contextRows(context: AgentContext, brief: AgentBrief | undefined): ContextRow[] {
  const { systemPromptTokens, toolDefinitionTokens, briefTokens } = context.estimated;
  const rows: ContextRow[] = [
    {
      part: CONTEXT_PART.SYSTEM_PROMPT,
      label: "System prompt",
      tokens: systemPromptTokens,
      estimated: true,
    },
    {
      part: CONTEXT_PART.TOOL_DEFINITIONS,
      label: "Tool definitions",
      tokens: toolDefinitionTokens,
      estimated: true,
    },
  ];
  if (briefTokens !== undefined) {
    rows.push({
      part: CONTEXT_PART.BRIEF,
      label: BRIEF_LABEL[brief ?? AGENT_BRIEF.DESCRIPTION],
      tokens: briefTokens,
      estimated: true,
    });
  }
  const named = rows.reduce((sum, row) => sum + row.tokens, 0);
  const scale = named > context.inputTokens ? context.inputTokens / named : 1;
  const fitted = rows.map((row) => ({ ...row, tokens: Math.round(row.tokens * scale) }));
  const left = context.inputTokens - fitted.reduce((sum, row) => sum + row.tokens, 0);
  fitted.push({
    part: CONTEXT_PART.CONVERSATION,
    label: "Conversation",
    tokens: Math.max(0, left),
    estimated: true,
  });
  return fitted;
}

export function rowCount(row: ContextRow): string {
  return row.estimated ? `${ESTIMATE_MARK}${formatCompact(row.tokens)}` : formatCompact(row.tokens);
}

export function rowWidth(row: ContextRow, context: AgentContext): number {
  return (row.tokens / Math.max(context.windowTokens, context.inputTokens)) * 100;
}

export function contextStats(context: AgentContext, now: number): ContextStat[] {
  const stats: ContextStat[] = [];
  if (context.cachedInputTokens !== undefined) {
    stats.push({ label: "Read from cache", value: formatCompact(context.cachedInputTokens) });
  }
  if (context.cacheWriteTokens !== undefined && context.cacheWriteTokens > 0) {
    stats.push({ label: "Written to cache", value: formatCompact(context.cacheWriteTokens) });
  }
  stats.push({ label: "Last step's output", value: formatCompact(context.outputTokens) });
  const thresholdPercent = Math.round(
    (context.compactionThresholdTokens / context.windowTokens) * 100,
  );
  stats.push({
    label: "Compacts at",
    value: `${formatCompact(context.compactionThresholdTokens)} (${thresholdPercent}%)`,
  });
  if (context.compactedAt !== undefined) {
    stats.push({ label: "Last compacted", value: agoText(context.compactedAt, now) });
  }
  return stats;
}
