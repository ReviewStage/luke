import { ADMIN_PAGE_PATH } from "@repo/features/admin-wire";
import { APP_HOME_LINK } from "@repo/features/link-home";
import { LINK_PLATFORM, type LinkPlatform } from "@repo/features/link-open";
import { openTargetOf } from "@repo/features/open-address";
import { hostedPageFramePath } from "@repo/features/page-frame";
import { isGitHubAddress, isMailAddress, isWebAddress } from "@repo/host/acts";
import type { AppPlatform } from "@repo/panel/app-platform";
import { COMMAND_KEY, type CommandKey } from "@repo/settings/shortcuts";
import { stopImpersonating } from "../auth-client";
import { browserLinkPlatform } from "../link-platform";
import { PANEL_ASSET_BASE } from "./web-address";
import { openBrowserLiveOverWebSocket } from "./web-browser-live";

const ignore = (): void => undefined;

type SystemNaming = Pick<Navigator, "platform"> & {
  readonly userAgentData?: { readonly platform: string };
};

let downloaded: string | undefined;

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

export function copyPng(png: Promise<string>): Promise<void> {
  const blob = png.then((base64) => {
    const bytes = Uint8Array.from(atob(base64), (each) => each.charCodeAt(0));
    return new Blob([bytes], { type: "image/png" });
  });
  return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export function openTab(url: string): void {
  if (!isWebAddress(url)) {
    console.warn("A link that is not an http or https address was not opened.");
    return;
  }
  window.open(url, "_blank", "noopener");
}

function openLink(url: string): void {
  if (isMailAddress(url)) {
    location.assign(url);
    return;
  }
  openTab(url);
}

function openGitHubTab(url: string): void {
  if (!isGitHubAddress(url)) {
    console.warn("A GitHub link whose address is not GitHub's was not opened.");
    return;
  }
  openTab(url);
}

function macAppLink(): string {
  return openTargetOf(location.pathname, location.hash, location.search)?.appLink ?? APP_HOME_LINK;
}

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

export function browserCommandKey(browser: SystemNaming = navigator): CommandKey {
  const system = browser.userAgentData?.platform ?? browser.platform;
  return /^(?:mac|iphone|ipad|ipod)/iu.test(system) ? COMMAND_KEY.META : COMMAND_KEY.CONTROL;
}

export function webPlatform(
  shell: Pick<AppPlatform, "recordSurfaceEvent" | "unsavedWork" | "unsavedDescriptionWords">,
  linkPlatform: LinkPlatform = browserLinkPlatform(),
  commandKey: CommandKey = browserCommandKey(),
): AppPlatform {
  const platform: AppPlatform = {
    commandKey,
    copyText: (words) => navigator.clipboard.writeText(words),
    copyImage: copyPng,
    saveFile: downloadText,
    focusPanel: () => window.focus(),
    pageFrameUrl: (page) => new URL(hostedPageFramePath(page), location.origin).href,
    assetBase: () => new URL(PANEL_ASSET_BASE, location.origin).href,
    onMenuCommand: () => ignore,
    recordSurfaceEvent: shell.recordSurfaceEvent,
    openGitHub: openGitHubTab,
    openWeb: openLink,
    adminDashboard: () => ({ href: new URL(ADMIN_PAGE_PATH, location.origin).href }),
    applySessionReplay: lazySessionReplay(),
    openBrowserLive: openBrowserLiveOverWebSocket,
    stopImpersonating,
    ...(linkPlatform === LINK_PLATFORM.MAC ? { macAppLink } : undefined),
  };
  if (shell.unsavedWork !== undefined) platform.unsavedWork = shell.unsavedWork;
  if (shell.unsavedDescriptionWords !== undefined)
    platform.unsavedDescriptionWords = shell.unsavedDescriptionWords;
  return platform;
}
