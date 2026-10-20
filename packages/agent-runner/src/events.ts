/**
 * events.ts -- the runner's way out: every message numbered in the order it was emitted, and posted to Luke in batches, in order, retried until Luke takes it.
 *
 * One sender fiber posts one batch at a time, so a batch never overtakes the
 * one before it, and a batch that fails is posted again whole with the same
 * numbers, which Luke applies at most once. Everything emitted while a post
 * is in flight waits in the queue and goes in the next batch, so a stream of
 * partial messages costs a post per round trip rather than per token.
 */

import {
  Cause,
  Data,
  Duration,
  Effect,
  Fiber,
  Queue,
  Redacted,
  Schedule,
  type Scope,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { RunnerEvent, RunnerEventBatch, RunnerMessage } from "./protocol.js";

/** The most events one post carries. */
const BATCH_MAX = 256;

/**
 * How long the sender waits after a post Luke did not take: the first wait,
 * doubling on each failure, up to the longest; and how many times it tries
 * again before it gives up, which at the longest wait is about ten minutes.
 */
const POST_RETRY = {
  FIRST: Duration.millis(250),
  LONGEST: Duration.seconds(10),
  TIMES: 64,
} as const;

const POST_BACKOFF = Schedule.exponential(POST_RETRY.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, POST_RETRY.LONGEST)),
  ),
);

/** The statuses that say Luke may take the same batch later: its own failure, a timeout, or a limit. */
const TRANSIENT_STATUS = new Set([408, 429]);
const SERVER_ERROR = 500;

/** A post Luke did not take. `transient` is whether posting it again may succeed. */
export class EventsUndelivered extends Data.TaggedError("EventsUndelivered")<{
  readonly transient: boolean;
  readonly detail: string;
}> {}

/** Where a launch's events go, as whom, from which number, and the secrets no event may carry. */
interface SinkOptions {
  readonly url: string;
  readonly bearer: Redacted.Redacted;
  readonly firstSequence: number;
  readonly secrets: readonly Redacted.Redacted[];
}

export interface EventSink {
  /** Numbers a message and queues it for Luke. */
  readonly emit: (message: RunnerMessage) => Effect.Effect<void>;
  /** Takes no more messages and waits until every queued one is posted, or the sender gave up. */
  readonly drain: Effect.Effect<void, EventsUndelivered>;
  /** Settles only if the sender gives up, with why: Luke will not hear anything more from this launch. */
  readonly undelivered: Effect.Effect<EventsUndelivered>;
}

/** What a secret is replaced with wherever an event carried it. */
const REDACTED = "[redacted]";

/**
 * A batch as the text Luke is sent, with every secret the launch holds taken
 * out. Note that we scrub every event, the SDK's included, because a tool's
 * output or a CLI's error is text the runner never wrote; the command sandbox
 * keeps both secrets from the agent's commands, and this is the second fence.
 */
function batchText(batch: RunnerEventBatch, secrets: readonly Redacted.Redacted[]): string {
  return secrets.reduce<string>((text, secret) => {
    const value = Redacted.value(secret);
    return value === "" ? text : text.replaceAll(value, REDACTED);
  }, JSON.stringify(batch));
}

/** One batch, posted until Luke takes it or answers that it never will. */
const postBatch = Effect.fn("agent-runner/postBatch")(function* (
  client: HttpClient.HttpClient,
  options: SinkOptions,
  batch: RunnerEventBatch,
) {
  const request = HttpClientRequest.post(options.url).pipe(
    HttpClientRequest.bearerToken(options.bearer),
    HttpClientRequest.bodyText(batchText(batch, options.secrets), "application/json"),
  );
  const once = client.execute(request).pipe(
    // Note that the error is not kept as the cause, because the request it
    // carries holds the bearer in its headers.
    Effect.mapError(() => new EventsUndelivered({ transient: true, detail: "Luke unreachable" })),
    Effect.flatMap((response) => {
      if (response.status >= 200 && response.status < 300) return Effect.void;
      const transient = response.status >= SERVER_ERROR || TRANSIENT_STATUS.has(response.status);
      return Effect.fail(
        new EventsUndelivered({ transient, detail: `Luke answered ${response.status}` }),
      );
    }),
  );
  return yield* once.pipe(
    Effect.retry({
      schedule: POST_BACKOFF,
      times: POST_RETRY.TIMES,
      while: (error) => error.transient,
    }),
  );
});

/**
 * The sink for one launch, numbering from `firstSequence`. Its sender runs in
 * the caller's scope; a post that fails for good stops it, and `drain`
 * reports that failure.
 */
export const makeEventSink = Effect.fn("agent-runner/makeEventSink")(function* (
  options: SinkOptions,
): Effect.fn.Return<EventSink, never, HttpClient.HttpClient | Scope.Scope> {
  const client = yield* HttpClient.HttpClient;
  const queue = yield* Queue.unbounded<RunnerEvent, Cause.Done>();
  let next = options.firstSequence;

  const sendAll = Effect.gen(function* () {
    for (;;) {
      const events = yield* Queue.takeBetween(queue, 1, BATCH_MAX);
      yield* postBatch(client, options, { events });
    }
  }).pipe(Effect.catchIf(Cause.isDone, () => Effect.void));
  const sender = yield* Effect.forkScoped(sendAll);

  const emit = (message: RunnerMessage) =>
    Effect.suspend(() => {
      const sequence = next;
      next += 1;
      return Queue.offer(queue, { sequence, message });
    }).pipe(Effect.asVoid);

  const drain = Queue.end(queue).pipe(Effect.andThen(Fiber.join(sender)));
  const undelivered = Fiber.join(sender).pipe(
    Effect.flip,
    Effect.catch(() => Effect.never),
  );
  return { emit, drain, undelivered } satisfies EventSink;
});
