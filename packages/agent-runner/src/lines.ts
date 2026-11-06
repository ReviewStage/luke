import {
  type Cause,
  Data,
  Duration,
  Effect,
  Option,
  Queue,
  type Redacted,
  Result,
  Schedule,
  Schema,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { RUNNER_LINES, type RunnerLinesAnswer, RunnerLinesAnswerSchema } from "./protocol.js";

const READ_TIMEOUT = Duration.millis(RUNNER_LINES.HOLD_MS + 15_000);

const READ_RETRY = {
  FIRST: Duration.millis(250),
  LONGEST: Duration.seconds(30),
} as const;

const READ_BACKOFF = Schedule.exponential(READ_RETRY.FIRST).pipe(
  Schedule.jittered,
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, READ_RETRY.LONGEST)),
  ),
);

const TRANSIENT_STATUS = new Set([408, 429]);
const SERVER_ERROR = 500;
const HTTP_OK = 200;

const decodeAnswer = Schema.decodeUnknownOption(RunnerLinesAnswerSchema);

class LinesUnread extends Data.TaggedError("LinesUnread")<{
  readonly transient: boolean;
  readonly detail: string;
}> {}

export interface LinesRead {
  readonly url: string;
  readonly bearer: Redacted.Redacted;
  readonly launch: number;
}

function readOnce(
  client: HttpClient.HttpClient,
  read: LinesRead,
  after: number,
): Effect.Effect<RunnerLinesAnswer, LinesUnread> {
  const url = new URL(read.url);
  url.searchParams.set(RUNNER_LINES.QUERY.LAUNCH, String(read.launch));
  url.searchParams.set(RUNNER_LINES.QUERY.AFTER, String(after));
  const request = HttpClientRequest.get(url.toString()).pipe(
    HttpClientRequest.bearerToken(read.bearer),
  );
  return client.execute(request).pipe(
    Effect.timeout(READ_TIMEOUT),
    Effect.mapError(() => new LinesUnread({ transient: true, detail: "Service unreachable" })),
    Effect.flatMap((response) => {
      if (response.status !== HTTP_OK) {
        const transient = response.status >= SERVER_ERROR || TRANSIENT_STATUS.has(response.status);
        return Effect.fail(
          new LinesUnread({ transient, detail: `The service answered ${response.status}` }),
        );
      }
      return response.json.pipe(
        Effect.mapError(
          () => new LinesUnread({ transient: true, detail: "The service's answer is not JSON" }),
        ),
        Effect.map(decodeAnswer),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new LinesUnread({ transient: true, detail: "The service's answer holds no lines" }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
    }),
  );
}

export const readLines = Effect.fn("agent-runner/readLines")(function* (
  read: LinesRead,
  lines: Queue.Queue<string, Cause.Done>,
) {
  const client = yield* HttpClient.HttpClient;
  let after = 0;
  for (;;) {
    const answered = yield* readOnce(client, read, after).pipe(
      Effect.retry({ schedule: READ_BACKOFF, while: (unread) => unread.transient }),
      Effect.result,
    );
    if (Result.isFailure(answered)) {
      return yield* Effect.logWarning(
        `agent-runner: stopped reading lines: ${answered.failure.detail}`,
      );
    }
    for (const line of answered.success.lines) {
      if (line.seq <= after) continue;
      if (!(yield* Queue.offer(lines, line.text))) return;
      after = line.seq;
    }
  }
});
