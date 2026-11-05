/**
 * support-access-calls.ts -- the member's grant of support access granted and revoked through the support-access plugin's own endpoints, under the session the headers carry.
 *
 * Both endpoints read the session from the headers, which carry the Mac's
 * signed session as a bearer or a browser's cookie, so only that session's
 * own account is granted or revoked (`auth/support-access.ts`). Each answers
 * the grant as it then stands, its end a `Date` or null, which is read here
 * into epoch milliseconds. A refusal is kept by status, as every plugin
 * call's is (`pluginCall`).
 */

import { type MemberFailure, pluginCall } from "@repo/database/models/workspace-seams";
import { Cause, Effect, Schema } from "effect";

/** What either endpoint answers, in the field read here. */
const decodeGrant = Schema.decodeUnknownEffect(
  Schema.Struct({ supportAccessUntil: Schema.NullOr(Schema.Date) }),
);

/** The part of a Better Auth `api` the support-access calls reach. */
export interface SupportAccessApi {
  readonly grantSupportAccess: (input: { headers: Headers }) => Promise<object | null>;
  readonly revokeSupportAccess: (input: { headers: Headers }) => Promise<object | null>;
}

/** One write of the session's grant, answering when it then runs out in epoch milliseconds, or null. */
export type SupportAccessWrite = (headers: Headers) => Effect.Effect<number | null, MemberFailure>;

/** The session's grant written each way. */
export interface SupportAccessCalls {
  readonly grant: SupportAccessWrite;
  readonly revoke: SupportAccessWrite;
}

function written(call: () => Promise<object | null>): Effect.Effect<number | null, MemberFailure> {
  return Effect.gen(function* () {
    const answered = yield* pluginCall(call);
    const grant = yield* Effect.mapError(
      decodeGrant(answered),
      (failure) => new Cause.UnknownError(failure),
    );
    return grant.supportAccessUntil?.getTime() ?? null;
  });
}

/** The grant and the revoke over one auth service: `auth.api` on a deployment. */
export function supportAccessCalls(api: SupportAccessApi): SupportAccessCalls {
  return {
    grant: (headers) => written(() => api.grantSupportAccess({ headers })),
    revoke: (headers) => written(() => api.revokeSupportAccess({ headers })),
  };
}
