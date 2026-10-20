// @vitest-environment jsdom

import assert from "node:assert/strict";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";

/**
 * New task's repository chip in a workspace whose GitHub App is on another
 * owner: a repository the picker lists on a member's own GitHub token stays
 * picked once chosen. Synthetic throughout.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
  memberCount: 2,
};

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({});
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
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("a repository the picker lists on a member's token, on an owner the workspace's App is not on, stays picked", async () => {
  const control = tasksControl();
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
            repositoriesIn: () => ({
              ...control.repositories,
              recent: [],
              scope: ACME.id,
              read: () =>
                Promise.resolve({
                  repositories: {
                    installed: true,
                    repositories: [
                      {
                        owner: "octo",
                        name: "tools",
                        fullName: "octo/tools",
                        defaultBranch: "main",
                        private: true,
                        updatedAt: 1,
                        access: GITHUB_ACCESS.TOKEN,
                      },
                    ],
                    installationUrl: "https://github.com/apps/luke/installations/new",
                  },
                }),
            }),
          },
          workspaceId: ACME.id,
          onLeave: () => undefined,
          listSide: MENTION_MENU_SIDE.ABOVE,
        }),
      ),
    ),
  );
  await settle();
  const chip =
    container.querySelector<HTMLButtonElement>(".luke-chip") ??
    assert.fail("the card draws the repository chip");
  act(() => chip.click());
  await settle();
  const row =
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("tools"),
    ) ?? assert.fail("the picker lists the token repository");
  act(() => row.click());
  await settle();

  assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
});
