/**
 * sentry.ts -- the deployment's Sentry, as Sentry's Effect and eve guides set it up: the options every process starts it with, and the layers that send it errors, spans, logs, and metrics.
 *
 * Sentry's Effect guide (docs.sentry.io/platforms/javascript/guides/effect)
 * composes `Sentry.effectLayer`, which starts the SDK and registers its
 * `ErrorReporter`, with the tracer, the logger, and the metrics layer. The web
 * functions take all of it, with the process's uncaught-exception and
 * unhandled-rejection handlers the Effect SDK leaves out, and send what they
 * queued after each answer (`sentryReportedFetch`), because Vercel may freeze
 * an instance as soon as it has answered. An eve root's process is started by eve's own
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

/** How a capture at a promise edge is marked: unhandled, since nothing past the edge was there to handle it. */
const PROMISE_EDGE_MECHANISM = { type: "luke.promise_edge", handled: false } as const;

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

/** The share of requests traced, in every process of this deployment. */
const TRACES_SAMPLE_RATE = 0.1;

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
    // Note that one in ten requests is traced, because each request carries
    // several Effect spans and every request came to about 140,000 spans an
    // hour in production, which a plan's span quota does not hold. Errors,
    // logs, and check-ins are not sampled by this.
    tracesSampleRate: TRACES_SAMPLE_RATE,
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
 * `Effect.withErrorReporting` are each captured, and so is an exception or a
 * rejection nothing in the process caught.
 *
 * Note that the two process handlers are added here rather than in
 * `sentryOptions`, because the Effect SDK's server `init` starts only its
 * context-lines and linked-errors integrations, while an eve root starts
 * `@sentry/node`'s full defaults from those same options, which already hold
 * both handlers.
 */
export function sentryLayer(options: SentryOptions = sentryOptions()): Layer.Layer<never> {
  const started = Sentry.effectLayer({
    ...options,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
  });
  return Layer.merge(started, sentryTelemetry);
}

/** How long an instance is kept awake after an answer for Sentry to send what it queued. */
const REQUEST_FLUSH_MS = 2_000;

/** A web function's handler, as the platform calls it. */
type WebFetch = (request: Request) => Promise<Response>;

/**
 * A web function's handler as Sentry watches it. What it throws, such as a
 * runtime whose layer could not be built, is captured before it is thrown on
 * to the platform. Once it has answered or thrown, what Sentry queued is sent,
 * and that sending is handed to `keepAwake` (Vercel's `waitUntil`) rather
 * than awaited, so the answer leaves at once and the instance is not frozen
 * before the report does.
 */
export function sentryReportedFetch(
  fetch: WebFetch,
  keepAwake: (sending: Promise<boolean>) => void,
): WebFetch {
  return async (request) => {
    try {
      return await fetch(request);
    } catch (failure) {
      Sentry.captureException(failure, {
        mechanism: { type: "auto.function.vercel", handled: false },
      });
      throw failure;
    } finally {
      keepAwake(Sentry.flush(REQUEST_FLUSH_MS));
    }
  };
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

/**
 * A service a promise edge stands for its instance's life, with no request
 * whose answer could carry its failure, so nothing it ends on is discarded.
 * Once the runner runs it, what ends it is reported through the runtime's
 * `ErrorReporter`, which captures a failure and a defect and passes over an
 * interruption. A runner that rejects without running it, as one whose
 * runtime could not be built does, is captured at the promise. The promise
 * settles either way, so the edge that stood the service carries on as it
 * would have without it.
 */
export function standReported<E, R>(
  run: (service: Effect.Effect<never, E, R>) => Promise<never>,
  service: Effect.Effect<never, E, R>,
): Promise<void> {
  let ran = false;
  const reported = Effect.suspend(() => {
    ran = true;
    return Effect.withErrorReporting(service);
  });
  return run(reported).catch((error) => {
    if (!ran) Sentry.captureException(error, { mechanism: PROMISE_EDGE_MECHANISM });
  });
}

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
