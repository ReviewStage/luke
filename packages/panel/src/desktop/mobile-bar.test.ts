import assert from "node:assert/strict";
import { test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { tasksControl } from "../testing/tasks-control.js";
import { mobileBarShown } from "./mobile-bar.js";

/**
 * mobile-bar.test.ts -- with Channels on, a phone's bar stands over the list
 * of channels and over a channel's stream, an item chosen behind it or not,
 * and gives the whole screen to a thread opened over the stream; with
 * Channels off, an item chosen in the Inbox keeps the whole screen as before.
 */

const CHOSEN = { taskId: "task-1", itemId: "item-1" } as const;

/** A phone's window on the Inbox's place, its list asked for or not, an item chosen. */
function onInbox(listed: boolean) {
  const tasks = tasksControl();
  return tasksControl({ inboxView: { ...tasks.inboxView, open: true, chosen: CHOSEN, listed } });
}

test.each([
  { on: "the list of channels", listed: true, channels: { threadOpen: true }, shown: true },
  { on: "a channel's stream", listed: false, channels: { threadOpen: false }, shown: true },
  { on: "a thread over the stream", listed: false, channels: { threadOpen: true }, shown: false },
  { on: "an Inbox item, Channels off", listed: false, channels: undefined, shown: false },
])("the bar on $on stands: $shown", ({ listed, channels, shown }) => {
  assert.equal(mobileBarShown(SHELL_ROOM.NARROW, onInbox(listed), false, channels), shown);
});
