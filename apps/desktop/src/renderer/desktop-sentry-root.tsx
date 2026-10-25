/**
 * desktop-sentry-root.tsx -- a window's React root, drawn so Sentry's SDK loads once the surface has committed, and so a surface that fails to render says so with Reload and is reported rather than lost.
 *
 * The SDK is a chunk of its own that a window loads once it has drawn
 * (`desktop-sentry.ts`). What starts the load is a passive effect beside the
 * surface, because `render` on a concurrent root returns before the commit
 * and a passive effect runs only once the commit is done; the idle callback
 * it arms then waits past the frame that paints it. A surface that throws
 * is caught by the error boundary it stands in, which draws its failure and
 * Reload in its place rather than leave the window blank, and the root's
 * caught-error handler reports it, kept for the SDK if it does not stand
 * yet, and loads the SDK at once; so does its uncaught-error handler, for
 * a throw no boundary stood above.
 */

import { ErrorBoundary } from "@luke/ui/error-boundary";
import { type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BLANK_WINDOW, type DesktopSentryReports } from "./desktop-sentry";

/** What a window whose surface failed to draw says over its Reload. */
export const WINDOW_FAILED = "This window could not be shown.";

/** Reload's press at a window's root: the window's page read again from the start, its first read and every chunk among it. */
export function reloadWindow(): void {
  location.reload();
}

/**
 * How long a window that has drawn waits for an idle moment before it loads
 * Sentry's SDK anyway, so a window that is never idle still reports.
 */
const SENTRY_LOAD_DEADLINE_MS = 2_000;

/**
 * Loads the SDK in the first idle moment after the commit it is part of.
 * Note that it waits on no animation frame, because the hidden voice window
 * draws none.
 */
function LoadAfterFirstCommit({ load }: { readonly load: () => void }): null {
  useEffect(() => {
    const idle = requestIdleCallback(load, { timeout: SENTRY_LOAD_DEADLINE_MS });
    return () => cancelIdleCallback(idle);
  }, [load]);
  return null;
}

/**
 * Creates the window's root in `element`, answering how to draw a surface
 * into it: beside the surface, what loads the SDK once it has committed;
 * around it, the boundary that draws its failure with Reload; and under it,
 * the report of a surface that failed to render.
 */
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
  // Note that both stand in for React's defaults, which say a failure on the
  // console, or to the window as an uncaught error, before the SDK could
  // stand to hear it.
  const root = createRoot(element, { onCaughtError: report, onUncaughtError: report });
  return (surface) => {
    root.render(
      <>
        <ErrorBoundary failure={WINDOW_FAILED} onReload={reloadWindow}>
          {surface}
        </ErrorBoundary>
        <LoadAfterFirstCommit load={sentry.load} />
      </>,
    );
  };
}
