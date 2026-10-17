// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { tasksControl } from "#testing/tasks-control";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * The sidebar's head as the developer meets it: the workspace listed, by its
 * tile and name and who shares it, and the menu of every workspace, New
 * workspace, and Workspace settings, whoever the account is in the workspace. Each press is written
 * down where the sidebar would hand it on.
 */

const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Personal",
  slug: "personal",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
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

/** The switcher over the tasks given, in sight or folded away. */
function mount(tasks: Partial<TasksControl>) {
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
            tasks: { ...tasksControl(), ...tasks },
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

/** An item's label, the words beside its glyph. */
function labelOf(item: HTMLElement): string | null {
  return item.querySelector(".luke-menu-item-label")?.textContent ?? null;
}

/** Chooses the open menu's item by its label. */
function choose(label: string): void {
  const item = menuItems().find((candidate) => labelOf(candidate) === label);
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
  const offered = menuItems().map((item) => [labelOf(item), item.getAttribute("aria-checked")]);
  choose("Personal");
  open(page.switcher());
  choose("Workspace settings");

  assert.equal(page.switcher()?.querySelector(".workspace-ref-name")?.textContent, "acme");
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

  assert.deepEqual(menuItems().map(labelOf), [
    "Personal",
    "acme",
    "New workspace",
    "Workspace settings",
  ]);
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
  const offered = menuItems().map(labelOf);
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

test("a name typed after a refusal keeps the card up, takes the refusal away, and can still be created", async () => {
  const asked: string[] = [];
  const page = mount({
    workspaces: [PERSONAL],
    workspace: PERSONAL,
    onCreateWorkspace: (name) => {
      asked.push(name);
      return Promise.resolve(undefined);
    },
  });
  const field = nameWorkspace(page, "");
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const refused = document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent;

  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, "P");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const typed = document.querySelector<HTMLInputElement>(
    '[role="alertdialog"] input[aria-label="Workspace name"]',
  )?.value;
  const refusalAfterTyping = document.querySelector('[role="alertdialog"] [role="alert"]');
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  assert.equal(refused, "Name the workspace.");
  assert.equal(typed, "P", "the card stays up with what was typed");
  assert.equal(refusalAfterTyping, null);
  assert.deepEqual(asked, ["P"]);
});

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
    document.querySelector('[aria-modal="true"]')?.parentElement ?? assert.fail("no backdrop");
  act(() => {
    field.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  assert.deepEqual(asked, []);
  assert.ok(document.querySelector('[role="alertdialog"]'), "the card still stands");
});

test("each workspace in the menu wears its tile, its first letter, and a rename keeps the tile's hue", () => {
  const tiles = (workspaces: readonly Workspace[]) => {
    const page = mount({ workspaces, workspace: workspaces[0] });
    open(page.switcher());
    const drawn = menuItems()
      .map((item) => item.querySelector(".workspace-tile"))
      .filter((tile) => tile !== null)
      .map((tile) => [tile.textContent, tile.getAttribute("data-hue")]);
    // Each reading stands alone, so the next finds only its own menu.
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = "";
    return drawn;
  };

  const before = tiles([PERSONAL, CONNECTED]);
  assert.deepEqual(
    before.map(([letter]) => letter),
    ["P", "A"],
    "a tile stands beside each workspace and on no other item",
  );
  const renamed = tiles([PERSONAL, { ...CONNECTED, name: "Zenith" }]);
  assert.equal(renamed[1]?.[0], "Z");
  assert.equal(renamed[1]?.[1], before[1]?.[1], "the hue is the workspace's, not its name's");
  // An emoji is one character to a reader, though two to a string.
  assert.equal(tiles([{ ...PERSONAL, name: "🐙 Octo" }])[0]?.[0], "🐙");
});

test("each workspace in the menu says who shares it under its name, to the eye and to a screen reader, as the head does: the account's own first workspace of one as personal, a team's members counted, and nothing where the service counts none", () => {
  const solo: Workspace = { ...ACME, id: "workspace-solo", name: "Solo", memberCount: 1 };
  const uncounted: Workspace = { ...ACME, id: "workspace-uncounted", name: "Uncounted" };
  const page = mount({
    workspaces: [
      { ...PERSONAL, memberCount: 1 },
      { ...CONNECTED, memberCount: 5 },
      solo,
      uncounted,
    ],
    workspace: CONNECTED,
  });

  open(page.switcher());
  const rows = menuItems()
    .slice(0, 4)
    .map((item) => [
      labelOf(item),
      item.querySelector(".luke-menu-item-detail")?.textContent,
      item.getAttribute("aria-label"),
    ]);

  assert.deepEqual(rows, [
    ["Personal", "Personal workspace", "Personal, Personal workspace"],
    ["acme", "5 members", "acme, 5 members"],
    ["Solo", "1 member", "Solo, 1 member"],
    ["Uncounted", undefined, null],
  ]);
});

test("the head says who shares the workspace, to the eye and to a screen reader: its members counted beside a people glyph, the account's own first workspace of one as personal in words alone, a team of one as its one member, and nothing where the service counts none", () => {
  const shared = (memberCount?: number, first = true) => {
    const workspace = memberCount === undefined ? ACME : { ...ACME, memberCount };
    const page = mount({
      workspaces: first ? [workspace, PERSONAL] : [PERSONAL, workspace],
      workspace,
    });
    const head = page.switcher();
    const line = head?.querySelector(".sidebar-workspace-shared");
    const said = line ? [line.textContent, line.querySelectorAll("svg").length] : null;
    const heard = head?.getAttribute("aria-label");
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = "";
    return [head?.querySelector(".workspace-tile")?.textContent, said, heard];
  };

  assert.deepEqual(shared(5), ["A", ["5 members", 1], "Workspace: acme, 5 members"]);
  assert.deepEqual(shared(1), [
    "A",
    ["Personal workspace", 0],
    "Workspace: acme, Personal workspace",
  ]);
  assert.deepEqual(shared(1, false), ["A", ["1 member", 1], "Workspace: acme, 1 member"]);
  assert.deepEqual(shared(undefined), ["A", null, "Workspace: acme"]);
});
