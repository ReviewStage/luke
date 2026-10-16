/**
 * renderer-errors.ts -- a development build's renderer errors, written to the terminal the run was started from.
 *
 * A window's console is its own: nothing a page logs reaches the main
 * process's stderr, so an error that left a window half drawn says nothing in
 * the log of the run that drew it. A development build hands each error a
 * window's page logs to the reporter main writes its own lines through,
 * naming the document it came from, since the panels, the voice window, and
 * the call window all run the one bundle. Only errors cross: a warning or a
 * log line is the page's to keep, and DevTools shows it.
 *
 * Note that an error naming an access token is withheld whole, as Sentry's
 * breadcrumbs withhold it (`sentry-breadcrumbs.ts`), because a run's output
 * is teed to files that are shared and quoted: the line says an error
 * happened and where, and nothing of its words.
 */

import path from "node:path";
import { app, type BrowserWindow } from "electron";
import { withoutAccessTokens } from "#shared/sentry-breadcrumbs";

/** The document a window's page is, by its file's name: `index.html`, `voice.html`, or `call.html`. */
function documentName(url: string): string {
  return URL.canParse(url) ? path.posix.basename(new URL(url).pathname) : url;
}

/** Hands every error the window's page logs to the reporter while `reporting` says to. */
function reportErrorsOf(
  window: BrowserWindow,
  report: (line: string) => void,
  reporting: () => boolean,
): void {
  const contents = window.webContents;
  contents.on("console-message", (details) => {
    if (details.level !== "error" || !reporting()) return;
    const page = documentName(contents.getURL());
    const crumb = withoutAccessTokens({
      message: details.message,
      data: { url: details.sourceId },
    });
    if (crumb === null) {
      report(`renderer error in ${page}, withheld because it names an access token`);
      return;
    }
    const source = `${documentName(details.sourceId)}:${details.lineNumber}`;
    report(`renderer error in ${page}: ${details.message} (${source})`);
  });
}

/**
 * Reports the errors of every window opened from now on, and answers what
 * stops it, for the windows already open as for those to come. The caller
 * decides the build: a packaged one calls nothing.
 */
export function reportRendererErrors(report: (line: string) => void): () => void {
  let reporting = true;
  const opened = (_event: Electron.Event, window: BrowserWindow) =>
    reportErrorsOf(window, report, () => reporting);
  app.on("browser-window-created", opened);
  return () => {
    reporting = false;
    app.removeListener("browser-window-created", opened);
  };
}
