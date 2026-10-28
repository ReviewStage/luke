import assert from "node:assert/strict";
import { test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { tasksControl } from "../testing/tasks-control.js";
import { mobileBarShown } from "./mobile-bar.js";

/**
 * mobile-bar.test.ts -- a phone's bar stands over the Inbox's list, and
 * gives the whole screen to an item chosen over it, a channel's narrowed
 * Inbox alike.
 */

const CHOSEN = { taskId: "task-1", itemId: "item-1" } as const;

/** A phone's window on the Inbox's place, its list asked for or not, an item chosen. */
function onInbox(listed: boolean) {
  const tasks = tasksControl();
  return tasksControl({ inboxView: { ...tasks.inboxView, open: true, chosen: CHOSEN, listed } });
}

test.each([
  { on: "the list", listed: true, shown: true },
  { on: "an item", listed: false, shown: false },
])("the bar on $on stands: $shown", ({ listed, shown }) => {
  assert.equal(mobileBarShown(SHELL_ROOM.NARROW, onInbox(listed)), shown);
});
