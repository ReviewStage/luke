/**
 * app-platform.ts -- what a test's window can do that only its shell can: a fake answering only the calls its test gives it.
 */

import { ACT_KIND } from "@luke/host/acts";
import { tellAct } from "../act.js";
import type { AppPlatform } from "../app-platform.js";
import { installAppPlatform } from "../app-platform.js";

/**
 * What a panel a test drives asks of its shell just by standing and being
 * walked through: a menu bar that sends no command, surface events that are
 * counted nowhere, and static files served beside the document, as the
 * desktop serves them. A test that reads any of them answers it itself.
 */
export const QUIET_PANEL: Pick<AppPlatform, "onMenuCommand" | "recordSurfaceEvent" | "assetBase"> =
  {
    onMenuCommand: () => () => undefined,
    recordSurfaceEvent: () => undefined,
    assetBase: () => new URL(".", document.baseURI).href,
  };

/**
 * The desktop's own two ways out to a link, each the act main opens it
 * with, as the desktop's platform answers them (`desktop-platform.ts`), sent
 * over whatever bridge the test fakes: a test that reads which act a press
 * sent reads it from its bridge's acts.
 */
export const DESKTOP_LINKS: Pick<AppPlatform, "openGitHub" | "openWeb"> = {
  openGitHub: (url) => tellAct(ACT_KIND.GITHUB_OPEN, { url }),
  openWeb: (url) => tellAct(ACT_KIND.WEB_OPEN, { url }),
};

/** A clipboard that takes every copy, pushing its words onto `copied` in the order they were copied. */
export function copyingInto(copied: string[]): Pick<AppPlatform, "copyText"> {
  return {
    copyText: (words) => {
      copied.push(words);
      return Promise.resolve();
    },
  };
}

/** Installs a platform answering only the calls given, in place of whatever the window held. */
export function fakeAppPlatform(calls: Partial<AppPlatform>): void {
  // SAFETY: a test's window makes only the calls its test answers, and any other is undefined and throws where it is made.
  installAppPlatform(calls as AppPlatform);
}
