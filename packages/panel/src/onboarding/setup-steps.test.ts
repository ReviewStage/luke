// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { SetupSteps } from "./setup-steps.js";

/**
 * Setup's Welcome as the developer walks back to it: a team's workspace
 * made and then left for Just me lists the account's own workspace again,
 * so GitHub is not installed on the team's. Synthetic throughout.
 */

const ACCOUNT = "account-dana";

const OWN: Workspace = {
  id: "workspace-own",
  name: "Dana",
  slug: "personal-dana",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  personal: true,
};

const PAPERSTAR: Workspace = {
  id: "workspace-paperstar",
  name: "Paperstar",
  slug: "paperstar",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const roots: Root[] = [];

beforeEach(() => {
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

test("Just me after a team's workspace was made lists the account's own workspace again", () => {
  // Setup stands at Welcome, for the team, whose workspace was made before Back.
  window.localStorage.setItem(
    "app.setupPlace",
    JSON.stringify({ [ACCOUNT]: { audience: "team", at: 0, team: PAPERSTAR.id } }),
  );
  const chosen: string[] = [];
  const base = tasksControl();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(SetupSteps, {
          tasks: {
            ...base,
            newTask: { ...base.newTask, workspaces: [OWN, PAPERSTAR] },
            onChooseWorkspace: (workspaceId) => chosen.push(workspaceId),
          },
          accountId: ACCOUNT,
          onFinish: () => undefined,
        }),
      ),
    ),
  );

  const justMe =
    [...container.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
      each.textContent?.startsWith("Just me"),
    ) ?? assert.fail(`no Just me on ${container.textContent}`);
  act(() => justMe.click());

  assert.deepEqual(chosen, [OWN.id]);
});
