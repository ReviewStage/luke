import {
  PRODUCT_EVENT,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@luke/features/analytics";
import type { FeedbackResult, FeedbackSubmission } from "@luke/features/feedback";
import { feedbackDeliveryFromEnvironment } from "@luke/features/feedback";
import { type SentryCapture, sentryReporterLayer } from "@luke/features/sentry-reporting";
import { SENTRY_TRACES_SAMPLE_RATE } from "@luke/features/sentry-tracing";
import { type RunMode, sentryReportingEnabled } from "@luke/host";
import type { EffectDesktopService } from "@luke/host/desktop-service";
import type { SentryEnvironment } from "@luke/host/sentry-environment";
import * as Sentry from "@sentry/electron/main";
import { Effect, type Layer } from "effect";
import {
  eventWithoutAccessTokens,
  transactionWithoutAccessTokens,
  withoutAccessTokens,
} from "#shared/sentry-breadcrumbs";
import type { DesktopConfig } from "./desktop-config";

/** How long the quit waits for a queued crash report to leave; a flush must not hold a quit. */
const CRASH_REPORT_FLUSH_MS = 2_000;

declare const PACKAGED_SENTRY_DSN: string;
/**
 * `Luke@X.Y.Z`, the release `build.mjs` uploads this bundle's source maps
 * under, baked from that same string. Note that the SDK's own default is the
 * app's name, which is `Luke Dev` or `Luke Test` outside a Developer ID
 * build, so a report from one would name a release no map was uploaded to;
 * which build it was is the environment's to say instead.
 */
declare const PACKAGED_SENTRY_RELEASE: string;

/**
 * Crash reporting, begun at the entry rather than inside `start`: Electron
 * spawns its GPU process during bootstrap, and the crash reporter has to
 * stand before a child process it is to file a minidump for. The one
 * ordering this owes is the paths' — the reporter writes its own state under
 * Luke's `userData` — so the entry calls this immediately after moving them
 * and before anything else of the composition exists.
 *
 * Main reports on behalf of every renderer, so what leaves goes through the
 * same token filters as the preload's and the renderers' own.
 */
export function initializeCrashReporting(runMode: RunMode, environment: SentryEnvironment): void {
  Sentry.init({
    dsn: PACKAGED_SENTRY_DSN,
    enabled: sentryReportingEnabled(runMode.sendsNetwork, PACKAGED_SENTRY_DSN),
    release: PACKAGED_SENTRY_RELEASE,
    environment,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    integrations: [Sentry.startupTracingIntegration()],
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    beforeSendTransaction: transactionWithoutAccessTokens,
  });
}

/**
 * Main's Sentry, as a failed launch reports through it. What it captures
 * passes the `beforeSend` above, so the token filters hold on it too.
 */
export const mainSentry: SentryCapture = {
  captureException: Sentry.captureException,
  flush: Sentry.flush,
};

/**
 * Every Effect failure a boundary of main's runtime reports, captured
 * through main's Sentry: the composition provides it beneath every service
 * and the host, so their fibers and the acts' runs all report through it.
 */
export const mainErrorReporting: Layer.Layer<never> = sentryReporterLayer(mainSentry);

export interface TelemetryService extends EffectDesktopService {
  /**
   * A counted event, whose name and every property value the allowlist in
   * `@luke/features/analytics` fixed. It travels to Luke's own service through the
   * host, never to an analytics provider from here.
   */
  readonly recordProductEvent: RecordProductEvent;
  /** A feedback send, as the delivery answers it: the composer's act row runs this effect, never a promise this file built for itself. */
  deliverFeedback: (submission: FeedbackSubmission) => Effect.Effect<FeedbackResult>;
}

interface TelemetryServiceDependencies {
  config: DesktopConfig;
  /** The one way a counted event leaves this process: the host's own stream, through the operator. */
  recordEvent: RecordProductEvent;
}

/** Everything that leaves this process and is not the Gateway: the crash stream, the counted events, the feedback delivery. */
export function createTelemetryService(
  dependencies: TelemetryServiceDependencies,
): TelemetryService {
  const { config } = dependencies;
  const feedbackDelivery = feedbackDeliveryFromEnvironment();
  const recordProductEvent: RecordProductEvent = (name, properties) =>
    dependencies.recordEvent(name, properties);

  return {
    name: "telemetry",
    recordProductEvent,
    deliverFeedback: (submission) => {
      if (!config.runMode.sendsNetwork) {
        return Effect.succeed({ delivered: false, reason: "A fixture run sends nothing." });
      }
      return Effect.tap(feedbackDelivery.deliver(submission), (result) =>
        result.delivered
          ? Effect.sync(() => {
              recordProductEvent(PRODUCT_EVENT.FEEDBACK_SEND, {
                image_count: productSessionCountBucket(submission.images.length),
              });
            })
          : Effect.void,
      );
    },
    start: () => Effect.void,
    // A report queued when the quit began would otherwise go with the
    // process; the flush is bounded so it cannot be what holds one open.
    // Note that it flushes rather than closes, because a launch that fails
    // after this service started runs this stop before the entry captures
    // the failure, and a closed client would drop that report; so would it
    // every defect a later stop of the same quit reports.
    stop: () => Effect.asVoid(Effect.promise(() => Sentry.flush(CRASH_REPORT_FLUSH_MS))),
  };
}
