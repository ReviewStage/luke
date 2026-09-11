import type { AccountAppSeams } from "../account-app.js";
import { runWeb } from "../runtime.js";
import { deleteAccount, readAccountPreferences, writeAccountPreferences } from "./account-store.js";
import { resolveHostedUserId } from "./vault-route.js";

/**
 * The account group's seams over this deployment's real database. The
 * analytics erasure key and project are read from `HostedEnvironment`
 * instead, once with the services rather than at each invocation.
 * `server/account-app.ts` describes the two endpoints; this is the one place
 * that hands them a real user table and a real preferences store, so both
 * `api/account/**` functions build the group from the same wiring.
 *
 * The reads and writes themselves are `account-store.ts`'s effects over the
 * ambient `SqlClient`; what this file adds is the edge that runs them and the
 * auth session the bearer is resolved against.
 */

/** This deployment's account group, over its real database and auth session. The analytics erasure key and project are read from `HostedEnvironment`, not here. */
export function accountAppSeams(): AccountAppSeams {
  return {
    resolveUserId: resolveHostedUserId,
    deleteUser: (userId) => runWeb(deleteAccount(userId)),
    readPreferences: (userId) => runWeb(readAccountPreferences(userId)),
    writePreferences: (userId, preferences) => runWeb(writeAccountPreferences(userId, preferences)),
  };
}
