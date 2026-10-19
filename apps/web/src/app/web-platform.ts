/**
 * web-platform.ts -- what a browser tab answers for the panel: its own clipboard, a download, a new tab, the host's event count, and nothing for the Mac's menus or bundles.
 *
 * The web client's shell beside the host in the tab (`web-host.ts`), which
 * hands it where a surface event is counted. An agent's page has no
 * sandboxed origin of its own on the web yet, so every page's frame shows
 * one static page saying it opens in the Mac app.
 */

import { inAppScheme, LINK_ORIGIN } from "@luke/features/link-home";
import { openTargetOf } from "@luke/features/open-address";
import type { AppPlatform } from "@luke/panel/app-platform";
import type { ShellBundles } from "@luke/panel/shell-bundles";
import { NOTIFICATIONS_GRANTOR } from "@luke/voice/settings-controls";

/**
 * Where the web serves the panel's static files, Excalidraw's fonts and the
 * harness marks, which the build emits there (`scripts/panel-build.ts`'s
 * `PANEL_ASSET_BASE`).
 */
const ASSET_BASE = "/app/";

/** What every agent's page frame shows until pages have a sandboxed origin of their own (`public/page-in-mac-app.html`). */
const PAGE_IN_MAC_APP = "/page-in-mac-app.html";

const ignore = (): void => undefined;

/** Saves the text as a file of the name given, through the browser's own download. */
export function downloadText(file: {
  readonly name: string;
  readonly text: string;
}): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([file.text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
  return Promise.resolve(true);
}

/** Opens a page in a tab of its own, which reaches nothing of this one. */
export function openTab(url: string): void {
  window.open(url, "_blank", "noopener");
}

/**
 * The link that opens the Mac app on what the tab's address names, or on
 * Luke's home where it names nothing, which still brings the app forward.
 */
function macAppLink(): string {
  return (
    openTargetOf(location.pathname, location.hash, location.search)?.appLink ??
    inAppScheme(`${LINK_ORIGIN}/`)
  );
}

/**
 * The tab's platform. A browser has no menu bar, no global keys, and no
 * session recording here, so those answer nothing; focus is the tab's own,
 * so bringing the panel forward is asking the window for it; and a surface
 * event is counted by the host in the tab, as every other event is; and
 * notifications are the browser's to grant, for the site.
 */
export function webPlatform(counting: Pick<AppPlatform, "recordSurfaceEvent">): AppPlatform {
  return {
    copyText: (words) => navigator.clipboard.writeText(words),
    saveFile: downloadText,
    focusPanel: () => window.focus(),
    pageFrameUrl: () => new URL(PAGE_IN_MAC_APP, location.origin).href,
    assetBase: () => new URL(ASSET_BASE, location.origin).href,
    onMenuCommand: () => ignore,
    setShortcutCapturing: ignore,
    recordSurfaceEvent: counting.recordSurfaceEvent,
    openGitHub: openTab,
    openWeb: openTab,
    applySessionReplay: ignore,
    macAppLink,
    notificationsGrantor: () => NOTIFICATIONS_GRANTOR.BROWSER,
  };
}

/** A call's avatar is the desktop's bundle, which the web does not ship. */
export const WEB_BUNDLES: ShellBundles = {
  avatarSession: () => Promise.reject(new Error("The web runs no avatar.")),
};
