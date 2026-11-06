import { reportsOnceStarted } from "@repo/features/sentry-early-reports";
import type { ShownFailureSent } from "@repo/features/shown-failure";
import type { ShownFailureReporter } from "@repo/panel/failure-report";
import type { PanelSpanRecorder } from "@repo/panel/panel-spans";
import { queryClient } from "@repo/panel/query-client";

export const BLANK_WINDOW = { FIRST_READ: "first_read", RENDER: "render" } as const;
export type BlankWindow = (typeof BLANK_WINDOW)[keyof typeof BLANK_WINDOW];

export interface DesktopSentry {
  readonly reportBlankWindow: (error: Error, why: BlankWindow) => void;
  readonly recordSpan: PanelSpanRecorder;
  readonly reportShownFailure: ShownFailureReporter;
}

export interface DesktopSentryReports {
  readonly reportBlankWindow: (error: Error, why: BlankWindow) => void;
  readonly recordSpan: PanelSpanRecorder;
  readonly reportShownFailure: ShownFailureReporter;
  readonly load: () => void;
  readonly settled: Promise<void>;
}

const EARLY_REPORTS_KEPT = 20;

async function loadedSentry(): Promise<DesktopSentry | undefined> {
  try {
    const { initDesktopSentry } = await import("./desktop-sentry-sdk");
    return initDesktopSentry(queryClient);
  } catch (error) {
    console.warn("Sentry's SDK could not load; this window reports nothing.", error);
    return undefined;
  }
}

export function startDesktopSentry(): DesktopSentryReports {
  const asked = Promise.withResolvers<void>();
  const { say, settled } = reportsOnceStarted(asked.promise.then(loadedSentry), EARLY_REPORTS_KEPT);
  return {
    reportBlankWindow: (error, why) => {
      say((sentry) => sentry.reportBlankWindow(error, why));
    },
    recordSpan: (span) => {
      say((sentry) => sentry.recordSpan(span));
    },
    reportShownFailure: (report) => {
      let sent: ShownFailureSent | undefined;
      say((sentry) => {
        sent = sentry.reportShownFailure(report);
      });
      return sent;
    },
    load: () => asked.resolve(),
    settled,
  };
}
