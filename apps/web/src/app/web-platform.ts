/**
 * web-platform.ts -- what a browser tab answers for the panel, for now: its own clipboard, a download, a new tab, and nothing for the Mac's menus or bundles.
 *
 * The first cut of the web shell, enough for the panel to draw in a tab
 * (`web-root.tsx`). The web client's own platform, with its counted events
 * and its framed pages, replaces it.
 */

import type { AppPlatform } from "@luke/panel/app-platform";
import type { ShellBundles } from "@luke/panel/shell-bundles";

/**
 * Where the web serves the panel's static files, Excalidraw's fonts and the
 * harness marks, which the build emits there (`scripts/panel-build.ts`'s
 * `PANEL_ASSET_BASE`).
 */
const ASSET_BASE = "/app/";

/** Where an agent's page will be framed from, on the web's own origin. */
const FRAME_PATH = "/frame/";

const ignore = (): void => undefined;

/** Saves the text as a file of the name given, through the browser's own download. */
function downloadText(file: { readonly name: string; readonly text: string }): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([file.text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
  return Promise.resolve(true);
}

/** Opens a page in a tab of its own, which reaches nothing of this one. */
function openTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The tab's platform. A browser has no menu bar, no global keys, and no
 * session recording here, so those answer nothing; and focus is the tab's
 * own, so bringing the panel forward is asking the window for it.
 */
export const WEB_PLATFORM: AppPlatform = {
  copyText: (words) => navigator.clipboard.writeText(words),
  saveFile: downloadText,
  focusPanel: () => window.focus(),
  pageFrameUrl: (page) =>
    new URL(`${FRAME_PATH}${page.taskId}/${page.pageId}/${page.version}`, location.origin).href,
  assetBase: () => new URL(ASSET_BASE, location.origin).href,
  onMenuCommand: () => ignore,
  setShortcutCapturing: ignore,
  recordSurfaceEvent: ignore,
  openGitHub: openTab,
  openWeb: openTab,
  applySessionReplay: ignore,
};

/** A call's avatar is the desktop's bundle, which the web does not ship. */
export const WEB_BUNDLES: ShellBundles = {
  avatarSession: () => Promise.reject(new Error("The web runs no avatar.")),
};
