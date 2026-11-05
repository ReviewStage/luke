/**
 * no-account-deletion.ts -- the account procedures' deletion seams for a suite that deletes no account.
 *
 * Each dies if reached, so a suite that only reads or writes an account's
 * preferences or access says so, rather than standing up a Better Auth.
 */

import { Effect } from "effect";
import type { AccountProcedureSeams } from "../accounts/account-procedures.js";

const reached = () => Effect.die(new Error("this suite deletes no account"));

/** The deletion seams, every one refusing to be reached. */
export const NO_ACCOUNT_DELETION = {
  standingSessions: reached,
  resolveSessionUserId: reached,
  readDeletionReach: reached,
  settleDeletion: reached,
  accountDeletion: { sessionFresh: reached, deleteUser: reached },
} satisfies Pick<
  AccountProcedureSeams,
  | "standingSessions"
  | "resolveSessionUserId"
  | "readDeletionReach"
  | "settleDeletion"
  | "accountDeletion"
>;
