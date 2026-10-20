/**
 * live-procedures.ts -- the reads the desktop follows over Neon Realtime, sealed for the account the bearer names.
 *
 * `GET /api/live/inbox` answers what waits on the developer across the
 * account as sealed statements, one per part of the account inbox's answer,
 * and the address to subscribe at (`live-wire.ts`). It is Neon's "Exposing
 * an endpoint" step: the caller is resolved first, on the resource's
 * implementer, each statement is built with that account's id in it, as its
 * held read's is, and sealed, so a subscription reads that account's rows
 * and no other's, and stays bound to the same rule of who may read them as
 * the rows change. A deployment whose Realtime is misconfigured answers
 * `unavailable`, and the desktop asks again a moment later. Nothing here
 * reads a row: the store is read by Realtime.
 */

import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountInboxLiveStatements } from "../inbox/inbox-store.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { LiveSealing } from "./realtime.js";

export interface LiveProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The live reads, each to a signed-in caller. */
export function liveProcedures(seams: LiveProcedureSeams) {
  const signedIn = hosted.live.use(accountMiddleware(seams.resolveUserId));
  return {
    inbox: signedIn.inbox.effect(function* ({ context }) {
      const sealing = yield* LiveSealing;
      const statements = Option.zipWith(
        accountInboxLiveStatements(context.userId),
        ownFailedRunsLiveStatement(context.userId),
        (parts, failedRuns) => ({ ...parts, failedRuns }),
      );
      if (Option.isNone(sealing) || Option.isNone(statements)) {
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      const { seal, url } = sealing.value;
      const queries = yield* Effect.all({
        items: seal(statements.value.items),
        planless: seal(statements.value.planless),
        plans: seal(statements.value.plans),
        automations: seal(statements.value.automations),
        failedRuns: seal(statements.value.failedRuns),
        chatAsks: seal(statements.value.chatAsks),
        chatNotices: seal(statements.value.chatNotices),
      }).pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
      return { url, queries };
    }),
  };
}
