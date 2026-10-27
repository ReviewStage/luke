import { useMemo } from "react";
import { holdsAsk, NEEDS_YOU, waitsOnReader } from "../tasks/inbox-model.js";
import { type SettledWaiting, useSettledToDo, useSettledWaiting } from "../tasks/inbox-settling.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * places-waiting.ts -- how many wait on the developer in the Inbox, the one
 * reading the places that count them draw from: the sidebar's rows
 * (`desktop-sidebar.tsx`) and a phone's places bar (`mobile-bar.tsx`), so
 * the drawer and the bar never disagree.
 */

/**
 * How many questions wait on the developer in the Inbox, the number that
 * reaches zero once each is answered: main's count of each standing task's
 * of the listed workspace (`toDo`), the open asks that wait on the reader,
 * and every open ask from an agent with no task that waits on them
 * (`waitsOnReader`, `holdsAsk`), which names no workspace to be counted in;
 * a teammate's is listed in the Inbox, and waits on the teammate. A notice
 * and a settled item never count, read or not, as the Dock's badge counts
 * them. A question the window answered counts no longer from the moment it
 * was sent (`inbox-settling.ts`). Where main carries no count of the tasks'
 * to do, from a service before it, their open items are counted, as
 * before.
 */
function waitingItems(
  { waiting, taskless }: SettledWaiting,
  toDo: number | undefined,
  readerId: string | undefined,
): number {
  const tasks = toDo ?? waiting.reduce((sum, task) => sum + task.items.length, 0);
  return tasks + taskless.filter((each) => holdsAsk(each) && waitsOnReader(each, readerId)).length;
}

/** What a count of what waits on the developer is said with, after its figure: "3 need you". */
export function needsYouNoun(count: number): string {
  return count === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many;
}

/** How many questions wait on the developer in the Inbox; none while signed out. */
export function useInboxWaiting(tasks: TasksControl): number {
  const settledWaiting = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  // Note that only the standing tasks are counted, as To do lists them, so an archived task's or one not listed yet counts nowhere.
  const { inboxTasks, tasks: standingTasks } = tasks.listed;
  const standingHoldings = useMemo(
    () => inboxTasks.filter((holding) => standingTasks.some((task) => task.id === holding.taskId)),
    [inboxTasks, standingTasks],
  );
  const toDo = useSettledToDo(standingHoldings, tasks.listed.inbox, settledWaiting.waiting);
  return tasks.signedIn ? waitingItems(settledWaiting, toDo, tasks.me) : 0;
}
