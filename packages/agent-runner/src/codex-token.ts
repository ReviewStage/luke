import { Data, Duration, Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { RUNNER_ENV, RunnerTokenAnswerSchema } from "./protocol.js";

const ASK_TIMEOUT = Duration.seconds(20);

const HTTP_OK = 200;

const decodeAnswer = Schema.decodeUnknownOption(RunnerTokenAnswerSchema);

class CodexTokenFailed extends Data.TaggedError("CodexTokenFailed")<{
  readonly detail: string;
}> {}

export const codexToken = Effect.fn("agent-runner/codexToken")(function* (
  url: string,
  env: Readonly<Record<string, string | undefined>>,
) {
  const placeholder = env[RUNNER_ENV.CODEX_TOKEN];
  if (placeholder !== undefined && placeholder !== "") return placeholder;
  const bearer = env[RUNNER_ENV.BEARER];
  if (bearer === undefined || bearer === "") {
    return yield* new CodexTokenFailed({ detail: `${RUNNER_ENV.BEARER} is not set` });
  }
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(HttpClientRequest.post(url).pipe(HttpClientRequest.bearerToken(bearer)))
    .pipe(
      Effect.timeout(ASK_TIMEOUT),
      Effect.mapError(() => new CodexTokenFailed({ detail: "The service did not answer" })),
    );
  if (response.status !== HTTP_OK) {
    return yield* new CodexTokenFailed({
      detail: `The service refused the token: ${response.status}`,
    });
  }
  const body = yield* response.json.pipe(
    Effect.mapError(() => new CodexTokenFailed({ detail: "The service's answer is not JSON" })),
  );
  const answer = decodeAnswer(body);
  if (Option.isNone(answer) || answer.value.accessToken === "") {
    return yield* new CodexTokenFailed({ detail: "The service's answer holds no token" });
  }
  return answer.value.accessToken;
});
