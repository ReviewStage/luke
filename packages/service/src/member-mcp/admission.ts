import type { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { failureKind } from "@repo/runtime/effect";
import { EXCESS_KEYS } from "@repo/wire";
import { isAPIError } from "better-auth/api";
import { Context, Effect, Option, Result, Schema } from "effect";
import { HOSTED_HTTP_STATUS, jsonResponse } from "../http/http.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";

export interface AdmittedMemberValues {
  readonly userId: string;
  readonly clientId: string;
}

export class AdmittedMember extends Context.Service<AdmittedMember, AdmittedMemberValues>()(
  "AdmittedMember",
) {}

type ResourceClientAuth = NonNullable<Parameters<typeof oauthProviderResourceClient>[0]>;

export type MemberMcpResourceClient = ReturnType<
  ReturnType<typeof oauthProviderResourceClient<ResourceClientAuth>>["getActions"]
>;

const AdmittedClaimsSchema = Schema.Struct({ sub: Schema.String, client_id: Schema.String });

const readAdmittedClaims = Schema.decodeUnknownOption(AdmittedClaimsSchema, {
  onExcessProperty: EXCESS_KEYS.DROP,
});

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

const UNAVAILABLE: Response = jsonResponse(
  HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  HOSTED_REFUSAL.UNAVAILABLE,
);

const NO_MEMBER: Response = jsonResponse(
  HOSTED_HTTP_STATUS.FORBIDDEN,
  HOSTED_REFUSAL.NOT_PERMITTED,
);

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
