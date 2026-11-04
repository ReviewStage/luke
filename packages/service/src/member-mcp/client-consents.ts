/**
 * client-consents.ts -- a member's Allow of one OAuth client deleted through the OAuth provider's own consent endpoints, under the session the headers carry.
 *
 * The provider deletes a consent by its own row's id, which `get-consents`
 * answers for the session's member, so the session's consents for the
 * client are found there first and each handed to `delete-consent`
 * (`@better-auth/oauth-provider`'s `getOAuthConsents` and
 * `deleteOAuthConsent`). Both read the session from the headers, which
 * carry the Mac's signed session as a bearer or a browser's cookie, and
 * the delete refuses a consent that is not the session's member's, so only
 * that member's Allow can go. None standing is already deleted.
 */

import { type MemberFailure, pluginCall } from "@repo/database/models/workspace-seams";
import { Cause, Effect, Schema } from "effect";

/** The consents `get-consents` answers, in the fields read here. */
const decodeConsents = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ id: Schema.String, clientId: Schema.String })),
);

/** The part of a Better Auth `api` the delete calls. */
export interface ClientConsentApi {
  readonly getOAuthConsents: (input: { headers: Headers }) => Promise<object | null>;
  readonly deleteOAuthConsent: (input: {
    headers: Headers;
    body: { id: string };
  }) => Promise<unknown>;
}

/** Deletes the Allow the session's member gave one client; a refusal kept by status, anything else unknown. */
export type ClientConsentDelete = (
  headers: Headers,
  clientId: string,
) => Effect.Effect<void, MemberFailure>;

/** The delete over one auth service: `auth.api` on a deployment. */
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
