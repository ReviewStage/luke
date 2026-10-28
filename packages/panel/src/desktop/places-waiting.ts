import type { AppInboxWaitingItem } from "@luke/host/app-state";
import { holdsAsk, listedIn, NEEDS_YOU, waitsOnReader } from "../tasks/inbox-model.js";
import { type SettledWaiting, useSettledToDo, useSettledWaiting } from "../tasks/inbox-settling.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * places-waiting.ts -- how many wait on the developer in the Inbox, the one
 * reading the places that count them draw from: the sidebar's rows
 * (`desktop-sidebar.tsx`), a phone's places bar (`mobile-bar.tsx`), each
 * task's badge on the Tasks page's List and Board, and the waiting-on-you
 * icon every task row wears (`TaskAgentsMark`) in the sidebar, Recent, ⌘K,
 * and on the Tasks page, so the drawer, the bar, the page, and the rows never
 * disagree. Each channel's row counts the same questions the Inbox's does,
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
 * Every question waiting on the developer in the listed workspace's Inbox,
 * as the window's answers leave it (`settled`): each standing task's open
 * asks main lists as theirs, and every open ask from an agent with no task
 * of that workspace (`listedIn`) that waits on them (`waitsOnReader`); a
 * notice, a teammate's question, and a settled item never count.
 */
function waitingAsks(
  tasks: TasksControl,
  settled: SettledWaiting,
): readonly Pick<AppInboxWaitingItem, "channelId">[] {
  // Note that only the standing tasks are counted, as To do lists them, so a task not listed yet counts nowhere.
  const standing = new Set(tasks.listed.tasks.map((task) => task.id));
  const ofTasks = settled.waiting
    .filter((task) => standing.has(task.taskId))
    .flatMap((task) => task.items)
    .filter(holdsAsk);
  const taskless = settled.taskless.filter(
    (each) =>
      holdsAsk(each) && waitsOnReader(each, tasks.me) && listedIn(each, tasks.workspace?.id),
  );
  return [...ofTasks, ...taskless];
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
 * reaches zero once each is answered (`waitingAsks`); a teammate's is
 * listed in the Inbox, and waits on the teammate. None while signed out.
 */
export function useInboxWaiting(tasks: TasksControl): number {
  const settled = useSettledWaiting(tasks.inbox, tasks.inboxTaskless);
  return tasks.signedIn ? waitingAsks(tasks, settled).length : 0;
}

/**
 * How many of the questions the Inbox counts (`waitingAsks`) live in each
 * channel, by channel: what each channel's sidebar row says, so the rows
 * add up to the Inbox's number. A channel where none waits is left out, and
 * every one while signed out; a question from a service that names no
 * channel counts in the Inbox's number alone.
 */
export function useChannelWaiting(tasks: TasksControl): ReadonlyMap<string, number> {
  const settled = useSettledWaiting(tasks.inbox, tasks.inboxTaskless);
  const counts = new Map<string, number>();
  if (!tasks.signedIn) return counts;
  for (const { channelId } of waitingAsks(tasks, settled)) {
    if (channelId !== undefined) counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
  }
  return counts;
}
