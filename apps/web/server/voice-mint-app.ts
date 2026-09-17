import { Effect, Layer, Option } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { HOSTED_SERVICE_PATH, realtimeClientSecretRequest } from "./core.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import {
  hostedKey,
  MINT_METHOD,
  type MintSeams,
  mintedConnection,
  mintOptions,
  mintPreferences,
  quotaExhausted,
  refuseMint,
  refusingMint,
} from "./hosted/mint-effect.js";
import type { HostedSpend, QuotaEffect } from "./hosted/quota.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * The signed-in Realtime mint as the one route group its function serves: the
 * installed desktop's, for the desktops of earlier releases that still ask
 * for it. It mints one short-lived credential on the key this deployment
 * holds, from a session document the build composes: the caller's whole say
 * is a voice and a pace, each validated against the sets the build ships, so
 * nothing a caller sends can reshape what the credential is for. The audio
 * never transits this deployment; only the mint does. The phone's and the
 * watch's mint stood beside it until each moved onto the hosted exchange
 * (LUKE-216, LUKE-224) and LUKE-219 deleted it.
 *
 * The accountless introduction's mint is a group of its own next door: it
 * carries no bearer and spends a different meter.
 *
 * The path is declared for every method, because the POST the mint documents
 * is its own `method-not-allowed` rather than a path the group does not have.
 */

/** What the group is handed that the deployment alone can answer for. */
export interface VoiceMintSeams extends MintSeams {
  resolveUserId: UserIdResolver<string | undefined>;
  spend: (userId: string) => QuotaEffect<HostedSpend>;
}

/** The signed-in caller behind the request's bearer, or the refusal that says there is none. */
const signedIn = /* @__PURE__ */ Effect.fnUntraced(function* (seams: VoiceMintSeams) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const account = yield* seams.resolveUserId(request.headers.authorization);
  return Option.isSome(account) ? account.value : yield* refuseMint(HOSTED_REFUSAL.INVALID_TOKEN);
});

/** POST: the signed-in desktop's own credential, spent against its daily allowance. */
const voiceMint = /* @__PURE__ */ Effect.fn("voiceMint")(function* (seams: VoiceMintSeams) {
  yield* refusingMint(hostedMethod(MINT_METHOD));
  const apiKey = yield* hostedKey();
  const environment = yield* HostedEnvironment;
  const userId = yield* signedIn(seams);
  const read = yield* mintPreferences();
  const spend = yield* refusingMint(hostedStoreOrUnavailable(seams.spend(userId)));
  if (!spend.allowed) return yield* Effect.fail(quotaExhausted(spend));
  const connection = yield* mintedConnection(
    mintOptions(seams, apiKey, environment.realtimeModel, read, realtimeClientSecretRequest),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { connection, quota: spend.quota });
});

/** The group, which is the signed-in mint and the refusal anywhere else. */
export function voiceMintApp(
  seams: VoiceMintSeams,
): WebRoutes<HostedEnvironment | HttpClient.HttpClient | SqlClient.SqlClient> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.VOICE_MINT,
      Effect.catch(voiceMint(seams), Effect.succeed),
    ),
    hostedNotFoundRoute,
  );
}
