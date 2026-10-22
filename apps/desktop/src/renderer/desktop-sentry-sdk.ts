/**
 * desktop-sentry-sdk.ts -- the chunk `desktop-sentry.ts` loads once a window has drawn: Sentry's Electron renderer SDK, started as Sentry's Electron guide sets up a renderer.
 *
 * A module of its own, naming what it uses of the SDK, so the bundler keeps
 * only that in the chunk, and no window's entry carries any of it.
 */

import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@luke/features/sentry-breadcrumbs";
import { SENTRY_TRACES_SAMPLE_RATE, sentryTracesRequest } from "@luke/features/sentry-tracing";
import {
  browserTracingIntegration,
  captureException,
  eventLoopBlockIntegration,
  init,
  startInactiveSpan,
  startNewTrace,
  withStreamedSpan,
} from "@sentry/electron/renderer";
import {
  BLANK_WINDOW,
  type BlankWindow,
  type DesktopSentry,
  type DesktopSentryOptions,
} from "./desktop-sentry";

/** The mechanism each blank window's report names, so Sentry's issue says which path caught it. */
const BLANK_WINDOW_MECHANISM = {
  [BLANK_WINDOW.FIRST_READ]: { type: "auto.electron.renderer.first_read", handled: false },
  [BLANK_WINDOW.RENDER]: { type: "auto.electron.renderer.render", handled: false },
} as const satisfies Record<BlankWindow, { readonly type: string; readonly handled: false }>;

/**
 * How long the panel's page may be held busy before main reports it frozen:
 * a second, past any frame a person would call slow and short of a hang.
 */
const FREEZE_THRESHOLD_MS = 1_000;

/** The op every span the panel timed is listed under. */
const PANEL_SPAN_OP = "ui.panel";

/**
 * Starts the window's SDK with its default data collection and the
 * renderer's filters: a breadcrumb or an event that names an access token is
 * dropped whole, and so is a span that names one as it starts, while every
 * span sent has its addresses scrubbed (`@luke/features/sentry-breadcrumbs`).
 * The DSN, release, and environment are main's, which every renderer event
 * goes through, and its reports reach main as requests of their own, which
 * are never traced (`sentryTracesRequest`).
 *
 * Tracing keeps long animation frames, which name the script that held a
 * slow frame, and Interaction to Next Paint, which the SDK's web vitals
 * report by default. The panel alone also has its page watched for
 * freezes: main's SDK, whose default integrations include the renderer's
 * watchdog, reports a page held busy past the threshold, with its stack.
 */
export function initDesktopSentry(options: DesktopSentryOptions): DesktopSentry {
  init({
    integrations: [
      browserTracingIntegration({
        shouldCreateSpanForRequest: sentryTracesRequest,
        enableLongAnimationFrame: true,
      }),
      ...(options.reportsFreezes
        ? [eventLoopBlockIntegration({ threshold: FREEZE_THRESHOLD_MS })]
        : []),
    ],
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: withStreamedSpan(spanWithoutAccessTokens),
  });
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
  };
}
