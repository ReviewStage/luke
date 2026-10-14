// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@sidecar/hosted/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import type { PlansControl } from "../planning/use-plans-tab";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * The head of the sidebar's plans as the developer meets it: the workspace
 * listed, and the menu of every workspace, New workspace, and Workspace
 * settings, whoever the account is in the workspace. Each press is written
 * down where the sidebar would hand it on.
 */

const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Personal",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};
const CONNECTED: Workspace = {
  ...ACME,
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The switcher over the plans given, in sight or folded away. */
function mount(plans: Partial<PlansControl>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const render = (inSight: boolean) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(WorkspaceSwitcher, {
            plans: { ...plansControl(), ...plans },
            inSight,
          }),
        ),
      ),
    );
  render(true);
  return {
    switcher: () => container.querySelector<HTMLButtonElement>(".sidebar-workspace-toggle"),
    fold: () => render(false),
  };
}

/** The items of the menu standing open. */
function menuItems(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]',
    ),
  ];
}

/** Opens the switcher's menu. */
function open(switcher: HTMLButtonElement | null): void {
  assert.ok(switcher, "the switcher heads the plans");
  act(() => switcher.click());
}

/** Chooses the open menu's item by its label. */
function choose(label: string): void {
  const item = menuItems().find((candidate) => candidate.textContent === label);
  assert.ok(item, `the menu offers ${label}`);
  act(() => item.click());
}

test("the menu offers the workspaces, the listed one checked, New workspace, and Workspace settings, and nothing else", () => {
  const pressed: string[] = [];
  const page = mount({
    workspaces: [PERSONAL, CONNECTED],
    workspace: CONNECTED,
    onChooseWorkspace: (workspaceId) => pressed.push(`choose:${workspaceId}`),
    onOpenWorkspaceSettings: () => pressed.push("settings"),
  });

  open(page.switcher());
  const offered = menuItems().map((item) => [item.textContent, item.getAttribute("aria-checked")]);
  choose("Personal");
  open(page.switcher());
  choose("Workspace settings");

  assert.equal(page.switcher()?.textContent, "acme");
  assert.deepEqual(offered, [
    ["Personal", "false"],
    ["acme", "true"],
    ["New workspace", null],
    ["Workspace settings", null],
  ]);
  assert.deepEqual(pressed, [`choose:${PERSONAL.id}`, "settings"]);
});

test("a member of a team is offered the same three kinds of item as its admin", () => {
  const member = mount({ workspaces: [PERSONAL, ACME], workspace: ACME });
  open(member.switcher());

  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["Personal", "acme", "New workspace", "Workspace settings"],
  );
});

test("New workspace asks a name and creates it, and a refusal is said on the card with the name kept", async () => {
  const asked: string[] = [];
  let refusal: string | undefined = "Could not make that workspace on this system.";
  const page = mount({
    workspaces: [PERSONAL],
    workspace: PERSONAL,
    onCreateWorkspace: (name) => {
      asked.push(name);
      return Promise.resolve(refusal);
    },
  });

  open(page.switcher());
  const offered = menuItems().map((item) => item.textContent);
  choose("New workspace");
  const field =
    document.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]') ??
    assert.fail("no name field");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, "  Platform  ");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Enter in the field creates, as the card's Create does.
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const refused = document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent;
  refusal = undefined;
  const create = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
  ].find((button) => button.textContent === "Create workspace");
  assert.ok(create, "the card offers Create workspace");
  await act(async () => create.click());

  assert.deepEqual(offered, ["Personal", "New workspace", "Workspace settings"]);
  assert.deepEqual(asked, ["Platform", "Platform"]);
  assert.equal(refused, "Could not make that workspace on this system.");
  assert.equal(
    document.querySelector('[role="alertdialog"]'),
    null,
    "a workspace made closes the card",
  );
});

test("no workspace listed draws no head, as before the workspaces are read or once signed out", () => {
  const page = mount({ workspaces: [], workspace: undefined });

  assert.equal(page.switcher(), null);
});

test("the workspace menu closes when the sidebar folds away", () => {
  const page = mount({ workspaces: [PERSONAL, ACME], workspace: ACME });
  open(page.switcher());
  const opened = menuItems().length;

  page.fold();

  assert.equal(opened, 4);
  assert.deepEqual(menuItems(), []);
});

/** Opens New workspace and types `name` into its field, which it answers. */
function nameWorkspace(page: { switcher: () => HTMLButtonElement | null }, name: string) {
  open(page.switcher());
  choose("New workspace");
  const field =
    document.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]') ??
    assert.fail("no name field");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, name);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}

test("New workspace opens on an empty name each time, so a cancelled name is not offered again", () => {
  const page = mount({ workspaces: [PERSONAL], workspace: PERSONAL });
  nameWorkspace(page, "Platform");
  const cancel =
    [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
      (button) => button.textContent === "Cancel",
    ) ?? assert.fail("no Cancel");
  act(() => cancel.click());

  open(page.switcher());
  choose("New workspace");

  assert.equal(
    document.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]')?.value,
    "",
  );
});

test("Enter while an input method composes creates nothing, and a press dragged from the field onto the dimmed window cancels nothing", async () => {
  const asked: string[] = [];
  const page = mount({
    workspaces: [PERSONAL],
    workspace: PERSONAL,
    onCreateWorkspace: (name) => {
      asked.push(name);
      return Promise.resolve(undefined);
    },
  });
  const field = nameWorkspace(page, "東京");

  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
    );
  });
  const backdrop =
    document.querySelector<HTMLElement>(".confirm-dialog-backdrop") ?? assert.fail("no backdrop");
  act(() => {
    field.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  assert.deepEqual(asked, []);
  assert.ok(document.querySelector('[role="alertdialog"]'), "the card still stands");
});
