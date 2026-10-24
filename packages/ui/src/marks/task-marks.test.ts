// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@luke/features/task-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { STATUS_TONE } from "../status-tone.js";
import { TaskPriorityMark, TaskStatusMark } from "./task-marks.js";

/**
 * A task's status mark wears the status tone of where it stands: under way
 * in the working blue rather than the needs-you orange, done in the green
 * every other done wears, and the rest at rest. A priority's mark spans the
 * same box a settled status's disc does, so the two stand the same size.
 */

function toneOf(status: TaskStatus): string | null {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(createElement(TaskStatusMark, { status }));
  const mark = page.querySelector(".luke-task-status-mark") ?? assert.fail("a mark is drawn");
  return mark.getAttribute("data-tone");
}

test("a task in progress is drawn in the working tone, never the needs-you one", () => {
  assert.equal(toneOf(TASK_STATUS.IN_PROGRESS), STATUS_TONE.WORKING);
});

test("a done task is drawn in the complete tone, as every other done is", () => {
  assert.equal(toneOf(TASK_STATUS.DONE), STATUS_TONE.COMPLETE);
});

test("a task in the backlog, to do, or canceled is drawn at rest", () => {
  for (const status of [TASK_STATUS.BACKLOG, TASK_STATUS.TODO, TASK_STATUS.CANCELED]) {
    assert.equal(toneOf(status), STATUS_TONE.NEUTRAL, status);
  }
});

/** The span a mark's filled shapes cover, across and down, in its box's units. */
function filledSpan(mark: React.ReactElement): {
  across: [number, number];
  down: [number, number];
} {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(mark);
  const edges = [...page.querySelectorAll(".luke-task-mark-fill")].map((shape) => {
    const read = (name: string) => Number(shape.getAttribute(name));
    if (shape.tagName === "circle") {
      const [cx, cy, r] = [read("cx"), read("cy"), read("r")];
      return { left: cx - r, right: cx + r, top: cy - r, bottom: cy + r };
    }
    const [x, y] = [read("x"), read("y")];
    return { left: x, right: x + read("width"), top: y, bottom: y + read("height") };
  });
  assert.ok(edges.length > 0, "the mark fills something");
  return {
    across: [
      Math.min(...edges.map((each) => each.left)),
      Math.max(...edges.map((each) => each.right)),
    ],
    down: [
      Math.min(...edges.map((each) => each.top)),
      Math.max(...edges.map((each) => each.bottom)),
    ],
  };
}

test("every priority's mark spans the box a settled status's disc does, so neither stands smaller beside the other", () => {
  const disc = filledSpan(createElement(TaskStatusMark, { status: TASK_STATUS.DONE }));
  for (const priority of Object.values(TASK_PRIORITY) as TaskPriority[]) {
    const span = filledSpan(createElement(TaskPriorityMark, { priority }));
    assert.deepEqual(span.across, disc.across, `${priority} spans the disc's width`);
    // Note that an unweighed task's dashes lie across the middle, so only a weighed one stands the disc's height.
    if (priority !== TASK_PRIORITY.NONE) {
      assert.deepEqual(span.down, disc.down, `${priority} spans the disc's height`);
    }
  }
});
