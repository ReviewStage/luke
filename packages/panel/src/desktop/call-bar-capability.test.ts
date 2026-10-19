// @vitest-environment jsdom

import assert from "node:assert/strict";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { DESKTOP_CAPABILITIES, handCapabilities } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/**
 * The call bar under a task, which starts a call about it, stands only on a
 * platform that offers voice. Synthetic task.
 */

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The task open on its own tab, on a platform offering `capabilities`, once its document has arrived. */
async function mountOn(capabilities: readonly HostCapability[]): Promise<HTMLElement> {
  handCapabilities(capabilities);
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

test("the call bar stands under the task on the desktop, and nowhere on a platform without voice", async () => {
  const desktop = await mountOn(DESKTOP_CAPABILITIES);
  const onDesktop = desktop.querySelector(".desktop-call-bar") !== null;
  act(() => roots.pop()?.unmount());

  const withoutVoice = await mountOn(
    DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.VOICE),
  );

  assert.equal(onDesktop, true);
  assert.equal(withoutVoice.querySelector(".desktop-call-bar") !== null, false);
});
