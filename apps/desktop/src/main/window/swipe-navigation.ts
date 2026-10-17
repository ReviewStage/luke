/**
 * swipe-navigation.ts -- a panel window's swipes left and right, run as its Back and Forward.
 *
 * macOS sends a window a swipe for a mouse's back and forward buttons where
 * its driver maps them to the system's own gesture, as Logi Options+ does
 * for an MX Master by default, and for a trackpad's page swipe where it is
 * set to the old swipe; Safari and Finder go back and forward on it. Such a
 * button never reaches the page as the mouse's fourth or fifth, which the
 * page answers itself, and Chromium answers the swipe with nothing, so the
 * window hands it to its page as the menu bar's Back or Forward, run where
 * ⌘[ and ⌘] would run.
 */

import type { Event, WebContents } from "electron";
import { channels } from "#shared/bridge";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";

/** The command each swipe runs, by the direction Electron names it: a swipe left is Back, as in Safari. */
const SWIPE_COMMANDS: ReadonlyMap<string, AppCommand> = new Map([
  ["left", APP_COMMAND.BACK],
  ["right", APP_COMMAND.FORWARD],
]);

/** The part of a window this reads: its swipes, and the page it hands them to. */
interface SwipedWindow {
  on(event: "swipe", listener: (event: Event, direction: string) => void): this;
  readonly webContents: Pick<WebContents, "send">;
}

/** Runs each swipe left or right on `window` as its page's Back or Forward; a swipe up or down is left alone. */
export function followSwipes(window: SwipedWindow): void {
  window.on("swipe", (_event, direction) => {
    const command = SWIPE_COMMANDS.get(direction);
    if (command !== undefined) window.webContents.send(channels.onMenuCommand, command);
  });
}
