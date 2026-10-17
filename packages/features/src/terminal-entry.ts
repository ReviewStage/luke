/**
 * terminal-entry.ts -- which coding agent a terminal command is for: the rules every way of opening a terminal follows.
 *
 * A terminal belongs to one coding agent's sandbox, never to the task, so
 * every way in first decides which agent. Show terminal (⌘J) goes to an
 * existing Terminal tab; New terminal (⌘K, the panel's "+") adds a shell.
 * From an agent's own tab, its Changes tab, or its Terminal tab, both mean
 * that agent; from anywhere else on a task with one agent, that agent. With
 * several agents, ⌘J goes to the one whose terminal was used last and New
 * terminal asks, that one chosen to begin with; with none used yet both
 * ask; with no agent at all, the picker offers to start one. An archived
 * agent is offered nowhere (`docs/proposals/terminal-tab.md`, "New terminal:
 * the rules").
 */

/** What was asked for: an existing terminal, or a new shell. */
export const TERMINAL_ASK = {
  SHOW: "show",
  NEW: "new",
} as const;

export type TerminalAsk = (typeof TERMINAL_ASK)[keyof typeof TERMINAL_ASK];

/** Where a terminal command lands: one agent, the picker, or the picker's offer to start an agent. */
export const TERMINAL_TARGET = {
  AGENT: "agent",
  PICK: "pick",
  NO_AGENT: "no-agent",
} as const;

export type TerminalTarget =
  | { readonly kind: typeof TERMINAL_TARGET.AGENT; readonly agentId: string }
  | { readonly kind: typeof TERMINAL_TARGET.PICK; readonly chosen: string | undefined }
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
export function terminalTarget(ask: TerminalAsk, context: TerminalContext): TerminalTarget {
  const { here, agents } = context;
  if (here !== undefined && agents.includes(here))
    return { kind: TERMINAL_TARGET.AGENT, agentId: here };
  const [only] = agents;
  if (only === undefined) return { kind: TERMINAL_TARGET.NO_AGENT };
  if (agents.length === 1) return { kind: TERMINAL_TARGET.AGENT, agentId: only };
  const lastUsed =
    context.lastUsed !== undefined && agents.includes(context.lastUsed)
      ? context.lastUsed
      : undefined;
  if (ask === TERMINAL_ASK.SHOW && lastUsed !== undefined) {
    return { kind: TERMINAL_TARGET.AGENT, agentId: lastUsed };
  }
  return { kind: TERMINAL_TARGET.PICK, chosen: lastUsed };
}
