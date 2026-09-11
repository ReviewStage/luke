import { HttpServerRequest, type HttpServerResponse } from "@effect/platform";
import { Effect, Redacted } from "effect";
import type { CloudFetch, RealtimeConnection } from "../core.js";
import { HostedEnvironment } from "./environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedRefusalResponse,
  hostedUpstreamErrorResponse,
} from "./http-effect.js";
import type { HostedSpend } from "./quota.js";
import {
  mintRealtimeConnection,
  type RealtimeConnectionMintOptions,
  type VoiceMintPreferences,
  voiceMintPreferences,
} from "./voice-mint.js";

/**
 * What every Realtime mint does the same way, whichever group serves it: the
 * key this deployment holds, the caller's voice and pace, the upstream mint,
 * and the refusals each of those answers with. A refusal is failed with
 * rather than returned, so a mint reads as the early returns it is, and the
 * group merges the two channels back into the one answer it hands the
 * platform.
 */

/** What a mint needs of the deployment beyond the environment's own key. */
export interface MintSeams {
  fetch?: CloudFetch | undefined;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
}

export const MINT_METHOD = "POST";

export type MintAnswer = HttpServerResponse.HttpServerResponse;

export function refuseMint(refusal: HostedRefusal): Effect.Effect<never, MintAnswer> {
  return Effect.fail(hostedRefusalResponse(refusal));
}

export function refusingMint<A, R>(
  effect: Effect.Effect<A, HostedRefusal, R>,
): Effect.Effect<A, MintAnswer, R> {
  return Effect.mapError(effect, hostedRefusalResponse);
}

/** The key this deployment holds, or the refusal that says the tier is off. */
export function hostedKey(): Effect.Effect<string, MintAnswer, HostedEnvironment> {
  return Effect.flatMap(HostedEnvironment, (environment) =>
    environment.openAiKey === undefined
      ? refuseMint(HOSTED_REFUSAL.UNAVAILABLE)
      : Effect.succeed(Redacted.value(environment.openAiKey)),
  );
}

/**
 * The caller's voice and pace, read from the body it sent. A body that cannot
 * be read at all and one that names something outside the build's sets are
 * the same refusal, and neither has spent anything.
 */
export function mintPreferences(
  strictFields?: readonly string[],
): Effect.Effect<VoiceMintPreferences, MintAnswer, HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const raw = yield* Effect.orElseSucceed(request.text, () => undefined);
    const read = raw === undefined ? undefined : voiceMintPreferences(raw, strictFields);
    return read ?? (yield* refuseMint(HOSTED_REFUSAL.INVALID_REQUEST));
  });
}

/** The upstream mint, with the refusal it answers with in the hosted vocabulary. */
export function mintedConnection(
  options: RealtimeConnectionMintOptions,
): Effect.Effect<RealtimeConnection, MintAnswer> {
  return Effect.flatMap(
    Effect.promise(() => mintRealtimeConnection(options)),
    (answer) =>
      "failure" in answer
        ? Effect.fail(hostedUpstreamErrorResponse(answer.failure.upstreamStatus))
        : Effect.succeed(answer.connection),
  );
}

export function mintOptions(
  seams: MintSeams,
  apiKey: string,
  model: string | undefined,
  read: VoiceMintPreferences,
  clientSecretRequest: RealtimeConnectionMintOptions["clientSecretRequest"],
): RealtimeConnectionMintOptions {
  return {
    apiKey,
    model,
    preferences: read,
    clientSecretRequest,
    fetch: seams.fetch,
    now: seams.now,
    timeoutMs: seams.timeoutMs,
  };
}

/** A day's allowance spent, which the signed-in mints answer with the quota itself. */
export function quotaExhausted(spend: HostedSpend): MintAnswer {
  return hostedJsonResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, {
    error: HOSTED_API_ERROR.QUOTA_EXHAUSTED,
    quota: spend.quota,
  });
}
