import assert from "node:assert/strict";
import { test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { tasksControl } from "../testing/tasks-control.js";
import { mobileBarShown } from "./mobile-bar.js";

const CHOSEN = { taskId: "task-1", itemId: "item-1" } as const;

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
