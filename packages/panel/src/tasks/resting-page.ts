import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { waitsOnReader } from "./inbox-model.js";

/**
 * resting-page.ts -- whether the window, with no task open, rests on a new account's welcome rather than on Channels.
 *
 * With no task open the window rests on Channels, on the channel last
 * chosen, else #general. An account with nothing yet, no task in any
 * workspace and nothing waiting on it, is welcomed instead, with New task's
 * composer under the welcome.
 */

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
