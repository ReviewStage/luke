/**
 * events.ts -- the runner's way out: every message numbered in the order it was emitted, and posted to Luke in batches, in order, retried until Luke takes it.
 *
 * One sender fiber posts one batch at a time, so a batch never overtakes the
 * one before it, and a batch that fails is posted again whole with the same
 * numbers, which Luke applies at most once. Everything emitted while a post
 * is in flight waits in the queue and goes in the next batch, so a stream of
 * partial messages costs a post per round trip rather than per token. Beside
 * the sender, a heartbeat posts a batch with no events every
 * `RUNNER_HEARTBEAT` for as long as the launch runs, once each, since the
 * next is never far, so Luke keeps the sandbox alive through a harness's
 * long silence; it stops as the sink drains.
 *
 * No post tops what Luke's route reads (`RUNNER_EVENTS_MAX_BYTES`), since
 * Luke refuses one that does for good and the launch would hear nothing
 * more: the events a batch takes are posted in as many posts, in order, as
 * keep each under it, and an event that alone would top it, a tool's
 * answer of many megabytes, has its longest words cut on a line, as eve's
 * reads cut a long text (`@luke/wire/text-cut`), each saying how much was
 * left out, its secrets taken out first so no cut leaves half of one.
 */

import { cutOnLine } from "@luke/wire/text-cut";
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
  RUNNER_EVENTS_MAX_BYTES,
  RUNNER_HEARTBEAT,
  type RunnerEvent,
  type RunnerMessage,
} from "./protocol.js";

/** The most events one post carries. */
const BATCH_MAX = 256;

/** A post's body around its events, `{"events":[...]}`. */
const BODY_OPEN = '{"events":[';
const BODY_CLOSE = "]}";

/** The most one event may weigh: a post's bound, less the body around it. */
const EVENT_MAX_BYTES = RUNNER_EVENTS_MAX_BYTES - BODY_OPEN.length - BODY_CLOSE.length;

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
  /** Adds a secret the launch came to hold, such as a refreshed token, to those no batch from now on carries. */
  readonly withhold: (secret: Redacted.Redacted) => Effect.Effect<void>;
}

/** What a secret is replaced with wherever an event carried it. */
const REDACTED = "[redacted]";

/** A value as it crosses to Luke: JSON's own shapes. */
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** A text with every secret taken out. */
function redactedText(text: string, secrets: readonly string[]): string {
  return secrets.reduce((scrubbing, secret) => scrubbing.replaceAll(secret, REDACTED), text);
}

/** A value with every secret taken out of each string in it, keys included. */
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

/** A value with every string longer than the bound cut on a line, each saying how much of it was left out. */
function cut(value: Json, bound: number): Json {
  if (Predicate.isString(value)) {
    const { text, leftOutChars } = cutOnLine(value, bound);
    return leftOutChars === 0 ? value : `${text}\n… ${leftOutChars} characters left out`;
  }
  if (Array.isArray(value)) return value.map((each) => cut(each, bound));
  if (!Predicate.isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, cut(each, bound)]));
}

/** How many bytes a text weighs as UTF-8, as the post's body carries it. */
function bytesOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * An event as the text Luke is sent, with every secret the launch holds
 * taken out, and its words cut where it alone would top a post: each string
 * past a bound cut on a line, the bound halved until the event fits. Note
 * that we scrub every event, the SDK's included, because a tool's output or
 * a CLI's error is text the runner never wrote; the command sandbox keeps
 * both secrets from the agent's commands, and this is the second fence.
 * Note too that we scrub the strings themselves, before they are spelled as
 * JSON or cut, so no escape can hide a secret and no cut halves one.
 */
function eventText(event: RunnerEvent, secrets: readonly string[]): string {
  // Note that the event is JSON already, as the SDK parsed it from the CLI's stdout.
  const json = redacted(JSON.parse(JSON.stringify(event)), secrets);
  let text = JSON.stringify(json);
  for (let bound = EVENT_MAX_BYTES; bytesOf(text) > EVENT_MAX_BYTES && bound > 0; ) {
    bound = Math.floor(bound / 2);
    text = JSON.stringify(cut(json, bound));
  }
  return text;
}

/** One post's body: the events' texts, in order. */
function bodyOf(texts: readonly string[]): string {
  return `${BODY_OPEN}${texts.join(",")}${BODY_CLOSE}`;
}

/** The events as the bodies they are posted in, in order, each as many events as keep it under a post's bound. */
function bodiesOf(events: readonly RunnerEvent[], secrets: readonly Redacted.Redacted[]): string[] {
  const values = secrets.map(Redacted.value).filter((value) => value !== "");
  const bodies: string[] = [];
  let texts: string[] = [];
  let weight = BODY_OPEN.length + BODY_CLOSE.length;
  for (const event of events) {
    const text = eventText(event, values);
    const added = bytesOf(text) + (texts.length > 0 ? 1 : 0);
    if (texts.length > 0 && weight + added > RUNNER_EVENTS_MAX_BYTES) {
      bodies.push(bodyOf(texts));
      texts = [];
      weight = BODY_OPEN.length + BODY_CLOSE.length;
    }
    weight += bytesOf(text) + (texts.length > 0 ? 1 : 0);
    texts.push(text);
  }
  if (texts.length > 0) bodies.push(bodyOf(texts));
  return bodies;
}

/** One post, sent once: taken, or why Luke did not take it. */
function postOnce(
  client: HttpClient.HttpClient,
  options: SinkOptions,
  body: string,
): Effect.Effect<void, EventsUndelivered> {
  const request = HttpClientRequest.post(options.url).pipe(
    HttpClientRequest.bearerToken(options.bearer),
    HttpClientRequest.bodyText(body, "application/json"),
  );
  return client.execute(request).pipe(
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
}

/** One post, sent until Luke takes it or answers that it never will. */
const postBatch = Effect.fn("agent-runner/postBatch")(function* (
  client: HttpClient.HttpClient,
  options: SinkOptions,
  body: string,
) {
  return yield* postOnce(client, options, body).pipe(
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
  let secrets = options.secrets;

  const sendAll = Effect.gen(function* () {
    for (;;) {
      const events = yield* Queue.takeBetween(queue, 1, BATCH_MAX);
      for (const body of bodiesOf(events, secrets)) {
        yield* postBatch(client, { ...options, secrets }, body);
      }
    }
  }).pipe(Effect.catchIf(Cause.isDone, () => Effect.void));
  const sender = yield* Effect.forkScoped(sendAll);
  // Note that a heartbeat Luke did not take, or did not answer within its bound, is let go, since the next follows within the interval.
  const heartbeat = yield* Effect.forkScoped(
    Effect.forever(
      Effect.andThen(
        Effect.sleep(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS)),
        Effect.ignore(
          Effect.suspend(() => postOnce(client, { ...options, secrets }, bodyOf([]))).pipe(
            Effect.timeout(Duration.millis(RUNNER_HEARTBEAT.TIMEOUT_MS)),
          ),
        ),
      ),
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
  const undelivered = Fiber.join(sender).pipe(
    Effect.flip,
    Effect.catch(() => Effect.never),
  );
  const withhold = (secret: Redacted.Redacted) =>
    Effect.sync(() => {
      secrets = [...secrets, secret];
    });
  return { emit, drain, undelivered, withhold } satisfies EventSink;
});
