import {
  readAccountAccess,
  readAccountDeletionReach,
  readAccountPreferences,
  settleAccountDeletion,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { accountFastOffer } from "../agents/coder-host/agent-runtime-choice.js";
import { auth } from "../auth/auth.js";
import { resolveHostedUserId } from "../auth/bearer.js";
import { resolveBrowserSessionUserId } from "../auth/browser-session.js";
import { accountDeletionCalls } from "./account-deletion-calls.js";
import type { AccountProcedureSeams } from "./account-procedures.js";

/**
 * The account procedures' seams over this deployment's real database. The
 * analytics erasure key and project are read from `HostedEnvironment`
 * instead, once with the services rather than at each invocation.
 * `accounts/account-procedures.ts` describes the procedures; this is the one
 * place that hands them a real user table and a real preferences store.
 *
 * The reads and writes themselves are `account-store.ts`'s effects over the
 * ambient `SqlClient`, handed on as the effects they are: the procedures
 * yield them on the request's own fiber, and the edge that serves the
 * request is the one place the client behind them is provided.
 */

/** This deployment's account procedures, over its real database and auth session. The analytics erasure key and project are read from `HostedEnvironment`, not here. */
export function accountProcedureSeams(): AccountProcedureSeams {
  return {
    resolveUserId: resolveHostedUserId,
    standingSessions: (userId) => standingSessionsOf(userId),
    resolveSessionUserId: resolveBrowserSessionUserId,
    readDeletionReach: readAccountDeletionReach,
    settleDeletion: settleAccountDeletion,
    accountDeletion: accountDeletionCalls(
      auth.api,
      async () => (await auth.$context).sessionConfig.freshAge,
    ),
    readPreferences: readAccountPreferences,
    readAccess: readAccountAccess,
    accountFastOffer,
    writePreferences: writeAccountPreferences,
  };
}
