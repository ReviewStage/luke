import type { AppInboxTasklessItem } from "@repo/host/app-state";
import { waitsOnReader } from "./inbox-model.js";

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
