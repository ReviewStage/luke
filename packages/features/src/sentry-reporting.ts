/**
 * sentry-reporting.ts -- how a desktop process's failures become Sentry events: Effect's `ErrorReporter` over the SDK the process started, and a failed launch sent before the process goes.
 *
 * Main and each window start their own Sentry SDK (`@sentry/electron/main`
 * and `@sentry/electron/renderer`), and each hands its own capture and flush
 * here, so this module names no SDK and loads in either process. Whatever is
 * captured through them passes the `beforeSend` that process's `Sentry.init`
 * set, so the token filters hold on every path here as they do on Sentry's
 * own.
 *
 * Effect reports nothing by itself: a cause reaches a reporter only at a
 * boundary that asks, `Effect.withErrorReporting` or `ErrorReporter.report`.
 * Effect's reporter skips an interruption and an error marked
 * `ErrorReporter.ignore`, and never sends the same cause or error twice, so a
 * failure that crosses two boundaries is one event.
 */

import { Duration, Effect, ErrorReporter, type Layer } from "effect";

/** The Sentry levels an event here is sent at. */
const SENTRY_LEVEL = { FATAL: "fatal", WARNING: "warning", ERROR: "error" } as const;
type SentryLevel = (typeof SENTRY_LEVEL)[keyof typeof SENTRY_LEVEL];

/** Sentry's level for an error a class annotated with `ErrorReporter.severity`; `error` for the rest, as the service's reporter does. */
const SEVERITY_LEVEL = { Fatal: SENTRY_LEVEL.FATAL, Warn: SENTRY_LEVEL.WARNING } as const;

/** The mechanism each event names, so Sentry's issue says which path caught it. */
const SENTRY_MECHANISM = {
  /** A cause an Effect boundary reported. */
  EFFECT: "auto.function.effect.error_reporter",
  /** A launch whose standup failed, after which the process quits. */
  LAUNCH: "auto.electron.launch",
} as const;

/**
 * How long a failed launch waits for its event to leave before it quits
 * anyway. The process holds the single-instance lock, so the wait is short.
 */
const LAUNCH_FAILURE_FLUSH_MS = 2_000;

/** What a class annotated with `ErrorReporter.attributes` hands every report of it. */
type ErrorAttributes = ReturnType<typeof ErrorReporter.getAttributes>;

/** What a capture tells Sentry beside the error: the path that caught it, and its level and extra data. */
interface SentryCaptureHint {
  readonly mechanism: { readonly type: string; readonly handled: boolean };
  readonly captureContext: {
    readonly level: SentryLevel;
    readonly extra?: ErrorAttributes;
  };
}

/** The two calls of a process's Sentry SDK this module uses, as `@sentry/electron`'s main and renderer both export them. */
export interface SentryCapture {
  readonly captureException: (error: Error, hint: SentryCaptureHint) => string;
  /** What is queued, sent, or `false` once `timeout` milliseconds pass. */
  readonly flush: (timeout: number) => PromiseLike<boolean>;
}

/**
 * Effect's reporters with one more beside them that captures each reported
 * failure through `sentry`: a cause handed to `ErrorReporter.report`, and an
 * effect under `Effect.withErrorReporting`, become one event each. Unhandled,
 * since every boundary that reports a cause is one that turned it into a
 * fixed answer or a line on stderr.
 */
export function sentryReporterLayer(
  sentry: Pick<SentryCapture, "captureException">,
): Layer.Layer<never> {
  return ErrorReporter.layer(
    [
      ErrorReporter.make(({ error, severity, attributes }) => {
        sentry.captureException(error, {
          mechanism: { type: SENTRY_MECHANISM.EFFECT, handled: false },
          captureContext: {
            level:
              severity === "Fatal" || severity === "Warn"
                ? SEVERITY_LEVEL[severity]
                : SENTRY_LEVEL.ERROR,
            extra: { ...attributes },
          },
        });
      }),
    ],
    { mergeWithExisting: true },
  );
}

/**
 * A launch whose standup failed, captured as fatal and flushed, so the event
 * leaves before the quit that follows takes the process. The flush is
 * bounded twice, by Sentry's own timeout and by this effect's, and a flush
 * that refuses is let go: neither may hold the quit.
 */
export function launchFailureReported(sentry: SentryCapture, error: Error): Effect.Effect<void> {
  const captured = Effect.sync(() =>
    sentry.captureException(error, {
      mechanism: { type: SENTRY_MECHANISM.LAUNCH, handled: false },
      captureContext: { level: SENTRY_LEVEL.FATAL },
    }),
  );
  const flushed = Effect.tryPromise(() => sentry.flush(LAUNCH_FAILURE_FLUSH_MS)).pipe(
    Effect.timeoutOption(Duration.millis(LAUNCH_FAILURE_FLUSH_MS)),
    Effect.ignore,
  );
  return Effect.andThen(captured, flushed);
}
