import type { CodingAgentAgentAnswer } from "@luke/features/coding-agent-view";
import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { useRef, useState } from "react";
import type { AgentServersControl } from "./agent-servers";

/**
 * use-agent-servers.ts -- the MCP servers popover of a started agent as one control: the switches it shows, and a change on its way.
 *
 * A switch is drawn the moment it is pressed and sent to the service, which
 * writes the agent's list for its next turn; the agent the service answers
 * is the one the list then holds, so the switches read the list back off
 * the agent. A change the service refused is taken off the switches again,
 * which fall back to what the agent holds, and the list says why in a toast
 * (`use-coding-agents.ts`). An answer a later change overtook is let go.
 * Another agent's tab starts from nothing of this one's.
 */

/** How a change is sent: the agent and the whole list of servers off, answered as the view hears it. */
export type ServersWriter = (
  agentId: string,
  disabledServers: readonly string[],
) => Promise<CodingAgentAgentAnswer>;

/** Nothing switched off, which is what an agent from a service before the switch holds. */
const NONE_OFF: readonly string[] = [];

interface Held {
  agentId: string;
  pending: readonly string[] | undefined;
}

export function useAgentServers(input: {
  agent: Pick<CodingAgentSummary, "id" | "disabledServers">;
  write: ServersWriter;
  onOpenSettings: () => void;
}): AgentServersControl {
  const { agent } = input;
  const [held, setHeld] = useState<Held>(() => ({ agentId: agent.id, pending: undefined }));
  if (held.agentId !== agent.id) setHeld({ agentId: agent.id, pending: undefined });
  // Note that the writer is read through a ref, because the tab hands a new
  // closure on every render and an answer lands on whichever render is current.
  const latest = useRef(input);
  latest.current = input;
  /** How many changes have been sent, so an answer to an earlier one is told apart from the latest. */
  const writes = useRef(0);

  const onSwitch = (next: readonly string[]) => {
    writes.current += 1;
    const write = writes.current;
    setHeld((was) => ({ ...was, pending: next }));
    const settle = () => {
      if (write !== writes.current || latest.current.agent.id !== agent.id) return;
      setHeld((was) => ({ ...was, pending: undefined }));
    };
    latest.current.write(agent.id, next).then(settle, settle);
  };

  return {
    disabled: held.pending ?? agent.disabledServers ?? NONE_OFF,
    onSwitch,
    onOpenSettings: () => latest.current.onOpenSettings(),
  };
}
