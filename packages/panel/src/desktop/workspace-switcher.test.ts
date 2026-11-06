// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@repo/brand";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { WorkspaceSwitcher } from "./workspace-switcher.js";

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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
    switcher: () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]'),
    fold: () => render(false),
  };
}

function menuItems(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]',
    ),
  ];
}

function open(switcher: HTMLButtonElement | null): void {
  assert.ok(switcher, "the switcher heads the plans");
  act(() => switcher.click());
}

function labelOf(item: HTMLElement): string | null {
  return item.querySelector(".ui-menu-item-label")?.textContent ?? null;
}

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
    newWorkspace: { open: false, onOpen: () => pressed.push("new"), onClose: () => undefined },
  });

  open(page.switcher());
  const offered = menuItems().map((item) => [labelOf(item), item.getAttribute("aria-checked")]);
  choose("Personal");
  open(page.switcher());
  choose("New workspace");
  open(page.switcher());
  choose("Workspace settings");

  assert.equal(page.switcher()?.querySelector(".workspace-ref-name")?.textContent, "acme");
  assert.deepEqual(offered, [
    ["Personal", "false"],
    ["acme", "true"],
    ["New workspace", null],
    ["Workspace settings", null],
  ]);
  assert.deepEqual(pressed, [`choose:${PERSONAL.id}`, "new", "settings"]);
});

test("a workspace's row hangs its card while the pointer rests on it: its name and who shares it", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(private readonly heard: ResizeObserverCallback) {}
      observe(): void {
        this.heard([], this);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const page = mount({
    workspaces: [PERSONAL, { ...ACME, memberCount: 5 }],
    workspace: PERSONAL,
  });
  open(page.switcher());
  const row = menuItems().find((item) => labelOf(item) === "acme") ?? assert.fail("no acme row");

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  act(() => {
    vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
  });
  const card = document.querySelector("[data-workspace-card]");

  assert.match(card?.textContent ?? "", /acme/);
  assert.match(card?.textContent ?? "", /5 members/);
});

test("two workspaces named alike are two items of the menu", () => {
  const twin: Workspace = { ...ACME, id: "workspace-twin", slug: "acme-2" };
  const page = mount({ workspaces: [PERSONAL, ACME, twin], workspace: PERSONAL });
  open(page.switcher());

  assert.deepEqual(menuItems().map(labelOf).slice(0, 3), ["Personal", "acme", "acme"]);
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

test("each workspace in the menu wears its tile, its first letter, and a rename keeps the tile's hue", () => {
  const tiles = (workspaces: readonly Workspace[]) => {
    const page = mount({ workspaces, workspace: workspaces[0] });
    open(page.switcher());
    const drawn = menuItems()
      .map((item) => item.querySelector(".ui-avatar[data-shape='tile']"))
      .filter((tile) => tile !== null)
      .map((tile) => [tile.textContent, tile.getAttribute("data-hue")]);
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
      item.querySelector(".ui-menu-item-detail")?.textContent,
      item.getAttribute("aria-label"),
    ]);

  assert.deepEqual(rows, [
    ["Personal", "Personal workspace", "Personal, Personal workspace"],
    ["acme", "5 members", "acme, 5 members"],
    ["Solo", "1 member", "Solo, 1 member"],
    ["Uncounted", undefined, null],
  ]);
});

test("the head says who shares the workspace to a screen reader: its members counted, the account's own first workspace of one as personal, a team of one as its one member, and nothing where the service counts none", () => {
  const shared = (memberCount?: number, first = true) => {
    const workspace = memberCount === undefined ? ACME : { ...ACME, memberCount };
    const page = mount({
      workspaces: first ? [workspace, PERSONAL] : [PERSONAL, workspace],
      workspace,
    });
    const head = page.switcher();
    const heard = head?.getAttribute("aria-label");
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = "";
    return heard;
  };

  assert.equal(shared(5), "Workspace: acme, 5 members");
  assert.equal(shared(1), "Workspace: acme, Personal workspace");
  assert.equal(shared(1, false), "Workspace: acme, 1 member");
  assert.equal(shared(undefined), "Workspace: acme");
});
