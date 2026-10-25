/**
 * web-platform.ts -- what a browser tab answers for the panel: its own clipboard, a download, a new tab for a web address, the host's event count, the masked session recording, a cloud Browser tab's socket from the page, the Mac app on a Mac, and nothing for the Mac's menus or bundles.
 *
 * The web client's shell beside the host in the tab (`web-host.ts`), which
 * hands it where a surface event is counted. An agent's page has no
 * sandboxed origin of its own on the web yet, so every page's frame shows
 * one static page saying it opens in the Mac app.
 */

import { ADMIN_PAGE_PATH } from "@luke/features/admin-wire";
import { APP_HOME_LINK } from "@luke/features/link-home";
import { LINK_PLATFORM, type LinkPlatform } from "@luke/features/link-open";
import { openTargetOf } from "@luke/features/open-address";
import { isGitHubAddress, isWebAddress } from "@luke/host/acts";
import type { AppPlatform } from "@luke/panel/app-platform";
import type { ShellBundles } from "@luke/panel/shell-bundles";
import { COMMAND_KEY, type CommandKey } from "@luke/settings/shortcuts";
import { browserLinkPlatform } from "../link-platform";
import { PANEL_ASSET_BASE } from "./web-address";
import { openBrowserLiveOverWebSocket } from "./web-browser-live";

/** What every agent's page frame shows until pages have a sandboxed origin of their own (`public/page-in-mac-app.html`). */
const PAGE_IN_MAC_APP = "/page-in-mac-app.html";

const ignore = (): void => undefined;

/** A browser's `navigator` as far as it names its system: `userAgentData`, where the browser has it, is in no DOM type yet. */
type SystemNaming = Pick<Navigator, "platform"> & {
  readonly userAgentData?: { readonly platform: string };
};

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
 * Puts a PNG, its bytes in base64 once drawn, on the browser's clipboard as
 * a picture. Note that the write is asked for now, with the picture still a
 * promise, because Safari takes a write only in the press's own task.
 */
export function copyPng(png: Promise<string>): Promise<void> {
  const blob = png.then((base64) => {
    const bytes = Uint8Array.from(atob(base64), (each) => each.charCodeAt(0));
    return new Blob([bytes], { type: "image/png" });
  });
  return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
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

/** Opens a GitHub page in a tab of its own, where its address is GitHub's, as the desktop's `github.open` takes it; any other opens nothing. */
function openGitHubTab(url: string): void {
  if (!isGitHubAddress(url)) {
    console.warn("A GitHub link whose address is not GitHub's was not opened.");
    return;
  }
  openTab(url);
}

/**
 * The link that opens the Mac app on what the tab's address names, or on
 * Luke's home where it names nothing, which still brings the app forward.
 */
function macAppLink(): string {
  return openTargetOf(location.pathname, location.hash, location.search)?.appLink ?? APP_HOME_LINK;
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
 * The key a chord's Command is pressed with in this browser: ⌘ on Apple's
 * systems, an iPad's keyboard among them, and Ctrl on every other, read from
 * the system the browser names, `userAgentData`'s where it has one and the
 * older `platform` where it does not.
 */
export function browserCommandKey(browser: SystemNaming = navigator): CommandKey {
  const system = browser.userAgentData?.platform ?? browser.platform;
  return /^(?:mac|iphone|ipad|ipod)/iu.test(system) ? COMMAND_KEY.META : COMMAND_KEY.CONTROL;
}

/**
 * The tab's platform. A browser has no menu bar, so that answers nothing; focus is the tab's own, so bringing the panel forward is
 * asking the window for it; a surface event is counted by the host in the
 * tab, as every other event is; unsaved work is held
 * by the tab's ways out (`page-leave.ts`); session replay is the desktop's
 * own masked recording (`web-session-replay.ts`); a cloud Browser tab's
 * live view is a socket the page opens itself (`web-browser-live.ts`); and the way to the Mac
 * app is offered only on the `linkPlatform` that can open it, a Mac; and a
 * chord's Command is pressed with the browser's own `commandKey`, Ctrl off a Mac.
 */
export function webPlatform(
  shell: Pick<AppPlatform, "recordSurfaceEvent" | "unsavedWork" | "unsavedPlanWords">,
  linkPlatform: LinkPlatform = browserLinkPlatform(),
  commandKey: CommandKey = browserCommandKey(),
): AppPlatform {
  const platform: AppPlatform = {
    commandKey,
    copyText: (words) => navigator.clipboard.writeText(words),
    copyImage: copyPng,
    saveFile: downloadText,
    focusPanel: () => window.focus(),
    pageFrameUrl: () => new URL(PAGE_IN_MAC_APP, location.origin).href,
    assetBase: () => new URL(PANEL_ASSET_BASE, location.origin).href,
    onMenuCommand: () => ignore,
    recordSurfaceEvent: shell.recordSurfaceEvent,
    openGitHub: openGitHubTab,
    openWeb: openTab,
    // The dashboard is served on the tab's own origin, so the Admin row links to it there.
    adminDashboard: () => ({ href: new URL(ADMIN_PAGE_PATH, location.origin).href }),
    applySessionReplay: lazySessionReplay(),
    openBrowserLive: openBrowserLiveOverWebSocket,
    ...(linkPlatform === LINK_PLATFORM.MAC ? { macAppLink } : undefined),
  };
  // A tab with no page leave to tell (a test's) holds nothing back.
  if (shell.unsavedWork !== undefined) platform.unsavedWork = shell.unsavedWork;
  if (shell.unsavedPlanWords !== undefined) platform.unsavedPlanWords = shell.unsavedPlanWords;
  return platform;
}

/** A call's avatar is the desktop's bundle, which the web does not ship. */
export const WEB_BUNDLES: ShellBundles = {
  avatarSession: () => Promise.reject(new Error("The web runs no avatar.")),
};
