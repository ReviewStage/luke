/**
 * app-platform.ts -- what a test's window can do that only its shell can: a fake answering only the calls its test gives it.
 */

import type { AppPlatform } from "@luke/panel/app-platform";
import { installAppPlatform } from "@luke/panel/app-platform";
import { DESKTOP_PLATFORM } from "../renderer/desktop-platform";

/**
 * What a panel a test drives asks of its shell just by standing and being
 * walked through: a menu bar that sends no command, and surface events that
 * are counted nowhere. A test that reads either answers it itself.
 */
export const QUIET_PANEL: Pick<AppPlatform, "onMenuCommand" | "recordSurfaceEvent"> = {
  onMenuCommand: () => () => undefined,
  recordSurfaceEvent: () => undefined,
};

/**
 * The desktop's own two ways out to a link, each the act main opens it
 * with, sent over whatever bridge the test fakes: a test that reads which
 * act a press sent reads it from its bridge's acts.
 */
export const DESKTOP_LINKS: Pick<AppPlatform, "openGitHub" | "openWeb"> = {
  openGitHub: DESKTOP_PLATFORM.openGitHub,
  openWeb: DESKTOP_PLATFORM.openWeb,
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
