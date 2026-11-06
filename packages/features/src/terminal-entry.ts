export const TERMINAL_ASK = {
  SHOW: "show",
  NEW: "new",
} as const;

export type TerminalAsk = (typeof TERMINAL_ASK)[keyof typeof TERMINAL_ASK];

export const TERMINAL_TARGET = {
  AGENT: "agent",
  NO_AGENT: "no-agent",
} as const;

export type TerminalTarget =
  | { readonly kind: typeof TERMINAL_TARGET.AGENT; readonly agentId: string }
  | { readonly kind: typeof TERMINAL_TARGET.NO_AGENT };

export interface TerminalContext {
  readonly here: string | undefined;
  readonly agents: readonly string[];
  readonly lastUsed: string | undefined;
}

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
