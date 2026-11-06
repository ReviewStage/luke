import type { TasklessAgent } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation } from "@tanstack/react-query";
import { actMutation } from "../act-mutations.js";
import { useMarkAgent, useReadMarks } from "../tasks/use-task-looks.js";

export interface AgentReadMarks {
  readonly markedUnread: (agentId: string) => boolean;
  readonly mark: (agent: Pick<TasklessAgent, "id">, unread: boolean) => void;
}

export function useAgentReadMarks(): AgentReadMarks {
  const reads = useReadMarks();
  const markAgent = useMarkAgent();
  const { mutate: markSeen } = useMutation(actMutation(ACT_KIND.AGENTS_SEEN));
  return {
    markedUnread: reads.markedUnread,
    mark: (agent, unread) => {
      markAgent(agent.id, unread);
      if (!unread) markSeen({ agentId: agent.id });
    },
  };
}
