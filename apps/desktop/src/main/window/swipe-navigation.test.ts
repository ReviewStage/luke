import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LINK_PLACE } from "@repo/features/link-grammar";
import { PUSH, type PushEvent } from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import type { WebContents } from "electron";
import { test } from "vitest";
import { followSwipes } from "./swipe-navigation";
import { windowPushes } from "./window-pushes";

const LINK = { workspace: "workspace-1", place: { kind: LINK_PLACE.TASK, planId: "task-1" } };

function swipedWindow() {
  const webContents = {} as WebContents;
  const window = Object.assign(new EventEmitter(), { webContents });
  followSwipes(window);
  const stream = windowPushes.stream(webContents, undefined);
  const swipe = (direction: string) => window.emit("swipe", {}, direction);
  const sent = async (): Promise<PushEvent[]> => {
    windowPushes.push(webContents, PUSH.SHOW_LINK, LINK);
    const pushed: PushEvent[] = [];
    for await (const event of stream) {
      if (event.push === PUSH.SHOW_LINK) break;
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
