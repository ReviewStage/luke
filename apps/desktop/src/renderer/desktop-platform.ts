/**
 * desktop-platform.ts -- what the desktop's shell answers for the panel: each capability as the act or the preload event main already serves.
 */

import { pageFrameUrl } from "@luke/features/page-frame";
import { ACT_KIND } from "@luke/host/acts";
import { askAct, tellAct } from "@luke/panel/act";
import { appBridge } from "@luke/panel/app-bridge";
import type { AppPlatform } from "@luke/panel/app-platform";
import { applySessionReplay } from "./session-replay";

/**
 * The desktop's platform. The clipboard, the save dialog, the panel's focus,
 * and the browser are main's, reached over the act channel; the menu bar,
 * the shortcut recording, and the counted events over the bridge's own
 * entries; a page is drawn from the `luke-page:` scheme main serves; and
 * the session recording is the desktop's own (`session-replay.ts`).
 * Each reads the bridge as it is called, so this is built before the bridge
 * is installed as safely as after.
 */
export const DESKTOP_PLATFORM: AppPlatform = {
  copyText: (words) => askAct(ACT_KIND.WINDOW_COPY_TEXT, { words }),
  saveFile: ({ name, text }) => askAct(ACT_KIND.WINDOW_SAVE_FILE, { name, text }),
  focusPanel: () => tellAct(ACT_KIND.WINDOW_FOCUS_PANEL),
  pageFrameUrl,
  onMenuCommand: (listener) => appBridge().onMenuCommand(listener),
  setShortcutCapturing: (capturing) => appBridge().setShortcutCapturing(capturing),
  recordSurfaceEvent: (name, properties) => appBridge().recordSurfaceEvent(name, properties),
  openGitHub: (url) => tellAct(ACT_KIND.GITHUB_OPEN, { url }),
  openWeb: (url) => tellAct(ACT_KIND.WEB_OPEN, { url }),
  applySessionReplay,
};
