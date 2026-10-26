import assert from "node:assert/strict";
import { test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { tasksControl } from "../testing/tasks-control.js";
import { mobileBarShown } from "./mobile-bar.js";

/**
 * mobile-bar.test.ts -- a phone's bar stands over the list of channels and
 * over a channel's stream, an item chosen behind it or not, and gives the
 * whole screen to a thread opened over the stream while its item is the one
 * chosen, so a choice Back restored shows the stream.
 */

const CHOSEN = { taskId: "task-1", itemId: "item-1" } as const;

/** A phone's window on the Inbox's place, its list asked for or not, an item chosen. */
function onInbox(listed: boolean) {
  const tasks = tasksControl();
  return tasksControl({ inboxView: { ...tasks.inboxView, open: true, chosen: CHOSEN, listed } });
}

test.each([
  { on: "the list of channels", listed: true, threadId: "item-1", shown: true },
  { on: "a channel's stream", listed: false, threadId: undefined, shown: true },
  { on: "a thread over the stream", listed: false, threadId: "item-1", shown: false },
  // Note that Back restores the choice before the thread opened, which shows the stream, not the thread.
  { on: "a stream Back returned to", listed: false, threadId: "item-2", shown: true },
])("the bar on $on stands: $shown", ({ listed, threadId, shown }) => {
  assert.equal(mobileBarShown(SHELL_ROOM.NARROW, onInbox(listed), threadId), shown);
});
