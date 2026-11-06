import { PROVIDER_KEY_UNREADABLE } from "@repo/database/models/provider-key-seal";
import { spendDictationMeter } from "@repo/database/models/quota";
import { base64Bytes } from "@repo/features/agent-wire";
import { DICTATION_BOUNDS } from "@repo/features/dictation-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { middlewareGen } from "@orpc/experimental-effect";
import { Clock, Effect, type Redacted } from "effect";
import { ownApiKeyOf } from "../accounts/own-api-key.js";
import { HostedEnvironment } from "../environment.js";
import { dictationDurationOf, recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { accountMiddleware, type HostedCaller, type HostedContext, hosted } from "../orpc/base.js";
import { transcribeClip } from "./transcription.js";

const MS_PER_SECOND = 1_000;

export interface DictationProcedureSeams {
  resolveUserId: UserIdResolver;
}

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
  if (key === PROVIDER_KEY_UNREADABLE) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return yield* next({ context: { openAiKey: key } });
});

function clipBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

export function dictationProcedures(seams: DictationProcedureSeams) {
  const dictation = hosted.dictation
    .use(accountMiddleware(seams.resolveUserId))
    .use(openAiKeyMiddleware);
  return {
    transcribe: dictation.transcribe.effect(function* ({ input, context }) {
      const { audio, durationMs, keywords } = input;
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
      yield* recordServerEvent(
        SERVER_EVENT.DICTATION_USE,
        { userId: context.userId },
        { duration: dictationDurationOf(durationMs) },
      );
      return { text: transcribed.text };
    }),
  };
}
