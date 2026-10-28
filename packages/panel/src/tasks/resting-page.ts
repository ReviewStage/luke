import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { waitsOnReader } from "./inbox-model.js";

/**
 * resting-page.ts -- the page the window rests on while no task is open: a new account's welcome, else what the sidebar does not list.
 *
 * With no task open the window shows what its sidebar leaves out. The
 * sidebar lists the tasks, so the window rests on the Inbox, with nothing
 * chosen in it. An account with nothing yet, no task in any workspace
 * and nothing waiting on it, is welcomed instead, with New task's composer
 * under the welcome.
 */

/** Which page the window rests on. */
export const RESTING_PAGE = {
  /** A new account's welcome and New task's composer. */
  WELCOME: "welcome",
  /** The window's Inbox. */
  INBOX: "inbox",
} as const;

/** The page the window rests on. */
type RestingPage = (typeof RESTING_PAGE)[keyof typeof RESTING_PAGE];

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

/** The page to rest on: the welcome for a new account, else the Inbox. */
export function restingPage(fresh: boolean): RestingPage {
  return fresh ? RESTING_PAGE.WELCOME : RESTING_PAGE.INBOX;
}
