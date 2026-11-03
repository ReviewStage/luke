import type { AppInboxTasklessItem } from "@repo/host/app-state";
import { waitsOnReader } from "./inbox-model.js";

/**
 * fresh-account.ts -- whether an account is new, which Home welcomes with New task's composer in place of its sections (`desktop-welcome.tsx`).
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
