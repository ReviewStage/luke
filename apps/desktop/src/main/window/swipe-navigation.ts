/**
 * swipe-navigation.ts -- a panel window's swipes left and right, run as its Back and Forward.
 *
 * macOS sends a window a swipe for a mouse's back and forward buttons where
 * its driver maps them to the system's own gesture, as Logi Options+ does
 * for an MX Master by default, and for a trackpad's page swipe where it is
 * set to the old swipe; Safari and Finder go back and forward on it. Such a
 * button never reaches the page as the mouse's fourth or fifth, which the
 * page answers itself, and Chromium answers the swipe with nothing, so the
 * window hands it to its page as the menu bar's Back or Forward, which an
 * overlay holding the keyboard holds off as it holds off ⌘[ and ⌘].
 */

import { PUSH } from "@luke/host/contract";
import { APP_COMMAND, type AppCommand } from "@luke/settings/shortcuts";
import type { Event, WebContents } from "electron";
import { windowPushes } from "./window-pushes";

/** The directions Electron names a swipe by. */
const SWIPE_DIRECTION = {
  LEFT: "left",
  RIGHT: "right",
  UP: "up",
  DOWN: "down",
} as const;

type SwipeDirection = (typeof SWIPE_DIRECTION)[keyof typeof SWIPE_DIRECTION];

/** The command each swipe runs: a swipe left is Back, as in Safari, and up or down runs nothing. */
const SWIPE_COMMANDS = {
  [SWIPE_DIRECTION.LEFT]: APP_COMMAND.BACK,
  [SWIPE_DIRECTION.RIGHT]: APP_COMMAND.FORWARD,
  [SWIPE_DIRECTION.UP]: undefined,
  [SWIPE_DIRECTION.DOWN]: undefined,
} as const satisfies Record<SwipeDirection, AppCommand | undefined>;

/** Whether Electron's direction is one this names. */
function isSwipeDirection(direction: string): direction is SwipeDirection {
  return Object.hasOwn(SWIPE_COMMANDS, direction);
}

/** The part of a window this reads: its swipes, and the page it hands them to. */
interface SwipedWindow {
  on(event: "swipe", listener: (event: Event, direction: string) => void): this;
  readonly webContents: WebContents;
}

/** Runs each swipe left or right on `window` as its page's Back or Forward; a swipe up or down is left alone. */
export function followSwipes(window: SwipedWindow): void {
  window.on("swipe", (_event, direction) => {
    const command = isSwipeDirection(direction) ? SWIPE_COMMANDS[direction] : undefined;
    if (command !== undefined) windowPushes.push(window.webContents, PUSH.MENU_COMMAND, command);
  });
}
