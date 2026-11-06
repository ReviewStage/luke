import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Sentry from "@sentry/core";
import { Data, Effect, ErrorReporter, Fiber, Predicate } from "effect";
import {
  launchFailureReported,
  type SentryCapture,
  sentryReporterLayer,
} from "./sentry-reporting.js";

const FIXTURE_SENTRY_DSN = "https://public@sentry.invalid/1";

interface SentEvent {
  readonly level: string | undefined;
  readonly exceptions: readonly { readonly type: string; readonly value: string }[];
}

type Thrown = Parameters<Sentry.Client["eventFromException"]>[0];

interface RecordingSentry {
  readonly sent: SentEvent[];
  readonly sentry: SentryCapture;
}

class FixtureClient extends Sentry.Client {
  constructor(options: Sentry.ClientOptions) {
    super(options);
  }
  eventFromException(exception: Thrown, hint?: Sentry.EventHint): PromiseLike<Sentry.Event> {
    return Promise.resolve(
      Sentry.eventFromUnknownInput(this, this.getOptions().stackParser, exception, hint),
    );
  }
  eventFromMessage(
    message: Sentry.ParameterizedString,
    level?: Sentry.SeverityLevel,
    hint?: Sentry.EventHint,
  ): PromiseLike<Sentry.Event> {
    return Promise.resolve(
      Sentry.eventFromMessage(this.getOptions().stackParser, message, level, hint),
    );
  }
}

function eventsOf(body: string): SentEvent[] {
  const [, ...lines] = body.split("\n").filter((line) => line.length > 0);
  const events: SentEvent[] = [];
  for (let at = 0; at + 1 < lines.length; at += 2) {
    const header: { type?: string } = JSON.parse(lines[at] ?? "{}");
    if (header.type !== "event") continue;
    const payload: Sentry.Event = JSON.parse(lines[at + 1] ?? "{}");
    events.push({
      level: payload.level,
      exceptions: (payload.exception?.values ?? []).map((value) => ({
        type: value.type ?? "",
        value: value.value ?? "",
      })),
    });
  }
  return events;
}

function recordingSentry(
  options: {
    beforeSend?: Sentry.ClientOptions["beforeSend"];
    delivered?: () => Promise<void>;
  } = {},
): RecordingSentry {
  const sent: SentEvent[] = [];
  const clientOptions: Sentry.ClientOptions = {
    dsn: FIXTURE_SENTRY_DSN,
    integrations: [],
    stackParser: Sentry.createStackParser(),
    transport: (transportOptions: Sentry.BaseTransportOptions) =>
      Sentry.createTransport(transportOptions, (request) => {
        const body = Predicate.isString(request.body)
          ? request.body
          : new TextDecoder().decode(request.body);
        sent.push(...eventsOf(body));
        return (options.delivered?.() ?? Promise.resolve()).then(() => ({}));
      }),
  };
  if (options.beforeSend !== undefined) clientOptions.beforeSend = options.beforeSend;
  const client = new FixtureClient(clientOptions);
  Sentry.setCurrentClient(client);
  client.init();
  return { sent, sentry: { captureException: Sentry.captureException, flush: Sentry.flush } };
}

class RowUnreadable extends Data.TaggedError("RowUnreadable")<{ readonly message: string }> {}

class SignedOut extends Data.TaggedError("SignedOut")<{ readonly message: string }> {
  override readonly [ErrorReporter.ignore] = true;
}

it.effect("a defect under error reporting is one event, however many boundaries it crosses", () =>
  Effect.gen(function* () {
    const { sent, sentry } = recordingSentry();
    const dies = Effect.die(new RangeError("no such row"));
    yield* Effect.exit(
      Effect.withErrorReporting(Effect.withErrorReporting(dies, { defectsOnly: true })),
    ).pipe(Effect.provide(sentryReporterLayer(sentry)));
    yield* Effect.promise(() => Sentry.flush(1_000));
    assert.deepEqual(sent, [
      { level: "error", exceptions: [{ type: "RangeError", value: "no such row" }] },
    ]);
  }),
);

it.effect(
  "a typed failure is sent where the boundary asks for failures, and not where it asks for defects",
  () =>
    Effect.gen(function* () {
      const { sent, sentry } = recordingSentry();
      yield* Effect.gen(function* () {
        yield* Effect.exit(
          Effect.withErrorReporting(Effect.fail(new RowUnreadable({ message: "first" })), {
            defectsOnly: true,
          }),
        );
        yield* Effect.exit(
          Effect.withErrorReporting(Effect.fail(new RowUnreadable({ message: "second" }))),
        );
      }).pipe(Effect.provide(sentryReporterLayer(sentry)));
      yield* Effect.promise(() => Sentry.flush(1_000));
      assert.deepEqual(
        sent.flatMap((event) => event.exceptions.map((exception) => exception.value)),
        ["second"],
      );
    }),
);

it.effect("an interruption and an error marked ignored are never sent", () =>
  Effect.gen(function* () {
    const { sent, sentry } = recordingSentry();
    yield* Effect.gen(function* () {
      yield* Effect.exit(Effect.withErrorReporting(Effect.interrupt));
      yield* Effect.exit(
        Effect.withErrorReporting(Effect.fail(new SignedOut({ message: "signed out" }))),
      );
    }).pipe(Effect.provide(sentryReporterLayer(sentry)));
    yield* Effect.promise(() => Sentry.flush(1_000));
    assert.deepEqual(sent, []);
  }),
);

it.effect(
  "a reported failure passes the process's beforeSend, so a filtered one never leaves",
  () =>
    Effect.gen(function* () {
      const { sent, sentry } = recordingSentry({
        beforeSend: (event) => (JSON.stringify(event).includes("access_token") ? null : event),
      });
      yield* Effect.exit(
        Effect.withErrorReporting(Effect.die(new Error("join failed: wss://x/rtc?access_token=t"))),
      ).pipe(Effect.provide(sentryReporterLayer(sentry)));
      yield* Effect.promise(() => Sentry.flush(1_000));
      assert.deepEqual(sent, []);
    }),
);

it.effect("a failed launch is sent as fatal, and returns only once its event has left", () =>
  Effect.gen(function* () {
    let release = () => {};
    const network = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sent, sentry } = recordingSentry({ delivered: () => network });
    const reported = yield* Effect.forkChild(
      launchFailureReported(sentry, new Error("the keychain could not be read")),
    );
    for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
    assert.equal(reported.pollUnsafe(), undefined);
    release();
    yield* Fiber.join(reported);
    assert.deepEqual(sent, [
      { level: "fatal", exceptions: [{ type: "Error", value: "the keychain could not be read" }] },
    ]);
  }),
);
