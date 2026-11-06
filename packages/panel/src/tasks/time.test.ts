// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DESCRIPTION_ACTOR, type Task } from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { Time } from "@repo/ui";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { SidebarTask } from "../desktop/task-actions.js";
import { lineWords } from "../testing/actor-line.js";
import { registryWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DescriptionBody } from "./description-body.js";

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
  act(() => root.render(onRegistry(registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS)), element)));
  return container;
}

function saidOf(at: number) {
  const task: Task = {
    ...DOCUMENT_TASK,
    updatedAt: at,
    lastEdit: { actor: DESCRIPTION_ACTOR.DEVELOPER, at, duringCall: false, by: DANA },
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
  const body = mount(createElement(DescriptionBody, { task, reader: { readerId: DANA.userId } }));
  return {
    row: row.querySelector(".sidebar-task-time time")?.textContent,
    edited: lineWords(body.querySelector(".description-byline-edited")),
  };
}

test("a description's Edited line says its age as its sidebar row does, a month old as a date", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

  assert.deepEqual(saidOf(NOW - 10 * SECOND), { row: "now", edited: "Edited now" });
  assert.deepEqual(saidOf(NOW - 3 * DAY), { row: "3d", edited: "Edited 3d ago" });
  assert.deepEqual(saidOf(NOW - 45 * DAY), {
    row: "Aug 30",
    edited: "Edited Aug 30",
  });
});

test("a time hangs its full moment in the window's tooltip, not the system's", () => {
  const at = new Date(2026, 9, 14, 15, 42).getTime();
  const container = mount(createElement(Time, { at, now: NOW }));
  const time = container.querySelector("time");
  assert.ok(time, "the age is a time");
  assert.equal(time.textContent, "2h");
  assert.equal(time.getAttribute("dateTime"), new Date(at).toISOString());
  assert.equal(time.getAttribute("title"), null);

  restOn(time);

  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, "Oct 14, 2026, 3:42 PM");
});
