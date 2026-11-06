import { type MemberFailure, pluginCall } from "@repo/database/models/workspace-seams";
import { Cause, Effect, Schema } from "effect";

const decodeGrant = Schema.decodeUnknownEffect(
  Schema.Struct({ supportAccessUntil: Schema.NullOr(Schema.Date) }),
);

export interface SupportAccessApi {
  readonly grantSupportAccess: (input: { headers: Headers }) => Promise<object | null>;
  readonly revokeSupportAccess: (input: { headers: Headers }) => Promise<object | null>;
}

export type SupportAccessWrite = (headers: Headers) => Effect.Effect<number | null, MemberFailure>;

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

export function supportAccessCalls(api: SupportAccessApi): SupportAccessCalls {
  return {
    grant: (headers) => written(() => api.grantSupportAccess({ headers })),
    revoke: (headers) => written(() => api.revokeSupportAccess({ headers })),
  };
}
