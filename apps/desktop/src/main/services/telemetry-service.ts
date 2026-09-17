import * as Sentry from "@sentry/electron/main";
import {
  PRODUCT_EVENT,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@sidecar/analytics";
import type { FeedbackResult, FeedbackSubmission } from "@sidecar/feedback";
import { feedbackDeliveryFromEnvironment } from "@sidecar/feedback";
import { type RunMode, sentryReportingEnabled } from "@sidecar/host";
import { Effect } from "effect";
import type { DesktopConfig } from "./desktop-config";
import type { EffectDesktopService } from "./service";

/** How long the quit waits for a queued crash report to leave; a flush must not hold a quit. */
const CRASH_REPORT_FLUSH_MS = 2_000;

declare const PACKAGED_SENTRY_DSN: string;

/**
 * Crash reporting, begun at the entry rather than inside `start`: Electron
 * spawns its GPU process during bootstrap, and the crash reporter has to
 * stand before a child process it is to file a minidump for. The one
 * ordering this owes is the paths' — the reporter writes its own state under
 * Luke's `userData` — so the entry calls this immediately after moving them
 * and before anything else of the composition exists.
 */
export function initializeCrashReporting(runMode: RunMode): void {
  Sentry.init({
    dsn: PACKAGED_SENTRY_DSN,
    enabled: sentryReportingEnabled(runMode.sendsNetwork, PACKAGED_SENTRY_DSN),
  });
}

export interface TelemetryService extends EffectDesktopService {
  /**
   * A counted event, whose name and every property value the allowlist in
   * `@sidecar/analytics` fixed. It travels to Luke's own service through the
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
    stop: () => Effect.asVoid(Effect.promise(() => Sentry.close(CRASH_REPORT_FLUSH_MS))),
  };
}
