import { type HttpApp, type HttpClient, HttpRouter } from "@effect/platform";
import { Effect } from "effect";
import { HOSTED_SERVICE_PATH } from "./core.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  hostedJsonResponse,
  hostedMethod,
  hostedRefusalResponse,
} from "./hosted/http-effect.js";
import {
  INTRODUCTION_MINT_FIELDS,
  introductionClientSecretRequest,
} from "./hosted/introduction-mint.js";
import {
  hostedKey,
  MINT_METHOD,
  type MintSeams,
  mintedConnection,
  mintOptions,
  mintPreferences,
  refusingMint,
} from "./hosted/mint-effect.js";
import type { IntroductionSpend } from "./hosted/quota.js";

/**
 * The accountless introduction's mint as its own route group. It stands apart
 * from the signed-in mints deliberately: it resolves no bearer, spends the
 * deployment's own shared daily ceiling rather than an account's allowance,
 * and takes none of the phone mint's cloud-observe graph into the one
 * function a first run reaches before anything else.
 */

export interface IntroductionMintSeams extends MintSeams {
  spendIntroduction: () => Promise<IntroductionSpend>;
}

/**
 * POST: the one credential a fresh install may ask for before any account
 * exists. The body is read before the meter, so a malformed request is
 * refused before it spends, and the refusal carries no quota: the
 * introduction is not an allowance the desktop tracks, only a cap it may run
 * into.
 */
function introductionMint(seams: IntroductionMintSeams) {
  return Effect.gen(function* () {
    yield* refusingMint(hostedMethod(MINT_METHOD));
    const apiKey = yield* hostedKey();
    const environment = yield* HostedEnvironment;
    const read = yield* mintPreferences(INTRODUCTION_MINT_FIELDS);
    const spend = yield* Effect.promise(() => seams.spendIntroduction());
    if (!spend.allowed) {
      return yield* Effect.fail(
        hostedJsonResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, {
          error: HOSTED_API_ERROR.QUOTA_EXHAUSTED,
        }),
      );
    }
    const connection = yield* mintedConnection(
      mintOptions(seams, apiKey, environment.realtimeModel, read, introductionClientSecretRequest),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { connection });
  });
}

/** The group, which is the introduction's own mint and the refusal anywhere else. */
export function introductionMintApp(
  seams: IntroductionMintSeams,
): HttpApp.Default<never, HostedEnvironment | HttpClient.HttpClient> {
  return HttpRouter.empty.pipe(
    HttpRouter.all(HOSTED_SERVICE_PATH.INTRODUCTION_MINT, Effect.merge(introductionMint(seams))),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}
