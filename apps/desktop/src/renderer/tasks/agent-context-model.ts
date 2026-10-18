import {
  CODING_AGENT_BRIEF,
  type CodingAgentBrief,
  type CodingAgentContext,
} from "@luke/features/coding-agent-wire";
import { agoText } from "@luke/panel/tasks/task-time";
import { compactCount } from "./coding-agent-model";

/**
 * agent-context-model.ts -- what the agent box's context ring and its popover say of the agent's model's context.
 *
 * The service tells what the agent's newest step read, as its provider
 * counted it, against the window of the model the agent runs on now and
 * the count past which eve compacts the conversation
 * (`codingAgentContextSchema`). The ring fills with the share of the
 * window that step read, turns amber within a tenth of the window of the
 * compaction, and red at or past it, since the next step compacts. The
 * popover divides the read into the parts the service could name: the
 * instructions, the tool definitions, and the plan or task while eve has
 * never compacted, each an estimate, and the conversation as what is left,
 * which leans on the estimates and so is one too; estimates that outrun the
 * count are scaled down to it, so the parts never add up to more. A "~" marks every count
 * that is an estimate, and the total, which was counted at the last step
 * and has grown by that step's answer since.
 */

/** How the ring reads: room to spare, near eve's compaction, or at or past it. */
const CONTEXT_LEVEL = {
  ROOM: "room",
  NEAR: "near",
  OVER: "over",
} as const;

export type ContextLevel = (typeof CONTEXT_LEVEL)[keyof typeof CONTEXT_LEVEL];

/** The parts the popover divides the context into, in the bar's order. */
const CONTEXT_PART = {
  SYSTEM_PROMPT: "system-prompt",
  TOOL_DEFINITIONS: "tool-definitions",
  BRIEF: "brief",
  CONVERSATION: "conversation",
} as const;

type ContextPart = (typeof CONTEXT_PART)[keyof typeof CONTEXT_PART];

/** How far short of the compaction, as a share of the window, the ring turns amber. */
const NEAR_SHARE = 0.1;

/** The mark an estimated count wears. */
const ESTIMATE_MARK = "~";

/** What the brief's row is called, by what the agent was handed. */
const BRIEF_LABEL = {
  [CODING_AGENT_BRIEF.PLAN]: "Plan",
  [CODING_AGENT_BRIEF.PROMPT]: "Prompt",
} as const satisfies Record<CodingAgentBrief, string>;

/** One part of the context as the popover's bar and legend draw it. */
export interface ContextRow {
  readonly part: ContextPart;
  readonly label: string;
  readonly tokens: number;
  /** Whether the count is an estimate, which its legend row marks. */
  readonly estimated: boolean;
}

/** One line of what the popover says under the legend: a name and its value. */
export interface ContextStat {
  readonly label: string;
  readonly value: string;
}

/** A count rounded where it is whole, as a window reads: 200k, 1M, 1.5M. */
function roundCount(count: number): string {
  return compactCount(count).replace(/\.0(?=[kM]$)/u, "");
}

/** The share of the window the last step read, past one where it read more than the window holds. */
export function contextShare(context: CodingAgentContext): number {
  return context.inputTokens / context.windowTokens;
}

/** The share as a whole percentage: 62. */
function contextPercent(context: CodingAgentContext): number {
  return Math.round(contextShare(context) * 100);
}

/** How the ring reads: at or past eve's threshold, within a tenth of the window of it, or short of that. */
export function contextLevel(context: CodingAgentContext): ContextLevel {
  const { inputTokens, compactionThresholdTokens, windowTokens } = context;
  if (inputTokens >= compactionThresholdTokens) return CONTEXT_LEVEL.OVER;
  if (inputTokens >= compactionThresholdTokens - NEAR_SHARE * windowTokens) {
    return CONTEXT_LEVEL.NEAR;
  }
  return CONTEXT_LEVEL.ROOM;
}

/** The ring's hover: "62% of context used". */
export function contextHint(context: CodingAgentContext): string {
  return `${contextPercent(context)}% of context used`;
}

/** The popover's headline: "62% full". */
export function contextFullLine(context: CodingAgentContext): string {
  return `${contextPercent(context)}% full`;
}

/** The popover's total: "~620.0k / 1M tokens". */
export function contextTotalLine(context: CodingAgentContext): string {
  return `${ESTIMATE_MARK}${compactCount(context.inputTokens)} / ${roundCount(context.windowTokens)} tokens`;
}

/**
 * The parts of what the last step read, in the bar's order: the three the
 * service estimated, the brief only while it stands apart, and the
 * conversation as what the estimates leave of the provider's count.
 */
export function contextRows(
  context: CodingAgentContext,
  brief: CodingAgentBrief | undefined,
): ContextRow[] {
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
      label: BRIEF_LABEL[brief ?? CODING_AGENT_BRIEF.PLAN],
      tokens: briefTokens,
      estimated: true,
    });
  }
  const named = rows.reduce((sum, row) => sum + row.tokens, 0);
  // Note that estimates that outrun the provider's count are scaled down to it, because the
  // count is the one measured figure and the parts must not add up to more than it.
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

/** A legend row's count: "~1.2k" for an estimate, "1.2k" for a count. */
export function rowCount(row: ContextRow): string {
  return row.estimated ? `${ESTIMATE_MARK}${compactCount(row.tokens)}` : compactCount(row.tokens);
}

/** How wide a part's stretch of the bar is, as a percentage of the bar: of the window, or of the read where it overran the window. */
export function rowWidth(row: ContextRow, context: CodingAgentContext): number {
  return (row.tokens / Math.max(context.windowTokens, context.inputTokens)) * 100;
}

/** What the popover says under the legend, at the time given: the cache, the step's answer, where eve compacts, and when it last did. */
export function contextStats(context: CodingAgentContext, now: number): ContextStat[] {
  const stats: ContextStat[] = [];
  if (context.cachedInputTokens !== undefined) {
    stats.push({ label: "Read from cache", value: compactCount(context.cachedInputTokens) });
  }
  if (context.cacheWriteTokens !== undefined && context.cacheWriteTokens > 0) {
    stats.push({ label: "Written to cache", value: compactCount(context.cacheWriteTokens) });
  }
  stats.push({ label: "Last step's output", value: compactCount(context.outputTokens) });
  const thresholdPercent = Math.round(
    (context.compactionThresholdTokens / context.windowTokens) * 100,
  );
  stats.push({
    label: "Compacts at",
    value: `${roundCount(context.compactionThresholdTokens)} (${thresholdPercent}%)`,
  });
  if (context.compactedAt !== undefined) {
    stats.push({ label: "Last compacted", value: agoText(context.compactedAt, now) });
  }
  return stats;
}
