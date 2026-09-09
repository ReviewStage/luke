import * as Sentry from "@sentry/electron/main";
import {
  PRODUCT_EVENT,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@sidecar/analytics";
import type { FeedbackResult, FeedbackSubmission } from "@sidecar/feedback";
import { feedbackDeliveryFromEnvironment } from "@sidecar/feedback";
import { type RunMode, sentryReportingEnabled } from "@sidecar/host";
import type { DesktopConfig } from "./desktop-config";
import type { DesktopService } from "./service";

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

export interface TelemetryService extends DesktopService {
  /**
   * A counted event, whose name and every property value the allowlist in
   * `@sidecar/analytics` fixed. It travels to Luke's own service through the
   * host, never to an analytics provider from here.
   */
  readonly recordProductEvent: RecordProductEvent;
  deliverFeedback: (submission: FeedbackSubmission) => Promise<FeedbackResult>;
}

export interface TelemetryServiceDependencies {
  config: DesktopConfig;
  /** The one way a counted event leaves this process: the host's own stream, through the operator. */
  recordEvent: RecordProductEvent;
}

/** Everything that leaves this process and is not the Gateway: the crash stream, the counted events, the feedback courier. */
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
    deliverFeedback: async (submission) => {
      if (!config.runMode.sendsNetwork) {
        return { delivered: false, reason: "A fixture run sends nothing." };
      }
      const result = await feedbackDelivery.deliver(submission);
      if (result.delivered) {
        recordProductEvent(PRODUCT_EVENT.FEEDBACK_SEND, {
          image_count: productSessionCountBucket(submission.images.length),
        });
      }
      return result;
    },
    start: async () => undefined,
    // A report queued when the quit began would otherwise go with the
    // process; the flush is bounded so it cannot be what holds one open.
    stop: async () => {
      await Sentry.close(CRASH_REPORT_FLUSH_MS);
    },
  };
}
