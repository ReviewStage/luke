import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "../act.js";
import { useReadMarks } from "../tasks/use-task-looks.js";

/**
 * agent-read-marks.ts -- Mark as unread and Mark as read for an agent with no task, through the marks a task's menus write.
 *
 * An agent's mark is the task's: kept by its id, a look at its row's
 * `activityAt`. Marking it read also clears main's unseen dot for it, which
 * the host clears itself only as the agent's page is shown.
 */

/** Whether an agent is marked unread by hand, and the mark a menu sets either way. */
export interface AgentReadMarks {
  /** Whether the agent is marked unread by hand: its unseen dot is main's, apart from this. */
  readonly markedUnread: (agentId: string) => boolean;
  /** Marks the agent unread until its page next opens, or read, which takes its unseen dot with the hand mark. */
  readonly mark: (agent: Pick<TasklessAgent, "id" | "activityAt">, unread: boolean) => void;
}

/** The marks by hand on agents, which every menu offering them Mark as unread or Mark as read writes through. */
export function useAgentReadMarks(): AgentReadMarks {
  const reads = useReadMarks();
  const { tell } = useAct();
  return {
    markedUnread: reads.markedUnread,
    mark: (agent, unread) => {
      reads.mark({ id: agent.id, updatedAt: agent.activityAt }, unread);
      if (!unread) tell(ACT_KIND.CODING_AGENTS_SEEN, { agentId: agent.id });
    },
  };
}
