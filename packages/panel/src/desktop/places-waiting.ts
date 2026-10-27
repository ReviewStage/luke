import { holdsAsk, NEEDS_YOU, waitsOnReader } from "../tasks/inbox-model.js";
import { type SettledWaiting, useSettledToDo, useSettledWaiting } from "../tasks/inbox-settling.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * places-waiting.ts -- how many wait on the developer in the Inbox, the one
 * reading the places that count them draw from: the sidebar's rows
 * (`desktop-sidebar.tsx`), a phone's places bar (`mobile-bar.tsx`), and
 * each task's badge on the Tasks page's List and Board, so the drawer, the
 * bar, and the page never disagree.
 */

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/**
 * Main's read of what waits with the window's answers laid over it, and how
 * many questions wait on the developer on each task it lists: main's count
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
  const settled = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  const byTask = useSettledToDo(tasks.listed.inboxTasks, tasks.listed.inbox, settled.waiting);
  return { settled, byTask };
}

/** What a count of what waits on the developer is said with, after its figure: "3 need you". */
export function needsYouNoun(count: number): string {
  return count === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many;
}

/** How many questions wait on the developer on each task, by task, as the Inbox counts them; a task where none waits is left out, and every one while signed out. */
export function useTasksWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const { byTask } = useSettledCounts(tasks);
  return tasks.signedIn ? byTask : NO_COUNTS;
}

/**
 * How many questions wait on the developer in the Inbox, the number that
 * reaches zero once each is answered: each standing task's of the listed
 * workspace, and every open ask from an agent with no task that waits on
 * them (`waitsOnReader`, `holdsAsk`), which names no workspace to be counted
 * in; a teammate's is listed in the Inbox, and waits on the teammate. None
 * while signed out.
 */
export function useInboxWaiting(tasks: TasksControl): number {
  const { settled, byTask } = useSettledCounts(tasks);
  if (!tasks.signedIn) return 0;
  // Note that only the standing tasks are counted, as To do lists them, so an archived task's or one not listed yet counts nowhere.
  const standing = tasks.listed.tasks.reduce((sum, task) => sum + (byTask.get(task.id) ?? 0), 0);
  const taskless = settled.taskless.filter(
    (each) => holdsAsk(each) && waitsOnReader(each, tasks.me),
  ).length;
  return standing + taskless;
}
