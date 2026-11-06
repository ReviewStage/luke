import path from "node:path";
import { withoutAccessTokens } from "@repo/features/sentry-breadcrumbs";
import { app, type BrowserWindow } from "electron";

function documentName(url: string): string {
  return URL.canParse(url) ? path.posix.basename(new URL(url).pathname) : url;
}

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
