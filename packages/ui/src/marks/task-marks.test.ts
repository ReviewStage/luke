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
 * every other done wears, and the rest at rest. A priority's mark is a
 * square of about a settled status's disc's area, centred on it, so the two
 * read the same size, each with the same room around it.
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

/** How far a priority's square may stray from the disc's area, as a share of it. */
const AREA_TOLERANCE = 0.02;

test("every weighed priority's mark is a square of the settled status's disc's area, centred on it, so neither reads larger beside the other", () => {
  const disc = filledSpan(createElement(TaskStatusMark, { status: TASK_STATUS.DONE }));
  const discCentre = (disc.across[0] + disc.across[1]) / 2;
  const discArea = Math.PI * ((disc.across[1] - disc.across[0]) / 2) ** 2;
  for (const priority of Object.values(TASK_PRIORITY) as TaskPriority[]) {
    if (priority === TASK_PRIORITY.NONE) continue;
    const { across, down } = filledSpan(createElement(TaskPriorityMark, { priority }));
    const side = across[1] - across[0];
    assert.deepEqual(down, across, `${priority} stands a square`);
    assert.equal((across[0] + across[1]) / 2, discCentre, `${priority} is centred on the disc`);
    assert.ok(
      Math.abs(side * side - discArea) / discArea <= AREA_TOLERANCE,
      `${priority} holds about the disc's area`,
    );
  }
});

test("an unweighed task's dashes lie across the same width a weighed priority's bars do", () => {
  const bars = filledSpan(createElement(TaskPriorityMark, { priority: TASK_PRIORITY.HIGH }));
  const dashes = filledSpan(createElement(TaskPriorityMark, { priority: TASK_PRIORITY.NONE }));
  assert.deepEqual(dashes.across, bars.across);
});
