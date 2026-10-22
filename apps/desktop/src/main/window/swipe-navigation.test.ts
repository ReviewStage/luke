import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PUSH, type PushEvent } from "@luke/host/contract";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import type { WebContents } from "electron";
import { test } from "vitest";
import { followSwipes } from "./swipe-navigation";
import { windowPushes } from "./window-pushes";

/**
 * A panel window's swipes as its page meets them: the swipe Logi Options+
 * sends for an MX Master's back and forward buttons arrives as the menu
 * bar's Back or Forward, and a swipe up or down sends the page nothing.
 */

/** A window that swipes as Electron's does, its page's push stream open. */
function swipedWindow() {
  // SAFETY: the page is only the key its pushes are published under, which nothing here reads further.
  const webContents = {} as WebContents;
  const window = Object.assign(new EventEmitter(), { webContents });
  followSwipes(window);
  const stream = windowPushes.stream(webContents, undefined);
  const swipe = (direction: string) => window.emit("swipe", {}, direction);
  /** Everything pushed to the page so far, the stream then ended. */
  const sent = async (): Promise<PushEvent[]> => {
    windowPushes.push(webContents, PUSH.CALL_WINDOW_MOVED, undefined);
    const pushed: PushEvent[] = [];
    for await (const event of stream) {
      if (event.push === PUSH.CALL_WINDOW_MOVED) break;
      pushed.push(event);
    }
    return pushed;
  };
  return { swipe, sent };
}

test("a swipe left is Back and a swipe right is Forward", async () => {
  const { swipe, sent } = swipedWindow();
  swipe("left");
  swipe("right");
  assert.deepEqual(await sent(), [
    { push: PUSH.MENU_COMMAND, payload: APP_COMMAND.BACK },
    { push: PUSH.MENU_COMMAND, payload: APP_COMMAND.FORWARD },
  ]);
});

test("a swipe up or down sends the page nothing", async () => {
  const { swipe, sent } = swipedWindow();
  swipe("up");
  swipe("down");
  assert.deepEqual(await sent(), []);
});
