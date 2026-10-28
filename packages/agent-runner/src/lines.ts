/**
 * lines.ts -- Luke's lines read past the launch's cursor, where its config names the read, and handed to the launch as its stdin's would be.
 *
 * A launch whose config names `linesUrl` reads Luke's later lines from Luke
 * (`RUNNER_LINES`) rather than from its stdin, so a line stands at Luke
 * until the launch says it took it. One fiber asks again and again, each
 * read naming the place of the last line it was handed, which Luke holds
 * open until a line past it is queued; every line answered is handed on in
 * order, exactly as a line read from stdin is, so neither harness's loop
 * knows where its lines came from. A read Luke did not answer is asked
 * again after a wait that doubles to its longest, as a post is, for as long
 * as the launch runs; one Luke refused for good, as for a bearer a newer
 * launch replaced, stops the reads, since asking again would be refused
 * again, and the launch's events tell Luke the rest.
 */

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

/** How long one read waits on Luke's answer: Luke's hold, and a margin for the answer to travel. */
const READ_TIMEOUT = Duration.millis(RUNNER_LINES.HOLD_MS + 15_000);

/** How long a read Luke did not answer waits before it is asked again: the first wait, doubling to the longest, jittered. */
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

/** The statuses that say Luke may answer the same read later: its own failure, a timeout, or a limit. */
const TRANSIENT_STATUS = new Set([408, 429]);
const SERVER_ERROR = 500;
const HTTP_OK = 200;

const decodeAnswer = Schema.decodeUnknownOption(RunnerLinesAnswerSchema);

/** A read Luke did not answer with lines. `transient` is whether asking again may. */
class LinesUnread extends Data.TaggedError("LinesUnread")<{
  readonly transient: boolean;
  readonly detail: string;
}> {}

/** Where a launch reads its lines, as whom, and which launch it is. */
export interface LinesRead {
  readonly url: string;
  readonly bearer: Redacted.Redacted;
  /** The launch's first event number, which names it to Luke. */
  readonly launch: number;
}

/** One read past the place given: the lines Luke answered, or why it answered none. */
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
    // Note that the error is not kept as the cause, because the request it carries holds the bearer in its headers.
    Effect.mapError(() => new LinesUnread({ transient: true, detail: "Luke unreachable" })),
    Effect.flatMap((response) => {
      if (response.status !== HTTP_OK) {
        const transient = response.status >= SERVER_ERROR || TRANSIENT_STATUS.has(response.status);
        return Effect.fail(
          new LinesUnread({ transient, detail: `Luke answered ${response.status}` }),
        );
      }
      return response.json.pipe(
        Effect.mapError(
          () => new LinesUnread({ transient: true, detail: "Luke's answer is not JSON" }),
        ),
        Effect.map(decodeAnswer),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new LinesUnread({ transient: true, detail: "Luke's answer holds no lines" }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
    }),
  );
}

/**
 * Luke's lines for the launch, read past its cursor for as long as the
 * launch runs and handed to `lines` in order, each once. Ends only where
 * Luke refused a read for good, or `lines` was ended.
 */
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
