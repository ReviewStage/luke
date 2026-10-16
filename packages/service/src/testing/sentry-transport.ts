/**
 * sentry-transport.ts -- Sentry as a suite stands it up: the deployment's own Sentry layer over a transport that writes down what it would have sent.
 *
 * Sentry's transport is the process boundary its reports cross, so a suite
 * replaces it and nothing else: the SDK, its reporter, its logger, and its
 * check-ins are the production ones. The SDK is a process-wide singleton, so
 * the layer closes it when released, which also flushes what is queued; a
 * suite reads what was sent once its layer is released.
 */

import * as Sentry from "@sentry/effect";
import { Effect, Layer, Predicate, Schema } from "effect";
import { type SentryOptions, sentryLayer } from "../observability/sentry.js";

/** A DSN on a reserved domain, which the recording transport never posts to. */
const FIXTURE_SENTRY_DSN = "https://public@sentry.invalid/1";

type Transport = NonNullable<NonNullable<SentryOptions>["transport"]>;

/** What a suite reads of an item's payload: an error event's exceptions, and a check-in's monitor, status, and config. */
const SentPayloadSchema = Schema.Struct({
  exception: Schema.optionalKey(
    Schema.Struct({
      values: Schema.Array(Schema.Struct({ type: Schema.optionalKey(Schema.String) })),
    }),
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

/** The deployment's Sentry over a transport that keeps each envelope's items rather than posting them. */
export function recordingSentry(): RecordingSentry {
  const sent: SentItem[] = [];
  const transport: Transport = (options) =>
    Sentry.createTransport(options, (request) => {
      const body = Predicate.isString(request.body)
        ? request.body
        : new TextDecoder().decode(request.body);
      sent.push(...itemsOf(body));
      return Promise.resolve({});
    });
  const started = sentryLayer({
    dsn: FIXTURE_SENTRY_DSN,
    environment: "test",
    tracesSampleRate: 1.0,
    transport,
  });
  const closed = Layer.effectDiscard(
    Effect.addFinalizer(() => Effect.promise(() => Sentry.close())),
  );
  return { sent, layer: Layer.merge(closed, started) };
}

/** The items of one type, in the order they were sent. */
export function sentOfType(sent: readonly SentItem[], type: string): SentItem[] {
  return sent.filter((item) => item.type === type);
}
