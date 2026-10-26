import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { waitsOnReader } from "./inbox-model.js";

/**
 * resting-page.ts -- the page the window rests on while no task is open: a new account's welcome, else what the sidebar does not list.
 *
 * With no task open the window shows what its sidebar leaves out. The
 * sidebar lists the tasks, so the window rests on the Inbox, on the item
 * last chosen there. An account with nothing yet, no task in any workspace
 * and nothing waiting on it, is welcomed instead, with New task's composer
 * under the welcome.
 */

/** Which page the window rests on. */
export const RESTING_PAGE = {
  /** A new account's welcome and New task's composer. */
  WELCOME: "welcome",
  /** The window's Inbox, on the item it names, or the list's first where it names none. */
  INBOX: "inbox",
} as const;

/** An Inbox item the window rests on: by the task it stands on, or, for an agent with no task, by its agent. */
export type RestingChoice =
  | { readonly taskId: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string };

/** The page the window rests on, and the Inbox item it opens on there. */
export type RestingPage =
  | { readonly kind: typeof RESTING_PAGE.WELCOME }
  | { readonly kind: typeof RESTING_PAGE.INBOX; readonly chosen: RestingChoice | undefined };

/**
 * Whether an account is new: no task in any workspace, and nothing an agent with no task waits on it for. Note that a teammate's
 * agent's question waits on the teammate, so it leaves the account new.
 */
export function freshAccount(account: {
  readonly tasks: readonly unknown[];
  readonly taskless: readonly Pick<AppInboxTasklessItem, "startedBy">[];
  readonly readerId: string | undefined;
}): boolean {
  return (
    account.tasks.length === 0 &&
    !account.taskless.some((each) => waitsOnReader(each, account.readerId))
  );
}

/** The page to rest on: the welcome for a new account, else the Inbox on the item last chosen there. */
export function restingPage(rest: {
  readonly fresh: boolean;
  /** The Inbox's last choice, in the workspace listed. */
  readonly remembered: RestingChoice | undefined;
}): RestingPage {
  if (rest.fresh) return { kind: RESTING_PAGE.WELCOME };
  return { kind: RESTING_PAGE.INBOX, chosen: rest.remembered };
}
