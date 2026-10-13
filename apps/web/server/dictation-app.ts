import type { DatabaseServices } from "@sidecar/database/core/query";
import { spendDictationMeter } from "@sidecar/database/models/quota";
import { base64Bytes, base64Chars } from "@sidecar/hosted/coding-agent-wire";
import {
  DICTATION_BOUNDS,
  type DictationAnswer,
  dictationRequestSchema,
} from "@sidecar/hosted/dictation-wire";
import { readEither } from "@sidecar/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { HostedEnvironment } from "./hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusing,
  readJsonBodyEffect,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { logStoreFailure } from "./hosted/store-failure.js";
import { transcribeClip } from "./hosted/transcription.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * dictation-app.ts -- a clip the developer dictated into a message box, answered with its words.
 *
 * `POST /api/dictation` takes one clip (`@sidecar/hosted/dictation-wire`),
 * holds it to two minutes and a megabyte, hands it to OpenAI's transcription
 * model on Luke's key with the words the desktop says it is likely to hold
 * (`hosted/transcription.ts`), and answers the text. Nothing of the clip or
 * the text is stored, logged, traced, or counted as an event: the clip lives
 * in this request's memory and goes when it ends.
 *
 * What is kept is the meter: one call and the clip's seconds on the
 * account's day (`@sidecar/database/models/quota`), the seconds OpenAI billed where it says
 * and the desktop's own timing otherwise, which the bound above holds to two
 * minutes. A meter the database refused is logged and the text still
 * answered, since the transcription was had and paid for. A deployment
 * without an OpenAI key, and a model that did not answer, answer
 * unavailable, which the desktop shows and the developer may try again.
 */

const DICTATION_PATH = "/api/dictation";

const HTTP_METHOD = { POST: "POST" } as const;

/** Room for the words and the JSON around the clip: fifty words of a hundred characters, each escaped six bytes to a character, fit with room to spare. */
const ENVELOPE_BYTES = 64 * 1_024;

/** A body is a clip in base64 and its words, each held to its bound, so one past this is not one. */
const MAXIMUM_BODY_BYTES = base64Chars(DICTATION_BOUNDS.MAX_AUDIO_BYTES) + ENVELOPE_BYTES;

const MS_PER_SECOND = 1_000;

export interface DictationAppSeams {
  resolveUserId: UserIdResolver;
}

type DictationRequirements =
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | HostedEnvironment
  | HttpClient.HttpClient;

/** The clip's bytes out of their base64, whose spelling the wire already held to the alphabet. */
function clipBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

const dictationEndpoint = /* @__PURE__ */ Effect.fn("web/dictationEndpoint")(function* (
  seams: DictationAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, DictationRequirements> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const key = (yield* HostedEnvironment).openAiKey;
  if (key === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);

  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(dictationRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { audio, durationMs, keywords } = asked.success;
  // Note that both bounds answer too large, because either is the clip being longer than a message.
  if (
    durationMs > DICTATION_BOUNDS.MAX_DURATION_MS ||
    base64Bytes(audio) > DICTATION_BOUNDS.MAX_AUDIO_BYTES
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.REQUEST_TOO_LARGE);
  }

  const transcribed = yield* transcribeClip({ key, audio: clipBytes(audio), keywords }).pipe(
    Effect.tapError((failed) =>
      Effect.logWarning(`The transcription failed with status ${failed.status ?? "none"}`),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  const seconds = transcribed.billedSeconds ?? durationMs / MS_PER_SECOND;
  const now = yield* Clock.currentTimeMillis;
  yield* spendDictationMeter({ userId: account.value, seconds, now }).pipe(
    Effect.catch(logStoreFailure),
  );
  const answer: DictationAnswer = { text: transcribed.text };
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/** The group: the one dictation path, and the hosted vocabulary's own refusal for any other. */
export function dictationApp(
  seams: DictationAppSeams,
): WebRoutes<DatabaseServices | HostedEnvironment | HttpClient.HttpClient> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, DICTATION_PATH, hostedRefusing(dictationEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
