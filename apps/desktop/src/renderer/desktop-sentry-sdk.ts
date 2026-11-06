import { signedInAccountId } from "@repo/credentials/snapshot";
import { logNamingAccount } from "@repo/features/sentry-account";
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@repo/features/sentry-breadcrumbs";
import { SENTRY_TRACES_SAMPLE_RATE, sentryTracesRequest } from "@repo/features/sentry-tracing";
import { sendShownFailure } from "@repo/features/shown-failure";
import { appStateQuery } from "@repo/panel/use-app-state";
import {
  browserProfilingIntegration,
  browserTracingIntegration,
  captureException,
  getActiveSpan,
  getCurrentScope,
  init,
  logger,
  startInactiveSpan,
  startNewTrace,
  uiProfiler,
  withStreamedSpan,
} from "@sentry/electron/renderer";
import type { QueryClient } from "@tanstack/react-query";
import { BLANK_WINDOW, type BlankWindow, type DesktopSentry } from "./desktop-sentry";

const BLANK_WINDOW_MECHANISM = {
  [BLANK_WINDOW.FIRST_READ]: { type: "auto.electron.renderer.first_read", handled: false },
  [BLANK_WINDOW.RENDER]: { type: "auto.electron.renderer.render", handled: false },
} as const satisfies Record<BlankWindow, { readonly type: string; readonly handled: false }>;

const PANEL_SPAN_OP = "ui.panel";

export function initDesktopSentry(queryClient: QueryClient): DesktopSentry {
  init({
    integrations: [
      browserTracingIntegration({
        shouldCreateSpanForRequest: sentryTracesRequest,
        enableLongAnimationFrame: true,
      }),
      browserProfilingIntegration(),
    ],
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
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
    reportShownFailure: (report) =>
      sendShownFailure({ captureException, logger, getActiveSpan, getCurrentScope }, report),
  };
}
