import type { AgentSummary } from "@luke/features/agent-wire";
import { useRef } from "react";
import type { AgentActAnswer } from "../act.js";
import type { AgentServersControl } from "./agent-servers.js";

/**
 * use-agent-servers.ts -- the MCP servers popover of a started agent as one control: the switches it shows, and a change sent.
 *
 * A switch is sent to the service, which writes the agent's list for its
 * next turn, and the host draws it on the agent's row the moment it is
 * asked (`@luke/host`'s `task-list-collections.ts`), so the switches read
 * the list off the agent. A change the service refused is taken back by
 * the host, and the list says why in a toast (`use-agents.ts`).
 */

/** How a change is sent: the agent and the whole list of servers off, answered as the view hears it. */
export type ServersWriter = (
  agentId: string,
  disabledServers: readonly string[],
) => Promise<AgentActAnswer>;

/** Nothing switched off, which is what an agent from a service before the switch holds. */
const NONE_OFF: readonly string[] = [];

export function useAgentServers(input: {
  agent: Pick<AgentSummary, "id" | "disabledServers" | "startedBy">;
  write: ServersWriter;
  onOpenSettings: () => void;
  /** The reader's account, which says whether they started the agent and so whether this Mac's setting meets its commands. */
  me: string | undefined;
}): AgentServersControl {
  const { agent } = input;
  // Note that the writer is read through a ref, because the tab hands a new
  // closure on every render.
  const latest = useRef(input);
  latest.current = input;

  return {
    disabled: agent.disabledServers ?? NONE_OFF,
    onSwitch: (next) => void latest.current.write(agent.id, next),
    onOpenSettings: () => latest.current.onOpenSettings(),
    luke: {
      agentId: agent.id,
      starterReading: input.me !== undefined && agent.startedBy?.userId === input.me,
    },
  };
}
