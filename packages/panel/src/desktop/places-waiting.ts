import type { AppInboxTask, AppInboxTaskHolding, AppInboxWaitingItem } from "@luke/host/app-state";
import { useMemo } from "react";
import { listedIn, waitsOnReader } from "../tasks/inbox-model.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * places-waiting.ts -- how many wait on the developer in the Inbox, the one
 * reading the places that count them draw from: the sidebar's rows
 * (`desktop-sidebar.tsx`), a phone's places bar (`mobile-bar.tsx`), and
 * each task's badge on the Tasks page's List and Board. The Inbox's row
 * counts the open threads that wait on the developer, a question or an
 * update not yet opened, the threads its Needs you lists (`inbox-model.ts`'s
 * `needsYou`), while a task's badge counts its questions alone, as main
 * counts them. Each channel's row counts the same threads the Inbox's does,
 * by the channel each lives in (`useChannelWaiting`), so the channels' add
 * up to the Inbox's, bar those in an archived channel, which has no row.
 */

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/**
 * How many questions wait on the developer on each task main lists, every
 * workspace's, since ⌘K's rows name another workspace's tasks: main's count
 * of each task's (`toDo`), which the host lowers the moment the reader
 * answers one (`@luke/host`'s `account-inbox-follow.ts`). A notice, a
 * teammate's question, and a settled item never count, read or not, as the
 * Dock's badge counts them. Where main carries no count of a task's to do,
 * from a service before it, its open items are counted, as before. A task
 * where none waits is left out.
 */
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

/**
 * Every thread waiting on the developer in the listed workspace's Inbox:
 * each standing task's open items main lists as theirs, and every open item
 * from an agent with no task of that workspace (`listedIn`) that waits on
 * them (`waitsOnReader`), a question or a notice alike, as Needs you lists
 * them. Note that a notice counts until it is opened, because opening it
 * settles it as Got it does; a teammate's thread and a settled one never
 * count, and one the reader settles leaves main's read the moment it is
 * asked (`@luke/host`'s `account-inbox-follow.ts`).
 */
function waitingThreads(tasks: TasksControl): readonly Pick<AppInboxWaitingItem, "channelId">[] {
  // Note that only the standing tasks are counted, as To do lists them, so a task not listed yet counts nowhere.
  const standing = new Set(tasks.listed.tasks.map((task) => task.id));
  const ofTasks = tasks.inbox
    .filter((task) => standing.has(task.taskId))
    .flatMap((task) => task.items);
  const taskless = tasks.inboxTaskless.filter(
    (each) => waitsOnReader(each, tasks.me) && listedIn(each, tasks.workspace?.id),
  );
  return [...ofTasks, ...taskless];
}

/** How many questions wait on the developer on each task, by task, as main counts them; a task where none waits is left out, and every one while signed out. */
export function useTasksWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const byTask = useMemo(
    () => toDoByTask(tasks.inboxTasks, tasks.inbox),
    [tasks.inboxTasks, tasks.inbox],
  );
  return tasks.signedIn ? byTask : NO_COUNTS;
}

/**
 * How many threads wait on the developer in the Inbox, as many as Needs you
 * lists, the number that reaches zero once each question is answered and
 * each update opened (`waitingThreads`); a teammate's is listed in the
 * Inbox, and waits on the teammate. None while signed out.
 */
export function useInboxWaiting(tasks: TasksControl): number {
  return tasks.signedIn ? waitingThreads(tasks).length : 0;
}

/**
 * How many of the threads the Inbox counts (`waitingThreads`) live in each
 * channel, by channel: what each channel's sidebar row says, so the rows
 * add up to the Inbox's number. A channel where none waits is left out, and
 * every one while signed out; a thread from a service that names no
 * channel counts in the Inbox's number alone.
 */
export function useChannelWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  if (!tasks.signedIn) return counts;
  for (const { channelId } of waitingThreads(tasks)) {
    if (channelId !== undefined) counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
  }
  return counts;
}
