import { pageFrameUrl } from "@repo/features/page-frame";
import { ACT_KIND } from "@repo/host/acts";
import { pressAct } from "../act.js";
import type { AppPlatform } from "../app-platform.js";
import { installAppPlatform } from "../app-platform.js";

export const QUIET_PANEL: Pick<
  AppPlatform,
  "onMenuCommand" | "recordSurfaceEvent" | "assetBase" | "adminDashboard" | "pageFrameUrl"
> = {
  onMenuCommand: () => () => undefined,
  recordSurfaceEvent: () => undefined,
  assetBase: () => new URL(".", document.baseURI).href,
  adminDashboard: () => ({ open: () => undefined }),
  pageFrameUrl,
};

export const DESKTOP_LINKS: Pick<AppPlatform, "openGitHub" | "openWeb"> = {
  openGitHub: (url) => pressAct(ACT_KIND.GITHUB_OPEN, { url }),
  openWeb: (url) => pressAct(ACT_KIND.WEB_OPEN, { url }),
};

export function copyingInto(copied: string[]): Pick<AppPlatform, "copyText"> {
  return {
    copyText: (words) => {
      copied.push(words);
      return Promise.resolve();
    },
  };
}

export function fakeAppPlatform(calls: Partial<AppPlatform>): void {
  installAppPlatform(calls as AppPlatform);
}
