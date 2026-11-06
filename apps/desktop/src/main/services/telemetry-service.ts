import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  PRODUCT_EVENT,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@repo/features/analytics";
import type { FeedbackResult, FeedbackSubmission } from "@repo/features/feedback";
import { feedbackDeliveryFromEnvironment } from "@repo/features/feedback";
import { sentryUser } from "@repo/features/sentry-account";
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@repo/features/sentry-breadcrumbs";
import { type SentryCapture, sentryReporterLayer } from "@repo/features/sentry-reporting";
import {
  SENTRY_PROFILE_SESSION_SAMPLE_RATE,
  SENTRY_TRACES_SAMPLE_RATE,
} from "@repo/features/sentry-tracing";
import { type RunMode, sentryReportingEnabled } from "@repo/host";
import type { AppStateStore } from "@repo/host/client";
import type { EffectDesktopService } from "@repo/host/desktop-service";
import type { SentryEnvironment } from "@repo/host/sentry-environment";
import * as Sentry from "@sentry/electron/main";
import { Effect, Exit, type Layer, Scope, Stream } from "effect";
import {
  type CpuSummary,
  sampleProcessCpu,
  sampleWindowMemory,
  type UnresponsiveEpisode,
  type WorkingSetCrossing,
} from "../window/renderer-health";
import type { DesktopConfig } from "./desktop-config";

const CRASH_REPORT_FLUSH_MS = 2_000;

declare const PACKAGED_SENTRY_DSN: string;
declare const PACKAGED_SENTRY_RELEASE: string;

export function initializeCrashReporting(runMode: RunMode, environment: SentryEnvironment): void {
  Sentry.init({
    dsn: PACKAGED_SENTRY_DSN,
    enabled: sentryReportingEnabled(runMode.sendsNetwork, PACKAGED_SENTRY_DSN),
    release: PACKAGED_SENTRY_RELEASE,
    environment,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    enableRendererProfiling: Math.random() < SENTRY_PROFILE_SESSION_SAMPLE_RATE,
    integrations: [Sentry.startupTracingIntegration()],
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: Sentry.withStreamedSpan(spanWithoutAccessTokens),
  });
}

export const mainSentry: SentryCapture = {
  captureException: Sentry.captureException,
  flush: Sentry.flush,
};

export const mainErrorReporting: Layer.Layer<never> = sentryReporterLayer(mainSentry);

export function followAccountInReports(
  state: AppStateStore,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    Effect.forkScoped(
      state.changes.pipe(
        Stream.map((document) => signedInAccountId(document.account)),
        Stream.changes,
        Stream.runForEach((accountId) => Effect.sync(() => Sentry.setUser(sentryUser(accountId)))),
      ),
    ),
  );
}

export function reportUnresponsivePanel(episode: UnresponsiveEpisode): Effect.Effect<void> {
  return Effect.sync(() => {
    Sentry.captureEvent({
      level: "warning",
      message: "A panel window stopped responding",
      fingerprint: ["panel-unresponsive"],
      tags: {
        "window.document": episode.document,
        "unresponsive.recovered": episode.recovered,
      },
      contexts: {
        unresponsive: {
          duration_ms: episode.unresponsiveMs,
          working_set_bytes: episode.workingSetBytes ?? null,
          recovered: episode.recovered,
        },
      },
    });
  });
}

function noteWorkingSetCrossing(crossing: WorkingSetCrossing): void {
  Sentry.addBreadcrumb({
    category: "memory",
    level: "warning",
    message: "A window's working set crossed its bound",
    data: { document: crossing.document, working_set_bytes: crossing.workingSetBytes },
  });
}

function reportCpuSummary(summary: CpuSummary, appVersion: string): void {
  const attributes = {
    "process.type": summary.process,
    "window.state": summary.windowState,
    "agents.working": summary.workingAgents,
    "app.version": appVersion,
    "os.arch": process.arch,
  };
  Sentry.metrics.distribution("desktop.cpu.mean", summary.meanPercent, {
    unit: "percent",
    attributes,
  });
  Sentry.metrics.distribution("desktop.cpu.max", summary.maxPercent, {
    unit: "percent",
    attributes,
  });
}

export interface TelemetryService extends EffectDesktopService {
  readonly recordProductEvent: RecordProductEvent;
  deliverFeedback: (submission: FeedbackSubmission) => Effect.Effect<FeedbackResult>;
}

interface TelemetryServiceDependencies {
  config: DesktopConfig;
  recordEvent: RecordProductEvent;
  workingAgents: () => number;
}

export function createTelemetryService(
  dependencies: TelemetryServiceDependencies,
): TelemetryService {
  const { config } = dependencies;
  const feedbackDelivery = feedbackDeliveryFromEnvironment();
  const recordProductEvent: RecordProductEvent = (name, properties) =>
    dependencies.recordEvent(name, properties);
  const sampling = Scope.makeUnsafe();

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
    start: () =>
      Effect.andThen(
        Effect.forkIn(sampleWindowMemory(noteWorkingSetCrossing), sampling),
        Effect.forkIn(
          sampleProcessCpu(dependencies.workingAgents, (summary) =>
            reportCpuSummary(summary, config.appVersion),
          ),
          sampling,
        ),
      ).pipe(Effect.asVoid),
    stop: () =>
      Effect.andThen(
        Scope.close(sampling, Exit.void),
        Effect.asVoid(Effect.promise(() => Sentry.flush(CRASH_REPORT_FLUSH_MS))),
      ),
  };
}
