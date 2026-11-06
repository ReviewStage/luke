import { ErrorBoundary, RELOAD_ROOM } from "@repo/ui/error-boundary";
import { type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BLANK_WINDOW, type DesktopSentryReports } from "./desktop-sentry";

export const WINDOW_FAILED = "This window could not be shown.";

export function reloadWindow(): void {
  location.reload();
}

const SENTRY_LOAD_DEADLINE_MS = 2_000;

function LoadAfterFirstCommit({ load }: { readonly load: () => void }): null {
  useEffect(() => {
    const idle = requestIdleCallback(load, { timeout: SENTRY_LOAD_DEADLINE_MS });
    return () => cancelIdleCallback(idle);
  }, [load]);
  return null;
}

export function createReportingRoot(
  element: HTMLElement,
  sentry: DesktopSentryReports,
): (surface: ReactNode) => void {
  const report = (thrown: unknown): void => {
    console.error("The window's surface failed to render.", thrown);
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    sentry.reportBlankWindow(error, BLANK_WINDOW.RENDER);
    sentry.load();
  };
  const root = createRoot(element, { onCaughtError: report, onUncaughtError: report });
  return (surface) => {
    root.render(
      <>
        <ErrorBoundary failure={WINDOW_FAILED} room={RELOAD_ROOM.WINDOW} onReload={reloadWindow}>
          {surface}
        </ErrorBoundary>
        <LoadAfterFirstCommit load={sentry.load} />
      </>,
    );
  };
}
