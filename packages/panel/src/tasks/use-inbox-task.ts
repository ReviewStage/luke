import { useSyncExternalStore } from "react";

/**
 * use-inbox-task.ts -- the task the Inbox is narrowed to, if any, and the doors that narrow and widen it.
 *
 * The Inbox may be narrowed to one task's items, as a task's "needs you"
 * count opens it (`chooseInboxTask`); with none chosen, as at launch, it
 * lists every task's items. Which task it is narrowed to is the window's own
 * while it runs, shared by every surface drawing the Inbox, and another
 * workspace listed in place of the one it stood in widens it again.
 */

/** The window's surfaces drawing the place, told of each change. */
const listeners = new Set<() => void>();

/** The task the Inbox is narrowed to, none where it lists every task's items. */
let narrowed: string | undefined;

/** The workspace the window lists, whose task the place names; none until the window lists one. */
let placeWorkspace: string | undefined;

/** The place as it stands, which a server's render reads as the window's does. */
function narrowedNow(): string | undefined {
  return narrowed;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Moves the window's place, telling every surface drawing it. */
function moveTo(next: string | undefined): void {
  if (next === narrowed) return;
  narrowed = next;
  for (const listener of listeners) listener();
}

/**
 * Tells the place the workspace the window lists. Another workspace listed
 * in place of the one the place stood in lists every task's items; the
 * first workspace listed keeps the place as a link chose it.
 */
export function listInboxWorkspace(workspaceId: string): void {
  if (placeWorkspace === workspaceId) return;
  const was = placeWorkspace;
  placeWorkspace = workspaceId;
  if (was !== undefined) moveTo(undefined);
}

/** Narrows the Inbox to one task's items; the door a task's "needs you" count opens it by. */
export function chooseInboxTask(taskId: string): void {
  moveTo(taskId);
}

/** Leaves the task the Inbox is narrowed to, so it lists every task's items again; the door the task's chip over the list clears it by. */
export function leaveInboxTask(): void {
  moveTo(undefined);
}

/**
 * Opens an item while the Inbox is narrowed to a task: an item of another
 * task, or of an agent on no task, leaves the task, so the list it opens in
 * holds it.
 */
export function openTaskThread(itemTaskId: string | undefined): void {
  if (narrowed !== undefined && narrowed !== itemTaskId) leaveInboxTask();
}

/** Stands the task as a step of the window's history or a link held it, none for the Inbox narrowed to none. */
export function standInboxTask(taskId: string | undefined): void {
  moveTo(taskId);
}

/** The task the Inbox is narrowed to; none where it lists every task's items. */
export function useInboxTask(): string | undefined {
  return useSyncExternalStore(subscribe, narrowedNow, narrowedNow);
}
