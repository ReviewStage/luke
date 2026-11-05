import type { TasklessAgent } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useAct } from "../act.js";
import { markAgent, useReadMarks } from "../tasks/use-task-looks.js";

/**
 * agent-read-marks.ts -- Mark as unread and Mark as read for an agent with no task, kept on the account as a task's marks are.
 *
 * An agent's mark is kept by its id beside a task's (`use-task-looks.ts`).
 * Marking it read also clears main's unseen dot for it, which its tab draws
 * and the host clears itself only as the agent's page is shown.
 */

/** Whether an agent is marked unread by hand, and the mark a menu sets either way. */
export interface AgentReadMarks {
  /** Whether the agent is marked unread by hand. */
  readonly markedUnread: (agentId: string) => boolean;
  /** Marks the agent unread until its page next opens, or read, which takes its unseen dot with the hand mark. */
  readonly mark: (agent: Pick<TasklessAgent, "id">, unread: boolean) => void;
}

/** The marks by hand on agents, which every menu offering them Mark as unread or Mark as read writes through. */
export function useAgentReadMarks(): AgentReadMarks {
  const reads = useReadMarks();
  const { tell } = useAct();
  return {
    markedUnread: reads.markedUnread,
    mark: (agent, unread) => {
      markAgent(agent.id, unread);
      if (!unread) tell(ACT_KIND.AGENTS_SEEN, { agentId: agent.id });
    },
  };
}
