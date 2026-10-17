/**
 * sentry.ts -- the deployment's Sentry, as Sentry's Effect and eve guides set it up: the options every process starts it with, and the layers that send it errors, spans, logs, and metrics.
 *
 * Sentry's Effect guide (docs.sentry.io/platforms/javascript/guides/effect)
 * composes `Sentry.effectLayer`, which starts the SDK and registers its
 * `ErrorReporter`, with the tracer, the logger, and the metrics layer. The web
 * functions take all of it. An eve root's process is started by eve's own
 * instrumentation (`instrumentation/sentry.ts`, Sentry's eve guide), which
 * runs before the agent loads, so its runtime takes everything but the
 * start: a second `init` would replace the client eve's integration hangs
 * off.
 *
 * Note that the options are Sentry's defaults: its `dataCollection` is left
 * as the SDK ships it, which `PRIVACY.md` describes. A deployment without
 * `SENTRY_DSN` starts the SDK disabled, and every layer here then sends
 * nothing.
 */

import * as Sentry from "@sentry/effect";
import { Effect, ErrorReporter, Exit, Layer, type Logger, Tracer } from "effect";

const SENTRY_ENVIRONMENT = {
  /** The `luke-web` project's DSN; absent means nothing is sent. */
  DSN: "SENTRY_DSN",
  /** Vercel's own name for the deployment: `production`, `preview`, or `development`. */
  DEPLOYMENT: "VERCEL_ENV",
} as const;

/** The environment a report names where Vercel names none, as a local `vercel dev` or a test. */
const UNNAMED_DEPLOYMENT = "development";

/** Sentry's level for an error a class annotated with Effect's `ErrorReporter.severity`; `error` for the rest, as `effectLayer`'s own reporter does. */
const SEVERITY_LEVEL = { Fatal: "fatal", Warn: "warning" } as const;

/** A scheduled job Sentry's Crons watches, created from its first check-in rather than by hand. */
export interface CronMonitor {
  readonly slug: string;
  /** The crontab the job is called on, which Sentry expects a check-in against. */
  readonly crontab: string;
  /** The longest a run may take before Sentry marks it failed, in minutes. */
  readonly maxRuntimeMinutes: number;
  /** Late a run may start before Sentry calls it missed, in minutes. */
  readonly checkInMarginMinutes: number;
  /** Failed or missed runs in a row before Sentry opens the monitor's issue. */
  readonly failuresBeforeIssue: number;
}

/** A monitor's config as a check-in carries it. */
type MonitorConfig = NonNullable<Parameters<typeof Sentry.captureCheckIn>[1]>;

/** What a process of this deployment starts Sentry with; a test adds its own transport. */
export type SentryOptions = Sentry.NodeOptions;

/**
 * The options every process starts Sentry with. The release is the SDK's
 * own: it reads Vercel's `VERCEL_GIT_COMMIT_SHA`, which is the release the
 * source maps are uploaded under (`scripts/bundle-functions.ts`).
 */
export function sentryOptions(): SentryOptions {
  return {
    dsn: process.env[SENTRY_ENVIRONMENT.DSN],
    environment: process.env[SENTRY_ENVIRONMENT.DEPLOYMENT] ?? UNNAMED_DEPLOYMENT,
    // Set tracesSampleRate to 1.0 to capture 100% of transactions for
    // tracing. Sentry recommends adjusting this value in production.
    tracesSampleRate: 1.0,
  };
}

/** Effect's spans as Sentry spans, and Effect's metrics as Sentry's, as the guide's v4 snippet installs them. */
const sentryTelemetry = Layer.mergeAll(
  Layer.succeed(Tracer.Tracer, Sentry.SentryEffectTracer),
  Sentry.SentryEffectMetricsLayer,
);

/** Every Effect log line as a Sentry log, for the runtime's logger set beside the JSON one. */
export const sentryLogger: Logger.Logger<unknown, void> = Sentry.SentryEffectLogger;

/**
 * Sentry started on `options`, with its `ErrorReporter` registered: a route
 * that fails, a cause handed to `ErrorReporter.report`, and an effect under
 * `Effect.withErrorReporting` are each captured.
 */
export function sentryLayer(options: SentryOptions = sentryOptions()): Layer.Layer<never> {
  return Layer.merge(Sentry.effectLayer(options), sentryTelemetry);
}

/**
 * The same reporting for a process eve's instrumentation already started
 * Sentry in, without a second start. It captures each failure as
 * `effectLayer`'s own reporter does, through Effect's `ErrorReporter.make`,
 * and is merged with whatever reporters stand, as the guide asks of a
 * reporter of one's own.
 */
export const sentryReportingLayer: Layer.Layer<never> = Layer.merge(
  ErrorReporter.layer(
    [
      ErrorReporter.make(({ error, severity, attributes }) => {
        Sentry.captureException(error, {
          mechanism: { type: "auto.function.effect.error_reporter", handled: false },
          captureContext: {
            level: severity === "Fatal" || severity === "Warn" ? SEVERITY_LEVEL[severity] : "error",
            extra: { ...attributes },
          },
        });
      }),
    ],
    { mergeWithExisting: true },
  ),
  sentryTelemetry,
);

/** How long a run waits for its closing check-in to leave before it returns anyway. */
const CHECK_IN_FLUSH_MS = 2_000;

/** What Sentry has queued, sent; a flush that runs out of time drops nothing the run depends on. */
const checkInDelivered = Effect.asVoid(Effect.promise(() => Sentry.flush(CHECK_IN_FLUSH_MS)));

/** The monitor's config, sent with each check-in so Sentry creates or updates it (an upsert). */
function monitorConfig(monitor: CronMonitor): MonitorConfig {
  return {
    schedule: { type: "crontab", value: monitor.crontab },
    checkinMargin: monitor.checkInMarginMinutes,
    maxRuntime: monitor.maxRuntimeMinutes,
    failureIssueThreshold: monitor.failuresBeforeIssue,
    timezone: "Etc/UTC",
  };
}

/**
 * A job's runs as Sentry's Crons guide recommends checking them in: one
 * check-in as a run starts and one as it ends, `ok` or `error`, so Sentry
 * can tell a run that never started from one that ran too long. The closing
 * check-in is flushed before the run returns, because a function frozen once
 * it has answered would otherwise drop it and leave a good run marked missed.
 * A run the deployment could not start checks nothing in: its caller is
 * unauthenticated, and the missed check-in is what Sentry alerts on.
 */
export function sentryCronCheckIns(monitor: CronMonitor) {
  const config = monitorConfig(monitor);
  return {
    run: <A, E, R>(job: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.flatMap(
        Effect.sync(() =>
          Sentry.captureCheckIn({ monitorSlug: monitor.slug, status: "in_progress" }, config),
        ),
        (checkInId) =>
          Effect.onExit(job, (exit) =>
            Effect.sync(() => {
              Sentry.captureCheckIn(
                {
                  checkInId,
                  monitorSlug: monitor.slug,
                  status: Exit.isSuccess(exit) ? "ok" : "error",
                },
                config,
              );
            }).pipe(Effect.andThen(checkInDelivered)),
          ),
      ),
  };
}
