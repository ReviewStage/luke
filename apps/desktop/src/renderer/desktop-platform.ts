import { pageFrameUrl } from "@repo/features/page-frame";
import { ACT_KIND } from "@repo/host/acts";
import { askAct, pressAct, tellAct } from "@repo/panel/act";
import { appBridge } from "@repo/panel/app-bridge";
import type { AppPlatform } from "@repo/panel/app-platform";
import { openBrowserLiveOverPort } from "@repo/panel/browser-live-port";
import { applySessionReplay } from "./session-replay";

const unsaved = { page: false, descriptionWords: false };

const tellUnsavedWork = (): void =>
  tellAct(ACT_KIND.WINDOW_UNSAVED_WORK, { holding: unsaved.page || unsaved.descriptionWords });

export const DESKTOP_PLATFORM: AppPlatform = {
  copyText: (words) => askAct(ACT_KIND.WINDOW_COPY_TEXT, { words }),
  copyImage: (png) => png.then((drawn) => askAct(ACT_KIND.WINDOW_COPY_IMAGE, { png: drawn })),
  saveFile: ({ name, text }) => askAct(ACT_KIND.WINDOW_SAVE_FILE, { name, text }),
  focusPanel: () => tellAct(ACT_KIND.WINDOW_FOCUS_PANEL),
  menuOffers: (commands) => tellAct(ACT_KIND.WINDOW_MENU_OFFERS, { commands }),
  pageFrameUrl,
  assetBase: () => new URL(".", document.baseURI).href,
  onMenuCommand: (listener) => appBridge().onMenuCommand(listener),
  recordSurfaceEvent: (name, properties) => appBridge().recordSurfaceEvent(name, properties),
  openGitHub: (url) => pressAct(ACT_KIND.GITHUB_OPEN, { url }),
  openWeb: (url) => pressAct(ACT_KIND.WEB_OPEN, { url }),
  adminDashboard: () => ({ open: () => pressAct(ACT_KIND.ADMIN_OPEN) }),
  openBrowserLive: openBrowserLiveOverPort,
  applySessionReplay,
  unsavedWork: (ask) => {
    unsaved.page = ask !== undefined;
    tellUnsavedWork();
  },
  unsavedDescriptionWords: (descriptionWords) => {
    unsaved.descriptionWords = descriptionWords;
    tellUnsavedWork();
  },
};
