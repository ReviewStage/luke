import assert from "node:assert/strict";
import type { TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, type TasksPinParams, type TasksView } from "@repo/features/tasks-view";
import type { ACT_KIND } from "@repo/host/acts";
import { afterEach, test } from "vitest";
import { rendererRegistry } from "./renderer-runtime.js";
import { pressRows, ROW_WRITE, type RowDoors, redoLast, UNDO_RAN, undoLast } from "./undo-stack.js";

/**
 * undo-stack.test.ts -- ⌘Z and ⇧⌘Z over one task's pin as the window draws
 * it: the keys take the pin back and put it back, a pin after ⌘Z leaves
 * nothing to put back, and a pin taken back since is left alone. The act
 * keeps each pin and draws the task as it leaves it, as the host does.
 * Synthetic throughout.
 */

const TASK_ID = "3f2c8a51-6d0e-4b7a-9c14-2e5f7a9b0d36";

afterEach(() => {
  // The window's one registry holds the lists, so the next test's window starts with none.
  rendererRegistry.reset();
});

/** The tasks drawn: the one task, pinned or not. */
function tasksShowing(pinned: boolean): TasksView {
  const task: TaskSummary = {
    id: TASK_ID,
    workspaceId: "workspace-personal",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    ...(pinned ? { pinnedAt: 3 } : undefined),
  };
  return { ...IDLE_TASKS_VIEW, tasks: [task] };
}

/** A window drawing the task unpinned, its act keeping each pin and drawing the task as the pin leaves it. */
interface PinWindow {
  readonly doors: RowDoors<TasksView, typeof ACT_KIND.TASKS_PIN>;
  /** Every pin the act was sent, in order. */
  readonly sent: TasksPinParams[];
  /** Draws the task pinned or not, as another Mac's pin would. */
  readonly show: (pinned: boolean) => void;
}

function standWindow(): PinWindow {
  let drawn = tasksShowing(false);
  const sent: TasksPinParams[] = [];
  const show = (pinned: boolean) => {
    drawn = tasksShowing(pinned);
  };
  const send = (payload: TasksPinParams) => {
    sent.push(payload);
    show(payload.pinned);
    return Promise.resolve(true);
  };
  return { doors: { rows: () => drawn, send }, sent, show };
}

/** Pins the task as its menu's Pin does: its row read as pressed, the pin sent, and kept for ⌘Z once the act keeps it. */
async function pin(window: PinWindow): Promise<void> {
  const pressed = pressRows(ROW_WRITE.TASK_PIN, window.doors, [
    { id: TASK_ID, after: { pinned: true, position: null } },
  ]);
  assert.equal(await window.doors.send({ taskId: TASK_ID, pinned: true }), true);
  pressed.keep("Task pinned");
}

test("⌘Z takes the task's pin back, and ⇧⌘Z puts it back", async () => {
  const window = standWindow();
  await pin(window);

  const undone = await undoLast();
  const redone = await redoLast();

  assert.equal(undone, UNDO_RAN.APPLIED);
  assert.equal(redone, UNDO_RAN.APPLIED);
  assert.deepEqual(window.sent, [
    { taskId: TASK_ID, pinned: true },
    { taskId: TASK_ID, pinned: false },
    { taskId: TASK_ID, pinned: true },
  ]);
});

test("a pin after ⌘Z leaves nothing for ⇧⌘Z to put back", async () => {
  const window = standWindow();
  await pin(window);
  await undoLast();
  await pin(window);

  const redone = await redoLast();

  assert.equal(redone, undefined);
  assert.equal(window.sent.length, 3, "a pin, its ⌘Z, and the pin after it, and nothing more");
});

test("⌘Z leaves a pin taken back since, on another Mac, as it stands, and sends nothing", async () => {
  const window = standWindow();
  await pin(window);
  window.show(false);

  const undone = await undoLast();

  assert.equal(undone, UNDO_RAN.CHANGED);
  assert.deepEqual(window.sent, [{ taskId: TASK_ID, pinned: true }]);
});
