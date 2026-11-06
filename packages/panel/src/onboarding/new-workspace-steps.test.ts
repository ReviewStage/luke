// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { WORKSPACE_ACT_KIND } from "@repo/host/contract";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { NewWorkspaceSteps } from "./new-workspace-steps.js";

/**
 * New workspace's cards as the developer walks them: Cancel before Create
 * makes nothing; Create makes the workspace, lists it, and goes on to
 * GitHub, whose Skip lands on the new workspace's Home; and an invitation
 * refused holds the first card on what was refused. Synthetic throughout.
 */

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
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The cards over a window that writes each press it would hand on into `pressed`. */
function mount(pressed: string[]): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(NewWorkspaceSteps, {
          tasks: {
            ...tasksControl(),
            onChooseWorkspace: (workspaceId) => pressed.push(`choose:${workspaceId}`),
            onGoHome: () => pressed.push("home"),
          },
          onClose: () => pressed.push("close"),
        }),
      ),
    ),
  );
  return container;
}

/** The card's button by its words. */
function button(container: HTMLElement, words: string): HTMLButtonElement {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === words,
    ) ?? assert.fail(`no ${words} on ${container.textContent}`)
  );
}

/** Types `words` into the field labeled `label`, as a person does. */
function type(container: HTMLElement, label: string, words: string): void {
  const labeled = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.textContent?.startsWith(label) === true,
  );
  const input = document.getElementById(labeled?.htmlFor ?? "");
  assert.ok(input instanceof HTMLInputElement, `no ${label} field`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("Cancel and Escape before Create make nothing and put the cards away", () => {
  const made: string[] = [];
  fakeActPort({
    [WORKSPACE_ACT_KIND.WORKSPACE_CREATE]: ({ name }) => {
      made.push(name);
      return Promise.resolve(PAPERSTAR);
    },
  });
  const pressed: string[] = [];
  const container = mount(pressed);
  type(container, "Name", "Paperstar");

  act(() => button(container, "Cancel").click());
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  assert.deepEqual(made, []);
  assert.deepEqual(pressed, ["close", "close"]);
});

test("Create makes the workspace and lists it, goes on to GitHub, and Skip lands on its Home", async () => {
  const made: string[] = [];
  fakeActPort({
    [WORKSPACE_ACT_KIND.WORKSPACE_CREATE]: ({ name }) => {
      made.push(name);
      return Promise.resolve(PAPERSTAR);
    },
  });
  const pressed: string[] = [];
  const container = mount(pressed);
  const create = button(container, "Create");
  const waited = create.disabled;
  type(container, "Name", "  Paperstar ");

  await act(async () => button(container, "Create").click());
  await settle();
  const title = container.querySelector("h1")?.textContent;
  const exit = button(container, "Close");
  act(() => button(container, "Skip").click());

  assert.equal(waited, true, "Create waits on a name");
  assert.deepEqual(made, ["Paperstar"]);
  assert.equal(title, "Connect GitHub");
  assert.ok(exit, "once made, the way out reads Close");
  assert.deepEqual(pressed, [`choose:${PAPERSTAR.id}`, "close", "home"]);
});

test("an invitation refused holds the first card on what was refused, and Continue goes on to GitHub", async () => {
  fakeActPort({
    [WORKSPACE_ACT_KIND.WORKSPACE_CREATE]: () => Promise.resolve(PAPERSTAR),
    [WORKSPACE_ACT_KIND.WORKSPACE_INVITE]: () =>
      Promise.reject(refusedOnPort("That address is already a member.")),
  });
  const container = mount([]);
  type(container, "Name", "Paperstar");
  type(container, "Add teammates by email", "dana@paperstar.app");

  await act(async () => button(container, "Create").click());
  await settle();
  const title = container.querySelector("h1")?.textContent;
  const refused = [...container.querySelectorAll("button")].find(
    (each) => each.textContent === "dana@paperstar.app",
  );
  const why = document.getElementById(refused?.getAttribute("aria-describedby") ?? "")?.textContent;
  act(() => button(container, "Continue").click());

  assert.equal(title, "Your new workspace");
  assert.equal(why, "That address is already a member.", "the refused address's chip says why");
  assert.equal(container.querySelector("h1")?.textContent, "Connect GitHub");
});
