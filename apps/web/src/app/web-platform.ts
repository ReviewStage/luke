/**
 * web-platform.ts -- what a browser tab answers for the panel: its own clipboard, a download, a new tab for a web address, the host's event count, the masked session recording, the Mac app on a Mac, and nothing for the Mac's menus or bundles.
 *
 * The web client's shell beside the host in the tab (`web-host.ts`), which
 * hands it where a surface event is counted. An agent's page has no
 * sandboxed origin of its own on the web yet, so every page's frame shows
 * one static page saying it opens in the Mac app.
 */

import { inAppScheme, LINK_ORIGIN } from "@luke/features/link-home";
import { LINK_PLATFORM, type LinkPlatform } from "@luke/features/link-open";
import { openTargetOf } from "@luke/features/open-address";
import { isWebAddress } from "@luke/host/acts";
import type { AppPlatform } from "@luke/panel/app-platform";
import type { ShellBundles } from "@luke/panel/shell-bundles";
import { NOTIFICATIONS_GRANTOR } from "@luke/voice/settings-controls";
import { browserLinkPlatform } from "./mac-app-handoff";
import { askNotificationsPermission } from "./web-notices";

/**
 * Where the web serves the panel's static files, Excalidraw's fonts and the
 * harness marks, which the build emits there (`scripts/panel-build.ts`'s
 * `PANEL_ASSET_BASE`).
 */
const ASSET_BASE = "/app/";

/** What every agent's page frame shows until pages have a sandboxed origin of their own (`public/page-in-mac-app.html`). */
const PAGE_IN_MAC_APP = "/page-in-mac-app.html";

const ignore = (): void => undefined;

/**
 * The address of the file last downloaded, let go of once the next download
 * starts. Note that it is not let go of as its link is pressed, because a
 * browser may read it only once the download begins, after the press
 * returns, as Safari and Firefox can; the next download is a later press.
 */
let downloaded: string | undefined;

/** Saves the text as a file of the name given, through the browser's own download, letting go of the one before. */
export function downloadText(file: {
  readonly name: string;
  readonly text: string;
}): Promise<boolean> {
  if (downloaded !== undefined) URL.revokeObjectURL(downloaded);
  downloaded = URL.createObjectURL(new Blob([file.text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = downloaded;
  link.download = file.name;
  link.click();
  return Promise.resolve(true);
}

/**
 * Opens a page in a tab of its own, which reaches nothing of this one, where
 * its address is an http or https one, as the desktop's `web.open` takes it.
 * Any other opens nothing, because a `javascript:` or `data:` address would
 * run as script on this origin, and another app's scheme hand it to that app.
 */
export function openTab(url: string): void {
  if (!isWebAddress(url)) {
    console.warn("A link that is not an http or https address was not opened.");
    return;
  }
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
 * The tab's session replay, whose controller and masking
 * (`web-session-replay.ts`) are a chunk of their own that the entry leaves
 * out, loaded the first time the host lets the tab record. Each word on
 * recording is handed on in the order it came, so one that stands recording
 * down while the chunk loads still lands after the one that started it; a
 * word before that, which can only be no, has nothing to stand down. A chunk
 * that fails to load is tried again on the next word that lets the tab record.
 */
function lazySessionReplay(): AppPlatform["applySessionReplay"] {
  let recording: Promise<AppPlatform["applySessionReplay"]> | undefined;
  return (bootstrap) => {
    if (recording === undefined && !bootstrap.permitted) return;
    recording ??= import("./web-session-replay").then((module) => module.applyWebSessionReplay);
    void recording.then(
      (apply) => apply(bootstrap),
      () => {
        recording = undefined;
      },
    );
  };
}

/**
 * The tab's platform. A browser has no menu bar and no global keys, so those
 * answer nothing; focus is the tab's own, so bringing the panel forward is
 * asking the window for it; a surface event is counted by the host in the
 * tab, as every other event is; notifications are the browser's to grant,
 * for the site, asked for on Settings' press itself; unsaved work is held
 * by the tab's ways out (`page-leave.ts`); session replay is the desktop's
 * own masked recording (`web-session-replay.ts`); and the way to the Mac
 * app is offered only on the `linkPlatform` that can open it, a Mac.
 */
export function webPlatform(
  shell: Pick<AppPlatform, "recordSurfaceEvent" | "unsavedWork">,
  linkPlatform: LinkPlatform = browserLinkPlatform(),
): AppPlatform {
  const platform: AppPlatform = {
    copyText: (words) => navigator.clipboard.writeText(words),
    saveFile: downloadText,
    focusPanel: () => window.focus(),
    pageFrameUrl: () => new URL(PAGE_IN_MAC_APP, location.origin).href,
    assetBase: () => new URL(ASSET_BASE, location.origin).href,
    onMenuCommand: () => ignore,
    setShortcutCapturing: ignore,
    recordSurfaceEvent: shell.recordSurfaceEvent,
    openGitHub: openTab,
    openWeb: openTab,
    applySessionReplay: lazySessionReplay(),
    ...(linkPlatform === LINK_PLATFORM.MAC ? { macAppLink } : undefined),
    notificationsGrantor: () => NOTIFICATIONS_GRANTOR.BROWSER,
    askNotificationsPermission: () => {
      void askNotificationsPermission();
    },
  };
  // A tab with no page leave to tell (a test's) holds nothing back.
  if (shell.unsavedWork !== undefined) platform.unsavedWork = shell.unsavedWork;
  return platform;
}

/** A call's avatar is the desktop's bundle, which the web does not ship. */
export const WEB_BUNDLES: ShellBundles = {
  avatarSession: () => Promise.reject(new Error("The web runs no avatar.")),
};
