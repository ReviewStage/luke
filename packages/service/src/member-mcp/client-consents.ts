import { type MemberFailure, pluginCall } from "@repo/database/models/workspace-seams";
import { Cause, Effect, Schema } from "effect";

const decodeConsents = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ id: Schema.String, clientId: Schema.String })),
);

export interface ClientConsentApi {
  readonly getOAuthConsents: (input: { headers: Headers }) => Promise<object | null>;
  readonly deleteOAuthConsent: (input: {
    headers: Headers;
    body: { id: string };
  }) => Promise<unknown>;
}

export type ClientConsentDelete = (
  headers: Headers,
  clientId: string,
) => Effect.Effect<void, MemberFailure>;

export function clientConsentDelete(api: ClientConsentApi): ClientConsentDelete {
  return (headers, clientId) =>
    Effect.gen(function* () {
      const listed = yield* pluginCall(() => api.getOAuthConsents({ headers }));
      const consents = yield* Effect.mapError(
        decodeConsents(listed),
        (failure) => new Cause.UnknownError(failure),
      );
      for (const consent of consents.filter((each) => each.clientId === clientId)) {
        yield* pluginCall(async () => {
          await api.deleteOAuthConsent({ headers, body: { id: consent.id } });
          return null;
        });
      }
    });
}
