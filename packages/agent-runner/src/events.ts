import {
  Cause,
  Data,
  Duration,
  Effect,
  Fiber,
  Predicate,
  Queue,
  Redacted,
  Schedule,
  type Scope,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  RUNNER_HEARTBEAT,
  type RunnerEvent,
  type RunnerEventBatch,
  type RunnerMessage,
} from "./protocol.js";

const BATCH_MAX = 256;

const POST_RETRY = {
  FIRST: Duration.millis(250),
  LONGEST: Duration.seconds(30),
} as const;

const POST_BACKOFF = Schedule.exponential(POST_RETRY.FIRST).pipe(
  Schedule.jittered,
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, POST_RETRY.LONGEST)),
  ),
);

const POST_TIMEOUT = Duration.millis(RUNNER_HEARTBEAT.TIMEOUT_MS);

const STOP_DRAIN = POST_TIMEOUT;

const TRANSIENT_STATUS = new Set([408, 429]);
const SERVER_ERROR = 500;

export class EventsUndelivered extends Data.TaggedError("EventsUndelivered")<{
  readonly transient: boolean;
  readonly detail: string;
}> {}

interface SinkOptions {
  readonly url: string;
  readonly bearer: Redacted.Redacted;
  readonly firstSequence: number;
  readonly secrets: readonly Redacted.Redacted[];
}

export interface EventSink {
  readonly emit: (message: RunnerMessage) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void, EventsUndelivered>;
  readonly drainStopped: Effect.Effect<void, EventsUndelivered>;
  readonly undelivered: Effect.Effect<EventsUndelivered>;
  readonly withhold: (secret: Redacted.Redacted) => Effect.Effect<void>;
}

const REDACTED = "[redacted]";

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

function redactedText(text: string, secrets: readonly string[]): string {
  return secrets.reduce((scrubbing, secret) => scrubbing.replaceAll(secret, REDACTED), text);
}

function redacted(value: Json, secrets: readonly string[]): Json {
  if (Predicate.isString(value)) return redactedText(value, secrets);
  if (Array.isArray(value)) return value.map((each) => redacted(each, secrets));
  if (!Predicate.isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      redactedText(key, secrets),
      redacted(each, secrets),
    ]),
  );
}

function batchText(batch: RunnerEventBatch, secrets: readonly Redacted.Redacted[]): string {
  const values = secrets.map(Redacted.value).filter((value) => value !== "");
  const json: Json = JSON.parse(JSON.stringify(batch));
  return JSON.stringify(redacted(json, values));
}

function postOnce(
  client: HttpClient.HttpClient,
  options: SinkOptions,
  batch: RunnerEventBatch,
): Effect.Effect<void, EventsUndelivered> {
  const request = HttpClientRequest.post(options.url).pipe(
    HttpClientRequest.bearerToken(options.bearer),
    HttpClientRequest.bodyText(batchText(batch, options.secrets), "application/json"),
  );
  return client.execute(request).pipe(
    Effect.timeout(POST_TIMEOUT),
    Effect.mapError(
      () => new EventsUndelivered({ transient: true, detail: "Service unreachable" }),
    ),
    Effect.flatMap((response) => {
      if (response.status >= 200 && response.status < 300) return Effect.void;
      const transient = response.status >= SERVER_ERROR || TRANSIENT_STATUS.has(response.status);
      return Effect.fail(
        new EventsUndelivered({ transient, detail: `The service answered ${response.status}` }),
      );
    }),
  );
}

const postBatch = Effect.fn("agent-runner/postBatch")(function* (
  client: HttpClient.HttpClient,
  options: SinkOptions,
  batch: RunnerEventBatch,
) {
  return yield* postOnce(client, options, batch).pipe(
    Effect.retry({
      schedule: POST_BACKOFF,
      while: (error) => error.transient,
    }),
  );
});

export const makeEventSink = Effect.fn("agent-runner/makeEventSink")(function* (
  options: SinkOptions,
): Effect.fn.Return<EventSink, never, HttpClient.HttpClient | Scope.Scope> {
  const client = yield* HttpClient.HttpClient;
  const queue = yield* Queue.unbounded<RunnerEvent, Cause.Done>();
  let next = options.firstSequence;
  let secrets = options.secrets;

  const sendAll = Effect.gen(function* () {
    for (;;) {
      const events = yield* Queue.takeBetween(queue, 1, BATCH_MAX);
      yield* postBatch(client, { ...options, secrets }, { events });
    }
  }).pipe(Effect.catchIf(Cause.isDone, () => Effect.void));
  const sender = yield* Effect.forkScoped(sendAll);
  const heartbeat = yield* Effect.forkScoped(
    Effect.schedule(
      Effect.ignore(
        Effect.suspend(() => postOnce(client, { ...options, secrets }, { events: [] })),
      ),
      Schedule.spaced(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS)),
    ),
  );

  const emit = (message: RunnerMessage) =>
    Effect.suspend(() => {
      const sequence = next;
      next += 1;
      return Queue.offer(queue, { sequence, message });
    }).pipe(Effect.asVoid);

  const drain = Fiber.interrupt(heartbeat).pipe(
    Effect.andThen(Queue.end(queue)),
    Effect.andThen(Fiber.join(sender)),
  );
  const drainStopped = drain.pipe(Effect.timeoutOption(STOP_DRAIN), Effect.asVoid);
  const undelivered = Fiber.join(sender).pipe(
    Effect.flip,
    Effect.catch(() => Effect.never),
  );
  const withhold = (secret: Redacted.Redacted) =>
    Effect.sync(() => {
      secrets = [...secrets, secret];
    });
  return { emit, drain, drainStopped, undelivered, withhold } satisfies EventSink;
});
