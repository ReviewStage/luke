import { Duration, Effect, ErrorReporter, type Layer } from "effect";

const SENTRY_LEVEL = { FATAL: "fatal", WARNING: "warning", ERROR: "error" } as const;
type SentryLevel = (typeof SENTRY_LEVEL)[keyof typeof SENTRY_LEVEL];

const SEVERITY_LEVEL = { Fatal: SENTRY_LEVEL.FATAL, Warn: SENTRY_LEVEL.WARNING } as const;

const SENTRY_MECHANISM = {
  EFFECT: "auto.function.effect.error_reporter",
  LAUNCH: "auto.electron.launch",
} as const;

const LAUNCH_FAILURE_FLUSH_MS = 2_000;

type ErrorAttributes = ReturnType<typeof ErrorReporter.getAttributes>;

interface SentryCaptureHint {
  readonly mechanism: { readonly type: string; readonly handled: boolean };
  readonly captureContext: {
    readonly level: SentryLevel;
    readonly extra?: ErrorAttributes;
  };
}

export interface SentryCapture {
  readonly captureException: (error: Error, hint: SentryCaptureHint) => string;
  readonly flush: (timeout: number) => PromiseLike<boolean>;
}

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
