import type { AgentSummary } from "@repo/features/agent-wire";
import { useRef } from "react";
import type { AgentActAnswer } from "../act.js";
import type { AgentServersControl } from "./agent-servers.js";

export type ServersWriter = (
  agentId: string,
  disabledServers: readonly string[],
) => Promise<AgentActAnswer>;

const NONE_OFF: readonly string[] = [];

export function useAgentServers(input: {
  agent: Pick<AgentSummary, "id" | "disabledServers" | "startedBy">;
  write: ServersWriter;
  onOpenSettings: () => void;
  me: string | undefined;
}): AgentServersControl {
  const { agent } = input;
  const latest = useRef(input);
  latest.current = input;

  return {
    disabled: agent.disabledServers ?? NONE_OFF,
    onSwitch: (next) => void latest.current.write(agent.id, next),
    onOpenSettings: () => latest.current.onOpenSettings(),
    workspace: {
      agentId: agent.id,
      starterReading: input.me !== undefined && agent.startedBy?.userId === input.me,
    },
  };
}
