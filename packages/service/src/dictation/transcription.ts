import { DICTATION_AUDIO_TYPE } from "@repo/features/dictation-wire";
import { readEither } from "@repo/wire/effect";
import { Data, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_OPENAI_DEFAULTS } from "../providers/openai.js";

const TRANSCRIPTION = {
  MODEL: "gpt-transcribe",
  PATH: "/audio/transcriptions",
  FILE_NAME: "dictation.webm",
} as const;

const TRANSCRIPTION_TIMEOUT = Duration.seconds(25);

const USAGE_TYPE_DURATION = "duration";

const TranscriptionAnswerSchema = Schema.Struct({
  text: Schema.String,
  usage: Schema.optionalKey(
    Schema.Struct({
      type: Schema.String,
      seconds: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
  ),
});

export interface Transcribed {
  readonly text: string;
  readonly billedSeconds: number | undefined;
}

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

export const transcribeClip = /* @__PURE__ */ Effect.fnUntraced(function* (input: {
  readonly key: Redacted.Redacted;
  readonly audio: Uint8Array<ArrayBuffer>;
  readonly keywords: readonly string[];
}): Effect.fn.Return<Transcribed, TranscriptionFailed, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
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
