import {
  readAccountAccess,
  readAccountPreferences,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { accountFastOffer } from "../agents/coder-host/agent-runtime-choice.js";
import { resolveHostedUserId } from "../auth/bearer.js";
import type { AccountProcedureSeams } from "./account-procedures.js";

/**
 * The account procedures' seams over this deployment's real database.
 * `accounts/account-procedures.ts` describes the procedures; this is the one
 * place that hands them a real user table and a real preferences store.
 *
 * The reads and writes themselves are `account-store.ts`'s effects over the
 * ambient `SqlClient`, handed on as the effects they are: the procedures
 * yield them on the request's own fiber, and the edge that serves the
 * request is the one place the client behind them is provided.
 */

/** This deployment's account procedures, over its real database and auth session. */
export function accountProcedureSeams(): AccountProcedureSeams {
  return {
    resolveUserId: resolveHostedUserId,
    readPreferences: readAccountPreferences,
    readAccess: readAccountAccess,
    accountFastOffer,
    writePreferences: writeAccountPreferences,
  };
}
