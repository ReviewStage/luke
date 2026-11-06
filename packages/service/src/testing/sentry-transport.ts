import * as Sentry from "@sentry/effect";
import { Effect, Layer, Predicate, Schema } from "effect";
import {
  type SentryOptions,
  sentryLayer,
  sentryOptions,
  sentryReportingLayer,
} from "../observability/sentry.js";

const FIXTURE_SENTRY_DSN = "https://public@sentry.invalid/1";

type Transport = NonNullable<NonNullable<SentryOptions>["transport"]>;

const SentPayloadSchema = Schema.Struct({
  exception: Schema.optionalKey(
    Schema.Struct({
      values: Schema.Array(
        Schema.Struct({
          type: Schema.optionalKey(Schema.String),
          value: Schema.optionalKey(Schema.String),
        }),
      ),
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

function processHandlers(): ReadonlySet<unknown> {
  return new Set([
    ...process.listeners("uncaughtException"),
    ...process.listeners("unhandledRejection"),
  ]);
}

export interface SentItem {
  readonly type: string;
  readonly text: string;
  readonly payload: typeof SentPayloadSchema.Type;
}

export interface RecordingSentry {
  readonly sent: SentItem[];
  readonly layer: Layer.Layer<never>;
  readonly throwUncaught: (error: Error) => void;
  readonly rejectUnhandled: (reason: Error) => void;
}

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

function fixtureOptions(transport: Transport): SentryOptions {
  return {
    ...sentryOptions(),
    dsn: FIXTURE_SENTRY_DSN,
    environment: "test",
    tracesSampleRate: 1.0,
    transport,
  };
}

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

export function recordingSentry(delivered?: () => Promise<void>): RecordingSentry {
  const sent: SentItem[] = [];
  return recording(sent, sentryLayer(fixtureOptions(recordingTransport(sent, delivered))));
}

export function recordingEveSentry(): RecordingSentry {
  const sent: SentItem[] = [];
  const options = fixtureOptions(recordingTransport(sent));
  const started = Layer.merge(
    Layer.effectDiscard(Effect.sync(() => Sentry.eveInstrumentation(options).setup())),
    sentryReportingLayer,
  );
  return recording(sent, started);
}

export function sentOfType(sent: readonly SentItem[], type: string): SentItem[] {
  return sent.filter((item) => item.type === type);
}
