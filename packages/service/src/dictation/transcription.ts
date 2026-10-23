import { DICTATION_AUDIO_TYPE } from "@luke/features/dictation-wire";
import { readEither } from "@luke/wire/effect";
import { Data, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_OPENAI_DEFAULTS } from "../providers/openai.js";

/**
 * transcription.ts -- one dictated clip turned into its words by OpenAI's transcription model, on the caller's own OpenAI API key.
 *
 * One multipart POST to `/audio/transcriptions` with the clip, the model,
 * and the words the clip is likely to say as `keywords`, which is how the
 * model is told to spell "pnpm" rather than hear "P N P M"
 * (https://developers.openai.com/api/docs/guides/speech-to-text). The key
 * is revealed into the bearer header alone. Nothing of the exchange is
 * logged here, since the request is the developer's voice and the answer
 * their words; a failure carries the status OpenAI answered and nothing it
 * said.
 */

const TRANSCRIPTION = {
  /** The model OpenAI recommends for recorded speech in its own language. */
  MODEL: "gpt-transcribe",
  PATH: "/audio/transcriptions",
  /** The name the clip is sent under, whose extension is how the endpoint knows the container. */
  FILE_NAME: "dictation.webm",
} as const;

/**
 * How long the model is given for a clip of up to two minutes before the clip
 * is answered as failed: inside the desktop's own wait for the route, so the
 * route answers why before the desktop stops listening.
 */
const TRANSCRIPTION_TIMEOUT = Duration.seconds(25);

/** The usage kind an answer reports where the model bills by the audio's length. */
const USAGE_TYPE_DURATION = "duration";

/**
 * The parts of an answer read here: the text, and the usage where the model
 * reports one. The model names more (the languages it heard), which is
 * dropped unread.
 */
const TranscriptionAnswerSchema = Schema.Struct({
  text: Schema.String,
  usage: Schema.optionalKey(
    Schema.Struct({
      type: Schema.String,
      seconds: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
  ),
});

/** What a clip came to: its words, and the seconds the model billed where it said. */
export interface Transcribed {
  readonly text: string;
  readonly billedSeconds: number | undefined;
}

/** The clip was not transcribed: refused with a status, unanswered, or answered with no text. */
export class TranscriptionFailed extends Data.TaggedError("TranscriptionFailed")<{
  readonly status: number | undefined;
}> {}

function transcriptionRequest(input: {
  readonly key: Redacted.Redacted;
  readonly audio: Uint8Array<ArrayBuffer>;
  readonly keywords: readonly string[];
}): HttpClientRequest.HttpClientRequest {
  const form = new FormData();
  form.append("model", TRANSCRIPTION.MODEL);
  form.append(
    "file",
    new Blob([input.audio], { type: DICTATION_AUDIO_TYPE }),
    TRANSCRIPTION.FILE_NAME,
  );
  for (const keyword of input.keywords) form.append("keywords[]", keyword);
  return HttpClientRequest.post(`${HOSTED_OPENAI_DEFAULTS.BASE_URL}${TRANSCRIPTION.PATH}`).pipe(
    HttpClientRequest.bearerToken(Redacted.value(input.key)),
    HttpClientRequest.bodyFormData(form),
  );
}

/** What the model answered: its status, and its body where it answered with words; a refusal's body is never read. */
interface ModelReply {
  readonly status: number;
  readonly body: UnparsedWireValue;
}

function replyOf(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<ModelReply, HttpClientError.HttpClientError> {
  if (response.status !== HOSTED_HTTP_STATUS.OK) {
    return Effect.succeed({ status: response.status, body: unparsedWire(undefined) });
  }
  return Effect.map(response.json, (body) => ({
    status: response.status,
    body: unparsedWire(body),
  }));
}

/** Transcribes one clip over the ambient client; a failure carries a status at most. */
export const transcribeClip = /* @__PURE__ */ Effect.fnUntraced(function* (input: {
  readonly key: Redacted.Redacted;
  readonly audio: Uint8Array<ArrayBuffer>;
  readonly keywords: readonly string[];
}): Effect.fn.Return<Transcribed, TranscriptionFailed, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  // A request that failed or timed out is no answer, and its cause is dropped unread.
  const answered = yield* client.execute(transcriptionRequest(input)).pipe(
    Effect.flatMap((response) => replyOf(response)),
    Effect.scoped,
    Effect.timeout(TRANSCRIPTION_TIMEOUT),
    Effect.option,
  );
  if (Option.isNone(answered)) return yield* new TranscriptionFailed({ status: undefined });
  const { status, body } = answered.value;
  const read = readEither(TranscriptionAnswerSchema, { excess: EXCESS_KEYS.DROP })(body);
  if (Result.isFailure(read)) return yield* new TranscriptionFailed({ status });
  const { text, usage } = read.success;
  const billedSeconds = usage?.type === USAGE_TYPE_DURATION ? usage.seconds : undefined;
  return { text: text.trim(), billedSeconds };
});
