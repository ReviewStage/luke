import { type HttpApp, HttpRouter, HttpServerRequest } from "@effect/platform";
import { Effect, Redacted } from "effect";
import {
  type CloudFetch,
  HOSTED_SERVICE_PATH,
  type ObservedSession,
  realtimeClientSecretRequest,
  remoteRealtimeClientSecretRequest,
} from "./core.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  hostedJsonResponse,
  hostedMethod,
  hostedRefusalResponse,
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
import type { HostedSpend } from "./hosted/quota.js";
import {
  MOBILE_MINT_STRICT_FIELDS,
  observeCloudSessions,
  type RemoteObserveSeams,
  remoteSessionContextItem,
} from "./hosted/remote-voice-mint.js";

/**
 * The two signed-in Realtime mints as the one route group their functions
 * serve: the desktop's, and the phone's — which also carries the roster it
 * was shown. Each mints one short-lived credential on the key this deployment
 * holds, from a session document the build composes: the caller's whole say
 * is a voice and a pace, each validated against the sets the build ships, so
 * nothing a caller sends can reshape what the credential is for. The audio
 * never transits this deployment; only the mint does.
 *
 * The accountless introduction's mint is a group of its own next door: it
 * carries no bearer, spends a different meter, and would otherwise take the
 * phone's whole cloud-observe graph into a function that never runs a pass.
 *
 * Both paths are declared for every method, because the POST each mint
 * documents is its own `method-not-allowed` rather than a path the group
 * does not have.
 */

/** What the group is handed that the deployment alone can answer for. */
export interface VoiceMintSeams extends MintSeams, Omit<RemoteObserveSeams, "encryptionSecret"> {
  resolveUserId: (authorization: string | undefined) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: CloudFetch | undefined;
}

/**
 * The roster read is capped well inside the 60-second life of the credential
 * it rides beside, and answers an empty roster rather than a refusal when it
 * runs long: a mint whose roster could not be read is still a mint.
 */
const OBSERVE_TIMEOUT_MS = 30_000;

/** The vault secret as the roster read takes it, which is a string or nothing at all. */
function revealed(secret: Redacted.Redacted | undefined): string | undefined {
  return secret === undefined ? undefined : Redacted.value(secret);
}

/** The signed-in caller behind the request's bearer, or the refusal that says there is none. */
function signedIn(seams: VoiceMintSeams) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const userId = yield* Effect.promise(() => seams.resolveUserId(request.headers.authorization));
    return userId ? userId : yield* refuseMint(HOSTED_REFUSAL.INVALID_TOKEN);
  });
}

/** POST: the signed-in desktop's own credential, spent against its daily allowance. */
function voiceMint(seams: VoiceMintSeams) {
  return Effect.gen(function* () {
    yield* refusingMint(hostedMethod(MINT_METHOD));
    const apiKey = yield* hostedKey();
    const environment = yield* HostedEnvironment;
    const userId = yield* signedIn(seams);
    const read = yield* mintPreferences();
    const spend = yield* Effect.promise(() => seams.spend(userId));
    if (!spend.allowed) return yield* Effect.fail(quotaExhausted(spend));
    const connection = yield* mintedConnection(
      mintOptions(seams, apiKey, environment.realtimeModel, read, realtimeClientSecretRequest),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { connection, quota: spend.quota });
  });
}

/**
 * POST: the signed-in phone's credential and the roster it is to speak about.
 * The two are asked for at once, because neither depends on the other, and a
 * roster that ran long leaves the mint standing.
 */
function remoteVoiceMint(seams: VoiceMintSeams) {
  return Effect.gen(function* () {
    yield* refusingMint(hostedMethod(MINT_METHOD));
    const apiKey = yield* hostedKey();
    const environment = yield* HostedEnvironment;
    const userId = yield* signedIn(seams);
    const read = yield* mintPreferences(MOBILE_MINT_STRICT_FIELDS);
    const spend = yield* Effect.promise(() => seams.spend(userId));
    if (!spend.allowed) return yield* Effect.fail(quotaExhausted(spend));
    const [connection, sessions] = yield* Effect.all(
      [
        mintedConnection(
          mintOptions(
            seams,
            apiKey,
            environment.realtimeModel,
            read,
            remoteRealtimeClientSecretRequest,
          ),
        ),
        roster(seams, revealed(environment.providerKeyEncryptionSecret), userId),
      ],
      { concurrency: 2 },
    );
    const now = seams.now ?? Date.now;
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      connection,
      quota: spend.quota,
      context: { sessions: remoteSessionContextItem(sessions, now()) },
    });
  });
}

function roster(
  seams: VoiceMintSeams,
  encryptionSecret: string | undefined,
  userId: string,
): Effect.Effect<readonly ObservedSession[], never> {
  return Effect.promise(() => observeCloudSessions(userId, { ...seams, encryptionSecret })).pipe(
    Effect.timeout(OBSERVE_TIMEOUT_MS),
    Effect.orElseSucceed((): readonly ObservedSession[] => []),
  );
}

/** The group, which is the two signed-in mints and the refusal anywhere else. */
export function voiceMintApp(seams: VoiceMintSeams): HttpApp.Default<never, HostedEnvironment> {
  return HttpRouter.empty.pipe(
    HttpRouter.all(HOSTED_SERVICE_PATH.VOICE_MINT, Effect.merge(voiceMint(seams))),
    HttpRouter.all(HOSTED_SERVICE_PATH.REMOTE_VOICE_MINT, Effect.merge(remoteVoiceMint(seams))),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}
