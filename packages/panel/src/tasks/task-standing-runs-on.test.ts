// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_MACHINE } from "@luke/features/agent-wire";
import { DEVICE_KIND } from "@luke/features/device-agent-wire";
import { TASK_PRIORITY, TASK_STATUS, type Task, type TaskStanding } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { TaskStandingChips } from "./task-standing.js";

/**
 * task-standing-runs-on.test.ts -- a task's Runs on chip, with local agents
 * on: it says where the task runs, as set when it was created, and is read-only:
 * a press drops no menu and hands the page no change. Note that it stands in a
 * file of its own, because a window reads its document once, and the gate
 * reads the experiment off that document. Synthetic throughout.
 */

const STUDIO = "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11";

const TASK: Task = {
  id: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  workspaceId: "workspace-acme",
  name: "Fix Safari login cookie",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
  document: { body: "", assumptions: [] },
};

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
  // The service says the Studio beat just now.
  fakeActPort({
    [ACT_KIND.HOSTS_PRESENCE]: () => Promise.resolve({ devices: [{ deviceId: STUDIO, ageMs: 0 }] }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Draws the task's chips with a door a change is sent through, and answers the Runs on chip they draw. */
async function runsOnChip(task: Task, sent: TaskStanding[]): Promise<HTMLButtonElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(TaskStandingChips, {
          task,
          onSet: (standing) => {
            sent.push(standing);
          },
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
  const found = [...host.querySelectorAll("button")].find((button) =>
    button.getAttribute("aria-label")?.startsWith("Runs on"),
  );
  return found ?? assert.fail("no Runs on chip");
}

test("the Runs on chip names the device the task runs on, and a press drops no menu and sends no change", async () => {
  const sent: TaskStanding[] = [];
  const chip = await runsOnChip(
    {
      ...TASK,
      runsOn: {
        machine: AGENT_MACHINE.DEVICE,
        deviceId: STUDIO,
        device: { name: "Studio", kind: DEVICE_KIND.DESKTOP, seenAt: Date.now() },
      },
    },
    sent,
  );

  assert.equal(chip.getAttribute("aria-label"), "Runs on: Studio · Online");
  assert.equal(chip.getAttribute("aria-disabled"), "true");
  act(() => chip.click());
  assert.equal(document.querySelector('[role="option"]'), null);
  assert.equal(chip.getAttribute("aria-expanded"), null);
  assert.deepEqual(sent, []);
});
