/**
 * use-inbox-task-agents.ts -- the agents of the task whose item the window's Inbox shows, as the Inbox read them, for the panel beside it.
 *
 * The panel beside the Inbox draws an agent's transcript while the agent is
 * the task's and not archived, and its Pull request tab while it is the
 * task's, archived or not (`side-panel.tsx`), by the agents the Inbox reads
 * of the chosen task (`desktop-inbox.tsx`), since the window reads the open
 * task's alone. The panel's state is held to the same agents
 * (`use-side-panel.ts`'s `taskAgents` and `heldAgents`), so closing the last
 * tab drawn shuts the panel, as on a task's page, rather than a tab drawn
 * nowhere standing in for the one closed.
 */

import { useCallback, useState } from "react";

/** The chosen task's agents: none until the Inbox read them, and the door it tells them through. */
export interface InboxTaskAgents {
  /** The task's agents, archived ones left out. */
  readonly agentIds: readonly string[] | undefined;
  /** Every agent of the task, an archived one among them. */
  readonly heldIds: readonly string[] | undefined;
  readonly onRead: (
    taskId: string,
    agentIds: readonly string[],
    heldIds?: readonly string[] | undefined,
  ) => void;
}

/** Whether two reads name the same agents in the same order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at]);
}

/** The agents the Inbox last read of the task given, none where no task is or none was read of it. */
export function useInboxTaskAgents(taskId: string | undefined): InboxTaskAgents {
  const [read, setRead] = useState<
    { taskId: string; agentIds: readonly string[]; heldIds: readonly string[] } | undefined
  >(undefined);
  // Note that a read naming the agents already held keeps the one held, so telling it again draws nothing anew.
  const onRead = useCallback(
    (on: string, agentIds: readonly string[], heldIds: readonly string[] = agentIds) =>
      setRead((was) =>
        was?.taskId === on && sameIds(was.agentIds, agentIds) && sameIds(was.heldIds, heldIds)
          ? was
          : { taskId: on, agentIds, heldIds },
      ),
    [],
  );
  const ours = read !== undefined && read.taskId === taskId ? read : undefined;
  return { agentIds: ours?.agentIds, heldIds: ours?.heldIds, onRead };
}
