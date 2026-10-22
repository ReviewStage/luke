/**
 * dictation-procedures.ts -- a clip the developer dictated into a message box, answered with its words.
 *
 * `POST /api/dictation` takes one clip (`@luke/features/dictation-wire`),
 * holds it to two minutes and a megabyte, hands it to OpenAI's transcription
 * model on Luke's key with the words the desktop says it is likely to hold
 * (`dictation/transcription.ts`), and answers the text. Nothing of the clip or
 * the text is stored, logged, traced, or counted as an event: the clip lives
 * in this request's memory and goes when it ends.
 *
 * What is kept is the meter: one call and the clip's seconds on the
 * account's day (`@luke/database/models/quota`), the seconds OpenAI billed where it says
 * and the desktop's own timing otherwise, which the bound above holds to two
 * minutes. A meter the database refused is logged and the text still
 * answered, since the transcription was had and paid for. A deployment
 * without an OpenAI key, and a model that did not answer, answer
 * unavailable, which the desktop shows and the developer may try again; the
 * key is looked for before the clip is read, as the old route did.
 */

import { spendDictationMeter } from "@luke/database/models/quota";
import { base64Bytes } from "@luke/features/coding-agent-wire";
import { DICTATION_BOUNDS } from "@luke/features/dictation-wire";
import { middlewareGen } from "@orpc/experimental-effect";
import { Clock, Effect, type Redacted } from "effect";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { accountMiddleware, type HostedContext, hosted } from "../orpc/base.js";
import { transcribeClip } from "./transcription.js";

const MS_PER_SECOND = 1_000;

export interface DictationProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The deployment's OpenAI key, or unavailable where it holds none. */
const openAiKeyMiddleware = middlewareGen<
  HostedContext,
  { readonly openAiKey: Redacted.Redacted<string> }
>(function* ({ next }) {
  const key = (yield* HostedEnvironment).openAiKey;
  if (key === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
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
