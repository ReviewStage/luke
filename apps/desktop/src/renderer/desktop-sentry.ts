/**
 * desktop-sentry.ts -- a window's error and performance reports: Sentry's Electron renderer SDK, loaded and started once the window has drawn, on the web tab's terms.
 *
 * Note that the SDK is a chunk of its own (`desktop-sentry-sdk.ts`), loaded
 * when the window's root asks, once its first paint is done, rather than
 * parsed and started before the root draws, because every window, the
 * panels, the voice window, and the call window alike, would otherwise pay
 * for it on its way to its first paint. The web tab loads its own the same
 * way (`apps/web/src/app/web-sentry.ts`). What is reported before it lands,
 * a window whose state could not be read, is kept for it, a few at most, and
 * sent once it stands (`@luke/features/sentry-early-reports`).
 *
 * The SDK's tracing starts the window's page load at the document's own
 * start, and reads the page's web vitals from what the browser buffered,
 * so a page load traced after the first paint still measures from the
 * beginning. What it does not see is an error thrown before it stands,
 * which no global handler of its own was there to catch.
 */

import { reportsOnceStarted } from "@luke/features/sentry-early-reports";

/** What the window reports through once the SDK stands. */
export interface DesktopSentry {
  /** Reports a window whose state could not be read, so nothing is drawn. */
  readonly reportBlankWindow: (error: Error) => void;
}

/** What the window reports through from the moment it starts, whether the SDK stands yet or not. */
export interface DesktopSentryReports {
  /** Reports a window that could draw nothing. */
  readonly reportBlankWindow: (error: Error) => void;
  /** Loads and starts the SDK, once however often it is asked. */
  readonly load: () => void;
  /** Settles once the SDK stands, or never will, and what was said before then was sent or dropped. */
  readonly settled: Promise<void>;
}

/**
 * How many reports said before the SDK's chunk lands are kept for it; the
 * rest are dropped, as the web tab drops its own.
 */
const EARLY_REPORTS_KEPT = 20;

/** Loads and starts the SDK, answering nothing where it could not load, which leaves the window running and reporting nothing. */
async function loadedSentry(): Promise<DesktopSentry | undefined> {
  try {
    const { initDesktopSentry } = await import("./desktop-sentry-sdk");
    return initDesktopSentry();
  } catch (error) {
    console.warn("Sentry's SDK could not load; this window reports nothing.", error);
    return undefined;
  }
}

/**
 * Answers at once what the window reports through, loading nothing until
 * `load` is called: every report said before the SDK stands is kept for it,
 * up to a few, and an SDK that could not load drops them all.
 */
export function startDesktopSentry(): DesktopSentryReports {
  const asked = Promise.withResolvers<void>();
  const { say, settled } = reportsOnceStarted(asked.promise.then(loadedSentry), EARLY_REPORTS_KEPT);
  return {
    reportBlankWindow: (error) => {
      say((sentry) => sentry.reportBlankWindow(error));
    },
    load: () => asked.resolve(),
    settled,
  };
}
