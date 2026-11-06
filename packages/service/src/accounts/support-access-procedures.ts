import type { MemberFailure } from "@repo/database/models/workspace-seams";
import type { SupportAccessAnswerWire } from "@repo/features/account-wire";
import { Effect } from "effect";
import type { HostedRefusal, SessionUserIdResolver } from "../http/http-effect.js";
import { hosted, sessionMiddleware } from "../orpc/base.js";
import type { SupportAccessCalls } from "./support-access-calls.js";
import { pluginCallOrRefused } from "./workspace-access.js";

export interface SupportAccessProcedureSeams {
  resolveSessionUserId: SessionUserIdResolver;
  supportAccess: SupportAccessCalls;
}

function answered(
  write: Effect.Effect<number | null, MemberFailure>,
): Effect.Effect<SupportAccessAnswerWire, HostedRefusal> {
  return Effect.map(pluginCallOrRefused(write), (supportAccessUntil) => ({ supportAccessUntil }));
}

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
