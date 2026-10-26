// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { DEVICE_KIND } from "@luke/features/device-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import type { TaskRunsOnRequest } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout, pressInComposer } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";

/**
 * new-task-composer-runs-on.test.ts -- New task's Runs on, with local agents
 * on and two of the member's devices offered, one offline: the task starts on
 * the device picked, by its id, and the offline one cannot be picked. Note
 * that it stands in a file of its own, because a window reads its document
 * once, and the gate reads the experiment off that document. Synthetic
 * throughout.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
  memberCount: 2,
};

const STUDIO = "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11";
const BUILDER = "0b8e4c1a-2f6d-4f53-8a2e-9d1c7e5b3a40";

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The card in Acme offering the Studio, online, and the build host, offline, each start's Runs on written down. */
async function mount() {
  const control = tasksControl();
  const starts: (TaskRunsOnRequest | undefined)[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(NewTaskComposer, {
          newTask: {
            ...control.newTask,
            workspaces: [ACME],
            workspaceId: ACME.id,
            devices: [
              {
                deviceId: STUDIO,
                name: "Studio",
                providers: [MODEL_PROVIDER.ANTHROPIC],
                kind: DEVICE_KIND.DESKTOP,
                seenAt: Date.now(),
              },
              {
                deviceId: BUILDER,
                name: "Build host",
                providers: [MODEL_PROVIDER.ANTHROPIC],
                kind: DEVICE_KIND.HOST,
                seenAt: 0,
              },
            ],
            start: (_name, _repository, _workspaceId, from) => {
              starts.push(from?.runsOn);
              return Promise.resolve(undefined);
            },
          },
          workspaceId: ACME.id,
          onLeave: () => undefined,
          listSide: MENTION_MENU_SIDE.ABOVE,
        }),
      ),
    ),
  );
  await settle();
  return { container, starts };
}

/** The menu's row naming `name`. */
function row(name: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes(name),
    ) ?? assert.fail(`Runs on lists ${name}`)
  );
}

test("a task starts on the device Runs on picked, by its id, and an offline device is listed but not picked", async () => {
  const { container, starts } = await mount();
  const chip = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]') ??
    assert.fail("the card draws Runs on");

  act(() => chip().click());
  await settle();
  assert.equal(row("Build host").getAttribute("aria-disabled"), "true");
  act(() => row("Studio").click());
  await settle();
  // ⌘Return on the empty box: a bare task, which carries where its agents run as any start does.
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.equal(chip().getAttribute("aria-label"), "Runs on: Studio");
  assert.deepEqual(starts, [{ machine: CODING_AGENT_MACHINE.DEVICE, deviceId: STUDIO }]);
});
