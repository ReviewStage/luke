import { PUSH } from "@repo/host/contract";
import { APP_COMMAND, type AppCommand } from "@repo/settings/shortcuts";
import type { Event, WebContents } from "electron";
import { windowPushes } from "./window-pushes";

const SWIPE_DIRECTION = {
  LEFT: "left",
  RIGHT: "right",
  UP: "up",
  DOWN: "down",
} as const;

type SwipeDirection = (typeof SWIPE_DIRECTION)[keyof typeof SWIPE_DIRECTION];

const SWIPE_COMMANDS = {
  [SWIPE_DIRECTION.LEFT]: APP_COMMAND.BACK,
  [SWIPE_DIRECTION.RIGHT]: APP_COMMAND.FORWARD,
  [SWIPE_DIRECTION.UP]: undefined,
  [SWIPE_DIRECTION.DOWN]: undefined,
} as const satisfies Record<SwipeDirection, AppCommand | undefined>;

function isSwipeDirection(direction: string): direction is SwipeDirection {
  return Object.hasOwn(SWIPE_COMMANDS, direction);
}

interface SwipedWindow {
  on(event: "swipe", listener: (event: Event, direction: string) => void): this;
  readonly webContents: WebContents;
}

export function followSwipes(window: SwipedWindow): void {
  window.on("swipe", (_event, direction) => {
    const command = isSwipeDirection(direction) ? SWIPE_COMMANDS[direction] : undefined;
    if (command !== undefined) windowPushes.push(window.webContents, PUSH.MENU_COMMAND, command);
  });
}
