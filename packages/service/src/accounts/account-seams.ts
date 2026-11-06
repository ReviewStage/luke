import {
  deleteAccount,
  readAccountAccess,
  readAccountPreferences,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { accountFastOffer } from "../agents/coder-host/agent-runtime-choice.js";
import { resolveHostedUserId } from "../auth/bearer.js";
import type { AccountProcedureSeams } from "./account-procedures.js";

export function accountProcedureSeams(): AccountProcedureSeams {
  return {
    resolveUserId: resolveHostedUserId,
    standingSessions: (userId) => standingSessionsOf(userId),
    deleteUser: deleteAccount,
    readPreferences: readAccountPreferences,
    readAccess: readAccountAccess,
    accountFastOffer,
    writePreferences: writeAccountPreferences,
  };
}
