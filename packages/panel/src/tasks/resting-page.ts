import type { AppInboxTask, AppInboxTasklessItem } from "@luke/host/app-state";
import { waitsOnReader } from "./inbox-model.js";

/**
 * resting-page.ts -- the page the window rests on while no task is open: a new account's welcome, else what the sidebar does not list.
 *
 * With no task open the window shows what its sidebar leaves out. The
 * sidebar lists the tasks, so the window rests on the Inbox, on the item
 * last chosen there; under the inbox-first sidebar, which lists the Inbox's
 * threads, it rests on the newest thread waiting on the reader, and on the
 * Tasks page where nothing waits. An account with nothing yet, no task in
 * any workspace and nothing waiting on it, is welcomed instead, with New
 * task's composer under the welcome.
 */

/** Which page the window rests on. */
export const RESTING_PAGE = {
  /** A new account's welcome and New task's composer. */
  WELCOME: "welcome",
  /** The window's Inbox, on the item it names, or the list's first where it names none. */
  INBOX: "inbox",
  /** The Tasks page. */
  TASKS: "tasks",
} as const;

/** An Inbox item the window rests on: by the task it stands on, or, for an agent with no task, by its agent. */
export type RestingChoice =
  | { readonly taskId: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string };

/** The page the window rests on, and the Inbox item it opens on there. */
export type RestingPage =
  | { readonly kind: typeof RESTING_PAGE.WELCOME }
  | { readonly kind: typeof RESTING_PAGE.INBOX; readonly chosen: RestingChoice | undefined }
  | { readonly kind: typeof RESTING_PAGE.TASKS };

/**
 * Whether an account is new: no task in any workspace, standing or archived,
 * and nothing an agent with no task waits on it for. Note that a teammate's
 * agent's question waits on the teammate, so it leaves the account new.
 */
export function freshAccount(account: {
  readonly tasks: readonly unknown[];
  readonly archived: readonly unknown[];
  readonly taskless: readonly Pick<AppInboxTasklessItem, "startedBy">[];
  readonly readerId: string | undefined;
}): boolean {
  return (
    account.tasks.length === 0 &&
    account.archived.length === 0 &&
    !account.taskless.some((each) => waitsOnReader(each, account.readerId))
  );
}

/**
 * The item waiting on the reader that was posted last, in the workspace
 * listed: a listed task's, or one an agent with no task posted there or in
 * no workspace named. None where nothing waits.
 */
export function newestWaiting(waiting: {
  /** The listed workspace's tasks holding items waiting on the reader. */
  readonly tasks: readonly AppInboxTask[];
  readonly taskless: readonly AppInboxTasklessItem[];
  readonly workspaceId: string | undefined;
  readonly readerId: string | undefined;
}): RestingChoice | undefined {
  let newest: { readonly choice: RestingChoice; readonly postedAt: number } | undefined;
  const consider = (choice: RestingChoice, postedAt: number) => {
    if (newest === undefined || postedAt > newest.postedAt) newest = { choice, postedAt };
  };
  for (const task of waiting.tasks) {
    for (const item of task.items)
      consider({ taskId: task.taskId, itemId: item.id }, item.postedAt);
  }
  for (const item of waiting.taskless) {
    if (!waitsOnReader(item, waiting.readerId)) continue;
    if (item.workspaceId !== undefined && item.workspaceId !== waiting.workspaceId) continue;
    consider({ agentId: item.agentId, itemId: item.id }, item.postedAt);
  }
  return newest?.choice;
}

/**
 * The page to rest on: the welcome for a new account; else, beside the
 * task list, the Inbox on the item last chosen there; else, beside the
 * inbox-first sidebar, the newest item waiting, or the Tasks page where
 * none does.
 */
export function restingPage(rest: {
  readonly fresh: boolean;
  /** Whether the sidebar lists the Inbox's threads in place of the tasks. */
  readonly inboxFirst: boolean;
  /** The Inbox's last choice, in the workspace listed. */
  readonly remembered: RestingChoice | undefined;
  /** The newest item waiting on the reader, in the workspace listed. */
  readonly newest: RestingChoice | undefined;
}): RestingPage {
  if (rest.fresh) return { kind: RESTING_PAGE.WELCOME };
  if (!rest.inboxFirst) return { kind: RESTING_PAGE.INBOX, chosen: rest.remembered };
  return rest.newest === undefined
    ? { kind: RESTING_PAGE.TASKS }
    : { kind: RESTING_PAGE.INBOX, chosen: rest.newest };
}
