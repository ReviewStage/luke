// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { lineWords } from "#testing/actor-line";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_TASK } from "#testing/document-task";
import { tasksControl } from "#testing/tasks-control";
import { SidebarTask } from "../desktop/task-actions";
import { PlanBody } from "./plan-body";
import { RelativeTime } from "./relative-time";

/**
 * relative-time.test.ts -- a save's age reads the same on the plan's own
 * "Edited" line as on its sidebar row, and a time hangs its full moment in
 * the window's tooltip.
 */

/** The minute every time here counts from: Oct 14, 2026, 6:00 PM, on the Mac's own clock. */
const NOW = new Date(2026, 9, 14, 18, 0).getTime();

const SECOND = 1_000;
const DANA = { userId: "user-dana", name: "Dana Reyes" };
const DAY = 86_400_000;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

/** What the sidebar row and the plan's "Edited" line say of a plan the developer last saved at `at`. */
function saidOf(at: number) {
  const task: Task = {
    ...DOCUMENT_TASK,
    updatedAt: at,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at, duringCall: false, by: DANA },
  };
  const row = mount(
    createElement(SidebarTask, {
      tasks: tasksControl({ tasks: [task] }),
      task,
      current: false,
      unread: false,
      now: NOW,
      onOpen: () => undefined,
    }),
  );
  const body = mount(
    createElement(PlanBody, { task, live: false, reader: { readerId: DANA.userId } }),
  );
  return {
    row: row.querySelector(".sidebar-task-time time")?.textContent,
    edited: lineWords(body.querySelector(".plan-edit-note")),
  };
}

test("a plan's Edited line says its age as its sidebar row does, a month old as a date", () => {
  // Note that only the date is fixed, so the plan's minute reads `NOW` and nothing waits on a timer.
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

  assert.deepEqual(saidOf(NOW - 10 * SECOND), { row: "now", edited: "Edited by you · now" });
  assert.deepEqual(saidOf(NOW - 3 * DAY), { row: "3d", edited: "Edited by you · 3d ago" });
  assert.deepEqual(saidOf(NOW - 45 * DAY), { row: "Aug 30", edited: "Edited by you · Aug 30" });
});

test("a time hangs its full moment in the window's tooltip, not the system's", () => {
  const at = new Date(2026, 9, 14, 15, 42).getTime();
  const container = mount(createElement(RelativeTime, { at, now: NOW }));
  const time = container.querySelector("time");
  assert.ok(time, "the age is a time");
  assert.equal(time.textContent, "2h");
  assert.equal(time.getAttribute("dateTime"), new Date(at).toISOString());
  assert.equal(time.getAttribute("title"), null);

  act(() => {
    time.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });

  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, "Oct 14, 2026, 3:42 PM");
});
