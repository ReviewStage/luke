/**
 * terminal-entry.ts -- which coding agent a terminal command is for: the rules every way of opening a terminal follows.
 *
 * A terminal belongs to one coding agent's mirror, never to the task, so
 * every way in first decides which agent, and never asks. Show terminal
 * (⌘J) goes to an existing Terminal tab; New terminal (⌘K, the panel's "+")
 * adds a shell. From an agent's own tab, its Changes tab, or its Terminal
 * tab, both mean that agent; from anywhere else, the agent whose terminal
 * was used last on the task, else its first agent; with no agent at all,
 * both offer to start one. An archived agent is offered nowhere.
 */

/** What was asked for: an existing terminal, or a new shell. */
export const TERMINAL_ASK = {
  SHOW: "show",
  NEW: "new",
} as const;

export type TerminalAsk = (typeof TERMINAL_ASK)[keyof typeof TERMINAL_ASK];

/** Where a terminal command lands: one agent, or the offer to start one. */
export const TERMINAL_TARGET = {
  AGENT: "agent",
  NO_AGENT: "no-agent",
} as const;

export type TerminalTarget =
  | { readonly kind: typeof TERMINAL_TARGET.AGENT; readonly agentId: string }
  | { readonly kind: typeof TERMINAL_TARGET.NO_AGENT };

/** Where the developer is, as the rules read it. */
export interface TerminalContext {
  /** The agent whose own tab, Changes tab, or Terminal tab is where the developer is, if any. */
  readonly here: string | undefined;
  /** The task's agents not archived, in the task's order. */
  readonly agents: readonly string[];
  /** The agent whose Terminal tab was shown last on the task, if any. */
  readonly lastUsed: string | undefined;
}

/** Which agent a terminal command is for. */
export function terminalTarget(context: TerminalContext): TerminalTarget {
  const { here, agents, lastUsed } = context;
  if (here !== undefined && agents.includes(here))
    return { kind: TERMINAL_TARGET.AGENT, agentId: here };
  if (lastUsed !== undefined && agents.includes(lastUsed))
    return { kind: TERMINAL_TARGET.AGENT, agentId: lastUsed };
  const [first] = agents;
  if (first === undefined) return { kind: TERMINAL_TARGET.NO_AGENT };
  return { kind: TERMINAL_TARGET.AGENT, agentId: first };
}
