import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { TasklessAgent } from "@repo/features/agent-wire";
import { READ_MARK, type ReadMark, readsUnread } from "@repo/features/read-mark";
import {
  DESCRIPTION_ACTOR,
  type DescriptionSectionEdit,
  type Task,
  type TaskSummary,
} from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actMutation, pressMutation } from "../act-mutations.js";
import { appStateQuery, memoizedSelect } from "../use-app-state.js";

interface Visit {
  readonly taskId: string | undefined;
  readonly readerId: string | undefined;
  readonly mark: number | undefined;
  readonly opened: number | undefined;
  readonly changed: ReadonlySet<string>;
}

export interface TaskLooks {
  readonly changed: ReadonlySet<string>;
  readonly dismiss: () => void;
}

const NOTHING_CHANGED: ReadonlySet<string> = new Set();

export const NO_LOOKS: TaskLooks = { changed: NOTHING_CHANGED, dismiss: () => undefined };

const watchedAtom = Atom.make<string | undefined>(undefined);

const NONE_MARKED: ReadonlySet<string> = new Set();

const selectMarkedUnreadIds = memoizedSelect(
  (state) => [state.tasks.tasks, state.tasks.tasklessAgents],
  (tasks, tasklessAgents): ReadonlySet<string> =>
    new Set(
      [...tasks, ...(tasklessAgents ?? [])]
        .filter((row) => row.markedUnread === true)
        .map((row) => row.id),
    ),
);

function sectionSavesOf(task: Task): readonly DescriptionSectionEdit[] {
  return task.sectionEdits ?? [];
}

function newestSaveOf(task: Task): number {
  return Math.max(
    task.updatedAt,
    ...(task.lastEdit === undefined ? [] : [task.lastEdit.at]),
    ...sectionSavesOf(task).map((edit) => edit.at),
  );
}

function newestChangeOf(task: Pick<TaskSummary, "updatedAt" | "agents">): number {
  return Math.max(task.updatedAt, task.agents?.activityAt ?? task.updatedAt);
}

function readersOwn(edit: DescriptionSectionEdit, readerId: string | undefined): boolean {
  if (edit.actor !== DESCRIPTION_ACTOR.DEVELOPER) return false;
  return edit.by === undefined || readerId === undefined || edit.by.userId === readerId;
}

function visited(
  task: Task | undefined,
  readerId: string | undefined,
  mark: number | undefined,
  opened: number | undefined,
): Visit {
  if (task === undefined)
    return {
      taskId: undefined,
      readerId,
      mark: undefined,
      opened: undefined,
      changed: NOTHING_CHANGED,
    };
  const changed =
    mark === undefined || opened === undefined
      ? NOTHING_CHANGED
      : new Set(
          sectionSavesOf(task)
            .filter((edit) => !readersOwn(edit, readerId) && edit.at > mark && edit.at <= opened)
            .map((edit) => edit.section),
        );
  return { taskId: task.id, readerId, mark, opened, changed };
}

function revisited(
  held: Visit | undefined,
  task: Task | undefined,
  readerId: string | undefined,
  mark: number | undefined,
): Visit {
  if (task === undefined) return visited(undefined, readerId, undefined, undefined);
  if (held !== undefined && held.taskId === task.id)
    return visited(task, readerId, held.mark, held.opened);
  return visited(task, readerId, mark, newestSaveOf(task));
}

export function useTaskLooks(
  task: Task | undefined,
  readerId: string | undefined,
  row?: Pick<TaskSummary, "readThrough" | "agents">,
): TaskLooks {
  const [visit, setVisit] = useState(() => revisited(undefined, task, readerId, row?.readThrough));
  const watch = useAtomSet(watchedAtom);
  let current = visit;
  if (visit.taskId !== task?.id || visit.readerId !== readerId) {
    current = revisited(visit, task, readerId, row?.readThrough);
    setVisit(current);
  }
  const taskId = task?.id;
  const activityAt = row?.agents?.activityAt;
  const { mutate: markTaskRead } = useMutation(actMutation(ACT_KIND.TASKS_MARK_READ));
  const lookAtTask = useCallback(
    (taskId: string, readMark: ReadMark) => markTaskRead({ taskId, readMark }),
    [markTaskRead],
  );

  useEffect(() => {
    if (taskId === undefined) return;
    watch(taskId);
    lookAtTask(taskId, READ_MARK.READ);
    return () => {
      watch(undefined);
      lookAtTask(taskId, READ_MARK.SEEN);
    };
  }, [taskId, watch, lookAtTask]);

  const seenActivity = useRef<{ taskId: string; activityAt: number | undefined } | undefined>(
    undefined,
  );
  useEffect(() => {
    const seen = seenActivity.current;
    seenActivity.current = taskId === undefined ? undefined : { taskId, activityAt };
    if (taskId === undefined || seen?.taskId !== taskId || seen.activityAt === activityAt) return;
    lookAtTask(taskId, READ_MARK.SEEN);
  }, [taskId, activityAt, lookAtTask]);

  const dismiss = useCallback(() => {
    setVisit((held) =>
      held.taskId === taskId ? { ...held, mark: held.opened, changed: NOTHING_CHANGED } : held,
    );
    if (taskId !== undefined) lookAtTask(taskId, READ_MARK.SEEN);
  }, [taskId, lookAtTask]);
  const { changed } = current;
  return useMemo(() => ({ changed, dismiss }), [changed, dismiss]);
}

export function useAgentLook(agent: Pick<TasklessAgent, "id" | "activityAt"> | undefined): void {
  const agentId = agent?.id;
  const activityAt = agent?.activityAt;
  const { mutate: markAgentRead } = useMutation(actMutation(ACT_KIND.AGENTS_MARK_READ));
  const lookAtAgent = useCallback(
    (agentId: string, readMark: ReadMark) => markAgentRead({ agentId, readMark }),
    [markAgentRead],
  );
  useEffect(() => {
    if (agentId === undefined) return;
    lookAtAgent(agentId, READ_MARK.READ);
    return () => lookAtAgent(agentId, READ_MARK.SEEN);
  }, [agentId, lookAtAgent]);

  const seenActivity = useRef<{ agentId: string; activityAt: number | undefined } | undefined>(
    undefined,
  );
  useEffect(() => {
    const seen = seenActivity.current;
    seenActivity.current = agentId === undefined ? undefined : { agentId, activityAt };
    if (agentId === undefined || seen?.agentId !== agentId || seen.activityAt === activityAt)
      return;
    lookAtAgent(agentId, READ_MARK.SEEN);
  }, [agentId, activityAt, lookAtAgent]);
}

export function useUnreadTasks({ staged }: { staged: boolean }): (task: TaskSummary) => boolean {
  const watched = useAtomValue(watchedAtom);
  return (task) => {
    if (staged) return false;
    if (task.markedUnread === true) return true;
    return task.id !== watched && readsUnread(task, newestChangeOf(task));
  };
}

export function agentReadsUnread(agent: TasklessAgent): boolean {
  return readsUnread(agent, agent.activityAt);
}

export interface ReadMarks {
  readonly watched: string | undefined;
  readonly markedUnread: (taskId: string) => boolean;
  readonly mark: (task: Pick<TaskSummary, "id">, unread: boolean) => void;
}

function readMarkOf(unread: boolean): ReadMark {
  return unread ? READ_MARK.UNREAD : READ_MARK.READ;
}

function useMarkTask(): ReadMarks["mark"] {
  const { mutate: markTaskRead } = useMutation(pressMutation(ACT_KIND.TASKS_MARK_READ));
  return useCallback(
    (task, unread) => markTaskRead({ taskId: task.id, readMark: readMarkOf(unread) }),
    [markTaskRead],
  );
}

export function useReadMarks(): ReadMarks {
  const marked = useQuery({ ...appStateQuery, select: selectMarkedUnreadIds }).data ?? NONE_MARKED;
  const watched = useAtomValue(watchedAtom);
  const mark = useMarkTask();
  return { watched, markedUnread: (taskId) => marked.has(taskId), mark };
}

export function useMarkedUnread(taskId: string): boolean {
  const select = useCallback(
    (state: AppStateSnapshot) => selectMarkedUnreadIds(state).has(taskId),
    [taskId],
  );
  return useQuery({ ...appStateQuery, select }).data === true;
}

export function useReadMark(): ReadMarks["mark"] {
  return useMarkTask();
}

export function useMarkAgent(): (agentId: string, unread: boolean) => void {
  const { mutate: markAgentRead } = useMutation(pressMutation(ACT_KIND.AGENTS_MARK_READ));
  return useCallback(
    (agentId, unread) => markAgentRead({ agentId, readMark: readMarkOf(unread) }),
    [markAgentRead],
  );
}
