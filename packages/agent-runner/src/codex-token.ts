/**
 * codex-token.ts -- the runner as Codex's token command: Luke asked for the plan's access token under the runner's bearer, and the token answered for app-server alone.
 *
 * App-server runs `node <bundle> codex-token <tokenUrl>` (its provider's
 * `auth` command, `codex.ts`) for the bearer it sends OpenAI: as it first
 * needs one, again once its cached one is older than the refresh interval,
 * and again after a 401, mid-turn included. The command inherits
 * app-server's environment, the runner's bearer in it (which the Luke MCP
 * server's header already reads from there), and prints the token on stdout,
 * which app-server reads and nothing else does. A refusal or failure says
 * only its status on stderr, which app-server may quote in a turn's error,
 * so no secret is ever written there.
 */

import { Data, Duration, Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { RUNNER_ENV, RunnerTokenAnswerSchema } from "./protocol.js";

/** How long Luke is given to answer, within app-server's own timeout for the command. */
const ASK_TIMEOUT = Duration.seconds(20);

const HTTP_OK = 200;

const decodeAnswer = Schema.decodeUnknownOption(RunnerTokenAnswerSchema);

/** Why no token came back: words with no secret in them, for app-server's stderr. */
class CodexTokenFailed extends Data.TaggedError("CodexTokenFailed")<{
  readonly detail: string;
}> {}

/** The plan's access token, asked of Luke at `url` under the bearer in `env`. */
export const askCodexToken = Effect.fn("agent-runner/askCodexToken")(function* (
  url: string,
  env: Readonly<Record<string, string | undefined>>,
) {
  const bearer = env[RUNNER_ENV.BEARER];
  if (bearer === undefined || bearer === "") {
    return yield* new CodexTokenFailed({ detail: `${RUNNER_ENV.BEARER} is not set` });
  }
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(HttpClientRequest.post(url).pipe(HttpClientRequest.bearerToken(bearer)))
    .pipe(
      Effect.timeout(ASK_TIMEOUT),
      // Note that the client's error is not kept, because the request it describes carries the bearer.
      Effect.mapError(() => new CodexTokenFailed({ detail: "Luke did not answer" })),
    );
  if (response.status !== HTTP_OK) {
    return yield* new CodexTokenFailed({ detail: `Luke refused the token: ${response.status}` });
  }
  const body = yield* response.json.pipe(
    Effect.mapError(() => new CodexTokenFailed({ detail: "Luke's answer is not JSON" })),
  );
  const answer = decodeAnswer(body);
  if (Option.isNone(answer) || answer.value.accessToken === "") {
    return yield* new CodexTokenFailed({ detail: "Luke's answer holds no token" });
  }
  return answer.value.accessToken;
});
