/**
 * desktop-sentry-sdk.ts -- the chunk `desktop-sentry.ts` loads once a window has drawn: Sentry's Electron renderer SDK, started as Sentry's Electron guide sets up a renderer.
 *
 * A module of its own, naming what it uses of the SDK, so the bundler keeps
 * only that in the chunk, and no window's entry carries any of it.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { logNamingAccount } from "@repo/features/sentry-account";
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@repo/features/sentry-breadcrumbs";
import { sentryTracesRequest, sentryTracesSampler } from "@repo/features/sentry-tracing";
import { sendShownFailure } from "@repo/features/shown-failure";
import { sentrySendTracer } from "@repo/panel/send-traces";
import { appStateQuery } from "@repo/panel/use-app-state";
import {
  browserProfilingIntegration,
  browserTracingIntegration,
  captureException,
  getActiveSpan,
  getCurrentScope,
  getTraceData,
  init,
  logger,
  startInactiveSpan,
  startNewTrace,
  startSpan,
  uiProfiler,
  withStreamedSpan,
} from "@sentry/electron/renderer";
import type { QueryClient } from "@tanstack/react-query";
import { BLANK_WINDOW, type BlankWindow, type DesktopSentry } from "./desktop-sentry";

/** The mechanism each blank window's report names, so Sentry's issue says which path caught it. */
const BLANK_WINDOW_MECHANISM = {
  [BLANK_WINDOW.FIRST_READ]: { type: "auto.electron.renderer.first_read", handled: false },
  [BLANK_WINDOW.RENDER]: { type: "auto.electron.renderer.render", handled: false },
} as const satisfies Record<BlankWindow, { readonly type: string; readonly handled: false }>;

/** The op every span the panel timed is listed under. */
const PANEL_SPAN_OP = "ui.panel";

/**
 * Starts the window's SDK with its default data collection and the
 * renderer's filters: a breadcrumb or an event that names an access token is
 * dropped whole, and so is a span that names one as it starts, while every
 * span sent has its addresses scrubbed (`@repo/features/sentry-breadcrumbs`).
 * The DSN, release, and environment are main's, which every renderer event
 * goes through, and its reports reach main as requests of their own, which
 * are never traced (`sentryTracesRequest`).
 *
 * A failure the panel showed is sent as a Sentry log line, and as an issue
 * besides where nothing named it (`@repo/features/shown-failure`); the
 * window's logs reach Sentry through main, as its events do.
 *
 * Main names the signed-in account as its SDK's user, which every event the
 * window sends through it takes; a log line the window sends leaves with the
 * account read from the window's document as it does, and the window sets no
 * user of its own (`@repo/features/sentry-account`).
 *
 * Tracing keeps long animation frames, which name the script that held a
 * slow frame, and Interaction to Next Paint, which the SDK's web vitals
 * report by default. A page that hangs is main's to report, from Electron's
 * own word that it stopped answering (`main/window/renderer-health.ts`).
 * A send the developer presses is a span of its own, whose trace its act
 * carries to main, which sends it on to the service
 * (`@repo/panel/send-traces`), because main's own fetch tracing would carry
 * main's trace rather than the press's.
 *
 * The window profiles from the moment the SDK stands to its close, in
 * chunks of a minute, wherever main served its document with the profiling
 * policy, which it does for a sample of launches
 * (`SENTRY_PROFILE_SESSION_SAMPLE_RATE`); elsewhere the browser refuses the
 * profiler once and the SDK profiles nothing more. Note that it profiles the
 * whole session rather than only sampled traces, because a Mac running hot
 * is mostly the work no trace was open for. A profile is the panel's own
 * stack frames, function names and bundle paths, and none of a person's words.
 */
export function initDesktopSentry(queryClient: QueryClient): DesktopSentry {
  init({
    integrations: [
      browserTracingIntegration({
        shouldCreateSpanForRequest: sentryTracesRequest,
        enableLongAnimationFrame: true,
      }),
      browserProfilingIntegration(),
    ],
    tracesSampler: sentryTracesSampler,
    profileLifecycle: "manual",
    profileSessionSampleRate: 1,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    beforeSendLog: (log) =>
      logNamingAccount(
        log,
        signedInAccountId(queryClient.getQueryData(appStateQuery.queryKey)?.account),
      ),
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: withStreamedSpan(spanWithoutAccessTokens),
  });
  uiProfiler.startProfiler();
  return {
    reportBlankWindow: (error, why) => {
      captureException(error, { mechanism: BLANK_WINDOW_MECHANISM[why] });
    },
    // A trace of its own rather than a child of whatever is active, so each
    // is sampled at the window's rate on its own, whatever page load or
    // navigation stands; its attributes are read only where it is kept. Its
    // times go as dates, so the SDK never has to guess a number's unit.
    recordSpan: (span) => {
      startNewTrace(() => {
        const recorded = startInactiveSpan({
          name: span.name,
          op: PANEL_SPAN_OP,
          startTime: new Date(span.startedAt),
          parentSpan: null,
        });
        if (recorded.isRecording()) recorded.setAttributes(span.attributes());
        recorded.end(new Date(span.endedAt));
      });
    },
    // A send pressed, a span of its own whose trace its act carries to main and on to the service.
    traceSend: sentrySendTracer({ startNewTrace, startSpan, getTraceData }),
    // A log line through main, which sends what the window logs, and an issue where nothing named it.
    reportShownFailure: (report) =>
      sendShownFailure({ captureException, logger, getActiveSpan, getCurrentScope }, report),
  };
}
