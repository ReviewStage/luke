/**
 * sentry-transport.ts -- Sentry as a suite stands it up: the deployment's own Sentry layer over a transport that writes down what it would have sent.
 *
 * Sentry's transport is the process boundary its reports cross, so a suite
 * replaces it and nothing else: the SDK, its reporter, its logger, and its
 * check-ins are the production ones, started on the deployment's own
 * options. The SDK is a process-wide singleton, so
 * the layer closes it when released, which also flushes what is queued, and
 * takes back the process handlers it added; a suite reads what was sent once
 * its layer is released.
 */

import * as Sentry from "@sentry/effect";
import { Effect, Layer, Predicate, Schema } from "effect";
import {
  type SentryOptions,
  sentryLayer,
  sentryOptions,
  sentryReportingLayer,
} from "../observability/sentry.js";

/** A DSN on a reserved domain, which the recording transport never posts to. */
const FIXTURE_SENTRY_DSN = "https://public@sentry.invalid/1";

type Transport = NonNullable<NonNullable<SentryOptions>["transport"]>;

/** What a suite reads of an item's payload: an error event's exceptions and breadcrumbs, and a check-in's monitor, status, and config. */
const SentPayloadSchema = Schema.Struct({
  exception: Schema.optionalKey(
    Schema.Struct({
      values: Schema.Array(Schema.Struct({ type: Schema.optionalKey(Schema.String) })),
    }),
  ),
  breadcrumbs: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        category: Schema.optionalKey(Schema.String),
        message: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  monitor_slug: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  monitor_config: Schema.optionalKey(
    Schema.Struct({
      schedule: Schema.Struct({ type: Schema.String, value: Schema.String }),
      checkin_margin: Schema.Number,
      max_runtime: Schema.Number,
      failure_issue_threshold: Schema.Number,
      timezone: Schema.String,
    }),
  ),
});

const decodeSentPayload = Schema.decodeUnknownSync(Schema.fromJsonString(SentPayloadSchema));

const ItemHeaderSchema = Schema.Struct({ type: Schema.String });

const decodeItemHeader = Schema.decodeUnknownSync(Schema.fromJsonString(ItemHeaderSchema));

/** The process's handlers of an exception and a rejection nothing caught, as they stand. */
function processHandlers(): ReadonlySet<unknown> {
  return new Set([
    ...process.listeners("uncaughtException"),
    ...process.listeners("unhandledRejection"),
  ]);
}

/** One item of an envelope as the suite reads it: its type, its payload's text, and what the suite reads of it. */
export interface SentItem {
  readonly type: string;
  readonly text: string;
  readonly payload: typeof SentPayloadSchema.Type;
}

/** Every envelope item Sentry would have received, in the order it was sent. */
export interface RecordingSentry {
  readonly sent: SentItem[];
  /** The deployment's Sentry layer, started on the fixture DSN over the recording transport. */
  readonly layer: Layer.Layer<never>;
  /**
   * Hands an exception nothing caught to the handlers the layer added to the
   * process, as Node would, and to none of the runner's own, which would fail
   * the suite.
   */
  readonly throwUncaught: (error: Error) => void;
  /** Hands a rejection nothing handled to the layer's handlers, on the same terms. */
  readonly rejectUnhandled: (reason: Error) => void;
}

/**
 * A serialized envelope's items: a line of envelope headers, then a line of
 * item headers and a line of payload for each item, every line one JSON
 * object (develop.sentry.dev/sdk/data-model/envelopes).
 */
function itemsOf(body: string): SentItem[] {
  const [, ...lines] = body.split("\n").filter((line) => line.length > 0);
  const items: SentItem[] = [];
  for (let at = 0; at + 1 < lines.length; at += 2) {
    const text = lines[at + 1] ?? "{}";
    items.push({
      type: decodeItemHeader(lines[at] ?? "{}").type,
      text,
      payload: decodeSentPayload(text),
    });
  }
  return items;
}

/** A transport that keeps each envelope's items in `sent` rather than posting them, each send completing when `delivered` says. */
function recordingTransport(sent: SentItem[], delivered?: () => Promise<void>): Transport {
  return (options) =>
    Sentry.createTransport(options, (request) => {
      const body = Predicate.isString(request.body)
        ? request.body
        : new TextDecoder().decode(request.body);
      sent.push(...itemsOf(body));
      return (delivered?.() ?? Promise.resolve()).then(() => ({}));
    });
}

/** The deployment's own options, on the fixture DSN, every request traced, over `transport`. */
function fixtureOptions(transport: Transport): SentryOptions {
  return {
    ...sentryOptions(),
    dsn: FIXTURE_SENTRY_DSN,
    environment: "test",
    tracesSampleRate: 1.0,
    transport,
  };
}

/**
 * Sentry started by `started`, recording into `sent`, with a layer that
 * closes the SDK when released and takes back the process handlers the start
 * added.
 */
function recording(sent: SentItem[], started: Layer.Layer<never>): RecordingSentry {
  let standing = processHandlers();
  const added = <Handler>(handlers: readonly Handler[]): Handler[] =>
    handlers.filter((handler) => !standing.has(handler));
  const closed = Layer.effectDiscard(
    Effect.sync(() => {
      standing = processHandlers();
    }).pipe(
      Effect.andThen(Effect.addFinalizer(() => Effect.promise(() => Sentry.close()))),
      Effect.andThen(
        Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const handler of added(process.listeners("uncaughtException"))) {
              process.removeListener("uncaughtException", handler);
            }
            for (const handler of added(process.listeners("unhandledRejection"))) {
              process.removeListener("unhandledRejection", handler);
            }
          }),
        ),
      ),
    ),
  );
  return {
    sent,
    // Note that `closed` is built first, so it reads the handlers that stood before Sentry started.
    layer: Layer.provideMerge(started, closed),
    throwUncaught: (error) => {
      for (const handler of added(process.listeners("uncaughtException"))) {
        handler(error, "uncaughtException");
      }
    },
    rejectUnhandled: (reason) => {
      for (const handler of added(process.listeners("unhandledRejection"))) {
        handler(reason, Promise.resolve());
      }
    },
  };
}

/**
 * The deployment's Sentry over a transport that keeps each envelope's items
 * rather than posting them. `delivered`, where given, is when each send
 * completes, so a suite can hold a report in flight the way a slow network
 * would; by default a send completes at once.
 */
export function recordingSentry(delivered?: () => Promise<void>): RecordingSentry {
  const sent: SentItem[] = [];
  return recording(sent, sentryLayer(fixtureOptions(recordingTransport(sent, delivered))));
}

/**
 * Sentry as an eve root starts it (`instrumentation/sentry.ts`, then the
 * runtime's `sentryReportingLayer`) over the same recording transport, so
 * the AI SDK integration eve's start brings in reports as it does in an
 * agent's process.
 */
export function recordingEveSentry(): RecordingSentry {
  const sent: SentItem[] = [];
  const options = fixtureOptions(recordingTransport(sent));
  const started = Layer.merge(
    Layer.effectDiscard(Effect.sync(() => Sentry.eveInstrumentation(options).setup())),
    sentryReportingLayer,
  );
  return recording(sent, started);
}

/** The items of one type, in the order they were sent. */
export function sentOfType(sent: readonly SentItem[], type: string): SentItem[] {
  return sent.filter((item) => item.type === type);
}
