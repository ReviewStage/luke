// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_STATUS, type TaskStatus } from "@luke/features/task-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { STATUS_TONE } from "../status-tone.js";
import { TaskStatusMark } from "./task-marks.js";

/**
 * A task's status mark wears the status tone of where it stands: under way
 * in the working blue rather than the needs-you orange, done in the green
 * every other done wears, and the rest at rest.
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
