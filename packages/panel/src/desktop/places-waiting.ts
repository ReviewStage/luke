import type { AppInboxWaitingItem } from "@luke/host/app-state";
import { listedIn, waitsOnReader } from "../tasks/inbox-model.js";
import { type SettledWaiting, useSettledToDo, useSettledWaiting } from "../tasks/inbox-settling.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * places-waiting.ts -- how many wait on the developer in the Inbox, the one
 * reading the places that count them draw from: the sidebar's rows
 * (`desktop-sidebar.tsx`), a phone's places bar (`mobile-bar.tsx`), and
 * each task's badge on the Tasks page's List and Board. The Inbox's row
 * counts the open threads that wait on the developer, a question or an
 * update not yet opened, the threads its For you lists (`inbox-model.ts`'s
 * `needsYou`), while a task's badge counts its questions alone, as main
 * counts them. Each channel's row counts the same threads the Inbox's does,
 * by the channel each lives in (`useChannelWaiting`), so the channels' add
 * up to the Inbox's, bar those in an archived channel, which has no row.
 */

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/**
 * Main's read of what waits with the window's answers laid over it, and how
 * many questions wait on the developer on each task it lists, every
 * workspace's, since ⌘K's rows name another workspace's tasks: main's count
 * of each task's (`toDo`), the open asks that wait on the reader, less those
 * the window answered since (`useSettledToDo`). A notice, a teammate's
 * question, and a settled item never count, read or not, as the Dock's badge
 * counts them. Where main carries no count of a task's to do, from a service
 * before it, its open items are counted, as before.
 */
function useSettledCounts(tasks: TasksControl): {
  settled: SettledWaiting;
  byTask: ReadonlyMap<string, number>;
} {
  const settled = useSettledWaiting(tasks.inbox, tasks.inboxTaskless);
  const byTask = useSettledToDo(tasks.inboxTasks, tasks.inbox, settled.waiting);
  return { settled, byTask };
}

/**
 * Every thread waiting on the developer in the listed workspace's Inbox, as
 * the window's answers and nods leave it (`settled`): each standing task's
 * open items main lists as theirs, and every open item from an agent with no
 * task of that workspace (`listedIn`) that waits on them (`waitsOnReader`),
 * a question or a notice alike, as For you lists them. Note that a notice
 * counts until it is opened, because opening it settles it as Got it does;
 * a teammate's thread and a settled one never count.
 */
function waitingThreads(
  tasks: TasksControl,
  settled: SettledWaiting,
): readonly Pick<AppInboxWaitingItem, "channelId">[] {
  // Note that only the standing tasks are counted, as To do lists them, so a task not listed yet counts nowhere.
  const standing = new Set(tasks.listed.tasks.map((task) => task.id));
  const ofTasks = settled.waiting
    .filter((task) => standing.has(task.taskId))
    .flatMap((task) => task.items);
  const taskless = settled.taskless.filter(
    (each) => waitsOnReader(each, tasks.me) && listedIn(each, tasks.workspace?.id),
  );
  return [...ofTasks, ...taskless];
}

/** What the Inbox's and a channel's count are said with, after the figure, as the list they count is named: "3 for you". */
export const FOR_YOU_NOUN = "for you";

/** How many questions wait on the developer on each task, by task, as main counts them; a task where none waits is left out, and every one while signed out. */
export function useTasksWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const { byTask } = useSettledCounts(tasks);
  return tasks.signedIn ? byTask : NO_COUNTS;
}

/**
 * How many threads wait on the developer in the Inbox, as many as For you
 * lists, the number that reaches zero once each question is answered and
 * each update opened (`waitingThreads`); a teammate's is listed in the
 * Inbox, and waits on the teammate. None while signed out.
 */
export function useInboxWaiting(tasks: TasksControl): number {
  const settled = useSettledWaiting(tasks.inbox, tasks.inboxTaskless);
  return tasks.signedIn ? waitingThreads(tasks, settled).length : 0;
}

/**
 * How many of the threads the Inbox counts (`waitingThreads`) live in each
 * channel, by channel: what each channel's sidebar row says, so the rows
 * add up to the Inbox's number. A channel where none waits is left out, and
 * every one while signed out; a thread from a service that names no
 * channel counts in the Inbox's number alone.
 */
export function useChannelWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const settled = useSettledWaiting(tasks.inbox, tasks.inboxTaskless);
  const counts = new Map<string, number>();
  if (!tasks.signedIn) return counts;
  for (const { channelId } of waitingThreads(tasks, settled)) {
    if (channelId !== undefined) counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
  }
  return counts;
}
