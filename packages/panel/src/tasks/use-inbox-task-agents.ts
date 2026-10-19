/**
 * use-inbox-task-agents.ts -- the agents of the task whose item the window's Inbox shows, as the Inbox read them, for the panel beside it.
 *
 * The panel beside the Inbox draws an agent's Pull request tab while the
 * agent is the task's and not archived (`side-panel.tsx`), by the agents the
 * Inbox reads of the chosen task (`desktop-inbox.tsx`), since the window
 * reads the open task's alone. The panel's state is held to the same agents
 * (`use-side-panel.ts`'s `taskAgents`), so closing the last tab drawn shuts
 * the panel, as on a task's page, rather than a tab drawn nowhere, such as
 * an archived agent's kept from the task's page, standing in for the one
 * closed.
 */

import { useCallback, useState } from "react";

/** The chosen task's agents: none until the Inbox read them, and the door it tells them through. */
export interface InboxTaskAgents {
  readonly agentIds: readonly string[] | undefined;
  readonly onRead: (taskId: string, agentIds: readonly string[]) => void;
}

/** Whether two reads name the same agents in the same order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at]);
}

/** The agents the Inbox last read of the task given, none where no task is or none was read of it. */
export function useInboxTaskAgents(taskId: string | undefined): InboxTaskAgents {
  const [read, setRead] = useState<{ taskId: string; agentIds: readonly string[] } | undefined>(
    undefined,
  );
  // Note that a read naming the agents already held keeps the one held, so telling it again draws nothing anew.
  const onRead = useCallback(
    (on: string, agentIds: readonly string[]) =>
      setRead((was) =>
        was?.taskId === on && sameIds(was.agentIds, agentIds) ? was : { taskId: on, agentIds },
      ),
    [],
  );
  return {
    agentIds: read !== undefined && read.taskId === taskId ? read.agentIds : undefined,
    onRead,
  };
}
