import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";
import { channels } from "#shared/bridge";
import { APP_COMMAND } from "#shared/shortcuts";
import { followSwipes } from "./swipe-navigation";

/**
 * A panel window's swipes as its page meets them: the swipe Logi Options+
 * sends for an MX Master's back and forward buttons arrives as the menu
 * bar's Back or Forward, and a swipe up or down sends the page nothing.
 */

/** A window that swipes as Electron's does, with everything sent to its page gathered. */
function swipedWindow() {
  const sent: unknown[][] = [];
  const window = Object.assign(new EventEmitter(), {
    webContents: { send: (channel: string, ...args: unknown[]) => sent.push([channel, ...args]) },
  });
  followSwipes(window);
  const swipe = (direction: string) => window.emit("swipe", {}, direction);
  return { swipe, sent };
}

test("a swipe left is Back and a swipe right is Forward", () => {
  const { swipe, sent } = swipedWindow();
  swipe("left");
  swipe("right");
  assert.deepEqual(sent, [
    [channels.onMenuCommand, APP_COMMAND.BACK],
    [channels.onMenuCommand, APP_COMMAND.FORWARD],
  ]);
});

test("a swipe up or down sends the page nothing", () => {
  const { swipe, sent } = swipedWindow();
  swipe("up");
  swipe("down");
  assert.deepEqual(sent, []);
});
