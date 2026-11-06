import type { AppInboxTask, AppInboxTaskHolding, AppInboxWaitingItem } from "@repo/host/app-state";
import { useMinute } from "@repo/ui";
import { useMemo } from "react";
import { listedIn, waitsOnReader } from "../tasks/inbox-model.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

function toDoByTask(
  holdings: readonly AppInboxTaskHolding[],
  waiting: readonly AppInboxTask[],
): ReadonlyMap<string, number> {
  const counted = new Map<string, number>();
  for (const { taskId, toDo } of holdings) {
    if (toDo !== undefined) counted.set(taskId, toDo);
  }
  for (const { taskId, items } of waiting) {
    if (!counted.has(taskId)) counted.set(taskId, items.length);
  }
  return new Map([...counted].filter(([, count]) => count > 0));
}

function waitingThreads(tasks: TasksControl, now: number): readonly AppInboxWaitingItem[] {
  const standing = new Set(tasks.listed.tasks.map((task) => task.id));
  const ofTasks = tasks.inbox
    .filter((task) => standing.has(task.taskId))
    .flatMap((task) => task.items);
  const taskless = tasks.inboxTaskless.filter(
    (each) => waitsOnReader(each, tasks.me) && listedIn(each, tasks.workspace?.id),
  );
  return [...ofTasks, ...taskless].filter(
    (item) => item.remindAt === undefined || item.remindAt <= now,
  );
}

export function useTasksWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const byTask = useMemo(
    () => toDoByTask(tasks.inboxTasks, tasks.inbox),
    [tasks.inboxTasks, tasks.inbox],
  );
  return tasks.signedIn ? byTask : NO_COUNTS;
}

export function useInboxWaiting(tasks: TasksControl): number {
  const now = useMinute();
  return tasks.signedIn ? waitingThreads(tasks, now).length : 0;
}
