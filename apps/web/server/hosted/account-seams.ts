import {
  deleteAccount,
  readAccountPreferences,
  readPlanTemplate,
  restorePlanTemplate,
  writeAccountPreferences,
  writePlanTemplate,
} from "@luke/database/models/account-store";
import {
  listTemplateRevisions,
  readTemplateRevision,
} from "@luke/database/models/plan-template-revisions";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import type { AccountAppSeams } from "../account-app.js";
import { anthropicFastAccess } from "./coder-host/account-keys.js";

/**
 * The account group's seams over this deployment's real database. The
 * analytics erasure key and project are read from `HostedEnvironment`
 * instead, once with the services rather than at each invocation.
 * `server/account-app.ts` describes the three endpoints; this is the one place
 * that hands them a real user table and a real preferences store, so every
 * `api/account/**` function of the group builds it from the same wiring.
 *
 * The reads and writes themselves are `account-store.ts`'s effects over the
 * ambient `SqlClient`, handed on as the effects they are: the group yields
 * them on the request's own fiber, and the edge that serves the request is
 * the one place the client behind them is provided.
 */

/** This deployment's account group, over its real database and auth session. The analytics erasure key and project are read from `HostedEnvironment`, not here. */
export function accountAppSeams(): AccountAppSeams {
  return {
    resolveUserId: resolveHostedUserId,
    eveOrigin: deploymentEveOrigin,
    standingSessions: (userId) => standingSessionsOf(userId),
    deleteUser: deleteAccount,
    readPreferences: readAccountPreferences,
    anthropicFastAccess,
    writePreferences: writeAccountPreferences,
    readPlanTemplate,
    writePlanTemplate,
    listPlanTemplateRevisions: listTemplateRevisions,
    readPlanTemplateRevision: readTemplateRevision,
    restorePlanTemplate,
  };
}
