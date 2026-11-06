import { useCallback, useState } from "react";

export interface InboxTaskAgents {
  readonly agentIds: readonly string[] | undefined;
  readonly heldIds: readonly string[] | undefined;
  readonly onRead: (
    taskId: string,
    agentIds: readonly string[],
    heldIds?: readonly string[] | undefined,
  ) => void;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at]);
}

export function useInboxTaskAgents(taskId: string | undefined): InboxTaskAgents {
  const [read, setRead] = useState<
    { taskId: string; agentIds: readonly string[]; heldIds: readonly string[] } | undefined
  >(undefined);
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
