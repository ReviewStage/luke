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

/** A phone's window on the Inbox's place, with an item chosen or none. */
function onInbox(chosen: typeof CHOSEN | undefined) {
  const tasks = tasksControl();
  return tasksControl({ inboxView: { ...tasks.inboxView, open: true, chosen } });
}

test.each([
  { on: "the list", chosen: undefined, shown: true },
  { on: "an item", chosen: CHOSEN, shown: false },
])("the bar on $on stands: $shown", ({ chosen, shown }) => {
  assert.equal(mobileBarShown(SHELL_ROOM.NARROW, onInbox(chosen)), shown);
});
