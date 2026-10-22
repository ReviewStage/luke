/**
 * dictation-procedures.ts -- a clip the developer dictated into a message box, answered with its words.
 *
 * `POST /api/dictation` takes one clip (`@luke/features/dictation-wire`),
 * holds it to two minutes and a megabyte, hands it to OpenAI's transcription
 * model on the caller's own OpenAI API key (`../accounts/own-api-key.ts`),
 * never Luke's, with the words the desktop says it is likely to hold
 * (`dictation/transcription.ts`), and answers the text. Nothing of the clip or
 * the text is stored, logged, traced, or counted as an event: the clip lives
 * in this request's memory and goes when it ends.
 *
 * What is kept is the meter: one call and the clip's seconds on the
 * account's day (`@luke/database/models/quota`), the seconds OpenAI billed where it says
 * and the desktop's own timing otherwise, which the bound above holds to two
 * minutes. A meter the database refused is logged and the text still
 * answered, since the transcription was had and paid for. An account that
 * saved no OpenAI API key is refused as missing one, which the desktop
 * answers by pointing at Settings; a model that did not answer answers
 * unavailable, which the desktop shows and the developer may try again. The
 * key is looked for before the clip is read.
 */

import { spendDictationMeter } from "@luke/database/models/quota";
import { base64Bytes } from "@luke/features/coding-agent-wire";
import { DICTATION_BOUNDS } from "@luke/features/dictation-wire";
import { PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { middlewareGen } from "@orpc/experimental-effect";
import { Clock, Effect, type Redacted } from "effect";
import { ownApiKeyOf } from "../accounts/own-api-key.js";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { accountMiddleware, type HostedCaller, type HostedContext, hosted } from "../orpc/base.js";
import { transcribeClip } from "./transcription.js";

const MS_PER_SECOND = 1_000;

export interface DictationProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The caller's own OpenAI API key, or refused as missing where it saved none; unavailable where the store did not answer. */
const openAiKeyMiddleware = middlewareGen<
  HostedContext & HostedCaller,
  { readonly openAiKey: Redacted.Redacted<string> }
>(function* ({ context, next }) {
  const { providerKeyEncryptionKeys } = yield* HostedEnvironment;
  const key = yield* ownApiKeyOf(
    context.userId,
    PROVIDER_KEY_PROVIDER.OPENAI,
    providerKeyEncryptionKeys,
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  if (key === undefined) return yield* Effect.fail(HOSTED_REFUSAL.OPENAI_KEY_MISSING);
  return yield* next({ context: { openAiKey: key } });
});

/** The clip's bytes out of their base64, whose spelling the wire already held to the alphabet. */
function clipBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/** The dictation resource: one clip's words, to a signed-in caller. */
export function dictationProcedures(seams: DictationProcedureSeams) {
  const dictation = hosted.dictation
    .use(accountMiddleware(seams.resolveUserId))
    .use(openAiKeyMiddleware);
  return {
    transcribe: dictation.transcribe.effect(function* ({ input, context }) {
      const { audio, durationMs, keywords } = input;
      // Note that both bounds answer too large, because either is the clip being longer than a message.
      if (
        durationMs > DICTATION_BOUNDS.MAX_DURATION_MS ||
        base64Bytes(audio) > DICTATION_BOUNDS.MAX_AUDIO_BYTES
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.REQUEST_TOO_LARGE);
      }
      const transcribed = yield* transcribeClip({
        key: context.openAiKey,
        audio: clipBytes(audio),
        keywords,
      }).pipe(
        Effect.tapError((failed) =>
          Effect.logWarning(`The transcription failed with status ${failed.status ?? "none"}`),
        ),
        Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
      );
      const seconds = transcribed.billedSeconds ?? durationMs / MS_PER_SECOND;
      const now = yield* Clock.currentTimeMillis;
      yield* spendDictationMeter({ userId: context.userId, seconds, now }).pipe(
        Effect.catch(logStoreFailure),
      );
      return { text: transcribed.text };
    }),
  };
}
