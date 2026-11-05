/**
 * support-access-procedures.ts -- the member's grant of support access, as Settings grants and revokes it.
 *
 * A maintainer may sign in as an account from the web only while its
 * member's grant stands (`auth/support-access.ts`). The member grants it for
 * seven days, or revokes it, ending any such sign-in under way, through the
 * support-access plugin's own endpoints, which take a session, so both run
 * under the session the request carries rather than the account's bearer
 * (`support-access-calls.ts`). The plugin refuses a grant to a support
 * sign-in itself, which answers as not permitted.
 */

import type { MemberFailure } from "@repo/database/models/workspace-seams";
import type { SupportAccessAnswerWire } from "@repo/features/account-wire";
import { Effect } from "effect";
import type { HostedRefusal, SessionUserIdResolver } from "../http/http-effect.js";
import { hosted, sessionMiddleware } from "../orpc/base.js";
import type { SupportAccessCalls } from "./support-access-calls.js";
import { pluginCallOrRefused } from "./workspace-access.js";

export interface SupportAccessProcedureSeams {
  resolveSessionUserId: SessionUserIdResolver;
  /** The session's grant of support access, written through the auth service. */
  supportAccess: SupportAccessCalls;
}

/** The grant as it then stands, or the refusal the caller draws. */
function answered(
  write: Effect.Effect<number | null, MemberFailure>,
): Effect.Effect<SupportAccessAnswerWire, HostedRefusal> {
  return Effect.map(pluginCallOrRefused(write), (supportAccessUntil) => ({ supportAccessUntil }));
}

/** The resource: both writes under the caller's own session. */
export function supportAccessProcedures(seams: SupportAccessProcedureSeams) {
  const inSession = hosted.supportAccess.use(sessionMiddleware(seams.resolveSessionUserId));
  return {
    grant: inSession.grant.effect(function* ({ context }) {
      return yield* answered(seams.supportAccess.grant(context.sessionHeaders));
    }),
    revoke: inSession.revoke.effect(function* ({ context }) {
      return yield* answered(seams.supportAccess.revoke(context.sessionHeaders));
    }),
  };
}
