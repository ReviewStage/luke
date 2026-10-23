import { forYou } from "@luke/ui/chat-model";
import { useMemo } from "react";
import { NEEDS_YOU, waitsOnReader } from "../tasks/inbox-model.js";
import { type SettledWaiting, useSettledToDo, useSettledWaiting } from "../tasks/inbox-settling.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * places-waiting.ts -- how many wait on the developer in the Inbox and in
 * Chat, the one reading both places that count them draw from: the
 * sidebar's rows (`desktop-sidebar.tsx`) and a phone's places bar
 * (`mobile-bar.tsx`), so the drawer and the bar never disagree.
 */

/** How many wait on the developer in each place that counts them. */
export interface PlacesWaiting {
  /** What the Inbox's To do lists. */
  readonly inbox: number;
  /** What Chat's For you lists. */
  readonly chat: number;
}

/**
 * How many items the Inbox's To do lists: main's count of each standing
 * task's of the listed workspace (`toDo`), the reader's own open or unread,
 * and every open one from an agent with no task that the developer started
 * (`waitsOnReader`), which names no workspace to be counted in; a
 * teammate's is listed in the Inbox, and waits on the teammate. An item the
 * window answered or marked is counted as it now stands from the moment it
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
  return tasks + taskless.filter((each) => waitsOnReader(each, readerId)).length;
}

/** How many messages wait on the developer in Chat: what For you lists. */
function waitingMessages(tasks: TasksControl): number {
  const read = tasks.chatView.chat;
  return read === undefined ? 0 : forYou(read.answer).length;
}

/** What a count of what waits on the developer is said with, after its figure: "3 need you". */
export function needsYouNoun(count: number): string {
  return count === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many;
}

/** How many wait on the developer in the Inbox and in Chat; none in the Inbox while signed out. */
export function usePlacesWaiting(tasks: TasksControl): PlacesWaiting {
  const settledWaiting = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  // Note that only the standing tasks are counted, as To do lists them, so an archived task's or one not listed yet counts nowhere.
  const { inboxTasks, tasks: standingTasks } = tasks.listed;
  const standingHoldings = useMemo(
    () => inboxTasks.filter((holding) => standingTasks.some((task) => task.id === holding.taskId)),
    [inboxTasks, standingTasks],
  );
  const toDo = useSettledToDo(
    standingHoldings,
    tasks.listed.inbox,
    settledWaiting.waiting,
    tasks.inboxTasks,
  );
  return {
    inbox: tasks.signedIn ? waitingItems(settledWaiting, toDo, tasks.me) : 0,
    chat: waitingMessages(tasks),
  };
}
