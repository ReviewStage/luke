/**
 * admission.ts -- who a call on the member MCP server acts for: the access token the request presents, verified for the resource, and the member and OAuth client it names.
 *
 * The verification is Better Auth's resource client over the auth service
 * itself (`@better-auth/oauth-provider/resource-client`): a token is a JWT
 * the auth service signed, read against the deployment's own key set, which
 * the client fetches from `/api/auth/jwks` and holds five minutes, with its
 * `aud` the resource, its `iss` the auth service, and `vespin:mcp` among its
 * scopes. A refusal is the challenge the client builds (RFC 6750, RFC 9728):
 * a missing or invalid token, the desktop's opaque one among them since it
 * is no JWT, is 401 naming the resource's metadata document; a token without
 * the scope is 403 `insufficient_scope`. A key set that could not be read is
 * the auth service's failure and answers unavailable, never a refused token.
 * Note that a token verified against the key set alone outlives its
 * revocation by up to its life, which is why the resource's access token
 * lives fifteen minutes (`resource.ts`).
 *
 * The member admitted is the token's subject, provided to the tools as the
 * `AdmittedMember` service beside the OAuth client the token was minted
 * to. A token whose subject is the client itself, as a client-credentials
 * grant mints, names no member and is refused: no client of this
 * deployment is granted it, and nothing here acts for a client alone.
 */

import type { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { failureKind } from "@repo/runtime/effect";
import { EXCESS_KEYS } from "@repo/wire";
import { isAPIError } from "better-auth/api";
import { Context, Effect, Option, Result, Schema } from "effect";
import { HOSTED_HTTP_STATUS, jsonResponse } from "../http/http.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";

/** The member a call acts for, and the OAuth client it reached the server through. */
export interface AdmittedMemberValues {
  readonly userId: string;
  readonly clientId: string;
}

/** The admitted member, provided to each tool's effect for the one request it answers. */
export class AdmittedMember extends Context.Service<AdmittedMember, AdmittedMemberValues>()(
  "AdmittedMember",
) {}

/** The auth service as the resource client reads it: `betterAuth`'s own answer, or a test's. */
type ResourceClientAuth = NonNullable<Parameters<typeof oauthProviderResourceClient>[0]>;

/** The resource client's actions over the auth service, as `memberMcpAuth` builds them. */
export type MemberMcpResourceClient = ReturnType<
  ReturnType<typeof oauthProviderResourceClient<ResourceClientAuth>>["getActions"]
>;

/** The claims admission reads of a verified token; the rest, the scopes among them, are the verifier's to check. */
const AdmittedClaimsSchema = Schema.Struct({ sub: Schema.String, client_id: Schema.String });

const readAdmittedClaims = Schema.decodeUnknownOption(AdmittedClaimsSchema, {
  onExcessProperty: EXCESS_KEYS.DROP,
});

/** A refusal the resource client built, answered as it built it: its status, its body, and the `WWW-Authenticate` challenge among its headers. */
function refusalResponse(error: {
  readonly statusCode: number;
  readonly body: object | undefined;
  readonly headers: HeadersInit;
}): Response {
  return new Response(JSON.stringify(error.body ?? {}), {
    status: error.statusCode,
    headers: new Headers([
      ...new Headers(error.headers),
      ["content-type", "application/json"],
      ["cache-control", "no-store"],
    ]),
  });
}

/** The answer where the auth service could not verify: unavailable, as every route answers a failure of it. */
const UNAVAILABLE: Response = jsonResponse(
  HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  HOSTED_REFUSAL.UNAVAILABLE,
);

/** The answer for a verified token that names no member: a plain refusal, since no re-authorization fixes it. */
const NO_MEMBER: Response = jsonResponse(
  HOSTED_HTTP_STATUS.FORBIDDEN,
  HOSTED_REFUSAL.NOT_PERMITTED,
);

/**
 * The member a request's token acts for, or the answer that refuses the
 * request: the client's challenge, unavailable where the key set could not
 * be read, or forbidden where the token names no member.
 */
export function admitMember(
  verify: (request: Request) => Promise<unknown>,
  request: Request,
): Effect.Effect<Result.Result<AdmittedMemberValues, Response>> {
  return Effect.tryPromise(() => verify(request)).pipe(
    Effect.map((payload) => {
      const claims = readAdmittedClaims(payload);
      if (Option.isNone(claims) || claims.value.sub === claims.value.client_id) {
        return Result.fail(NO_MEMBER);
      }
      return Result.succeed({ userId: claims.value.sub, clientId: claims.value.client_id });
    }),
    Effect.catch(({ cause }) =>
      isAPIError(cause)
        ? Effect.succeed(Result.fail(refusalResponse(cause)))
        : Effect.as(
            Effect.logWarning(
              `${PRODUCT_NAME} MCP admission could not verify a token: ${failureKind(cause)}`,
            ),
            Result.fail(UNAVAILABLE),
          ),
    ),
  );
}
