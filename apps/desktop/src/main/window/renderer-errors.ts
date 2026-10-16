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
 */

import path from "node:path";
import { app, type BrowserWindow } from "electron";

/** The document a window's page is, by its file's name: `index.html`, `voice.html`, or `call.html`. */
function documentName(url: string): string {
  return URL.canParse(url) ? path.posix.basename(new URL(url).pathname) : url;
}

/** Hands every error the window's page logs to the reporter, from now until the window goes. */
function reportErrorsOf(window: BrowserWindow, report: (line: string) => void): void {
  const contents = window.webContents;
  contents.on("console-message", (details) => {
    if (details.level !== "error") return;
    const source = `${documentName(details.sourceId)}:${details.lineNumber}`;
    report(`renderer error in ${documentName(contents.getURL())}: ${details.message} (${source})`);
  });
}

/**
 * Reports the errors of every window opened from now on, and answers what
 * stops it. The caller decides the build: a packaged one calls nothing.
 */
export function reportRendererErrors(report: (line: string) => void): () => void {
  const opened = (_event: Electron.Event, window: BrowserWindow) => reportErrorsOf(window, report);
  app.on("browser-window-created", opened);
  return () => {
    app.removeListener("browser-window-created", opened);
  };
}
