// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { factoryWorldOf } from "@luke/ui/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DesktopFactory } from "../desktop/desktop-factory.js";
import { fakeAppBridge, fakeAppBridgeCalls } from "../testing/app-bridge.js";
import { stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";

/**
 * world-picker.test.ts -- the Factory toolbar's picker: the board first and what the page opens on, the campus after it and nothing else, the campus chosen standing in the board's place until the board is chosen again, the choice kept while Factory closes and opens in the same session, and nothing of it standing where Factory's experiment is off.
 *
 * What the campus draws is `campus/campus-scene.test.ts`'s and the page's
 * chrome `world-page.test.ts`'s.
 */

const WORKSPACE: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

let root: Root | undefined;
/** Every workspace whose world was read, in order. */
let asked: string[] = [];

/** Main's document with Factory's experiment as given. */
function launch({ factory }: { factory: boolean }): void {
  const snapshot = stateWith(factory ? experimentsOn(EXPERIMENT.FACTORY) : {}, {});
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(snapshot),
  });
}

beforeEach(() => {
  asked = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.FACTORY_WORLD) throw new Error(`unexpected ${request.kind}`);
      asked.push(request.payload.workspaceId);
      const value = { world: factoryWorldOf() };
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Factory over the listed workspace, on `registry`: the window's session. */
function mount(registry = AtomRegistry.make()): HTMLElement {
  act(() => root?.unmount());
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tasks = tasksControl({
    workspace: WORKSPACE,
    factoryView: { open: true, onOpen: () => undefined, onClose: () => undefined },
  });
  act(() => root?.render(onRegistry(registry, createElement(DesktopFactory, { tasks }))));
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The picker in the toolbar, named for what it shows; nothing where it does not stand. */
function picker(page: HTMLElement): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>('.desktop-toolbar button[aria-label^="View"]');
}

/** Opens the picker and answers its entries' words, in order. */
function entries(page: HTMLElement): string[] {
  const found = picker(page);
  assert.ok(found, "the picker stands");
  act(() => found.click());
  return [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );
}

function choose(page: HTMLElement, name: string): void {
  const offered = entries(page);
  assert.ok(offered.includes(name), `${name} is offered`);
  const item = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find(
    (each) => each.textContent === name,
  );
  act(() => item?.click());
}

/** Whether the board's stations stand, rather than the campus. */
function boardStands(page: HTMLElement): boolean {
  return (
    page.querySelector('section[aria-label="Factory"]') !== null &&
    page.querySelector(".factory-world") === null
  );
}

test("Factory opens on the board, its picker offering the board, then the campus, and nothing else", async () => {
  launch({ factory: true });
  const page = mount();
  await settle();
  assert.equal(picker(page)?.getAttribute("aria-label"), "View: Board");
  assert.ok(boardStands(page));
  assert.deepEqual(entries(page), ["Board", "Campus"]);
  assert.deepEqual(asked, [], "no world is read while the board stands");
});

test("the campus chosen stands in the board's place over the listed workspace's world; the board chosen again puts the board back", async () => {
  launch({ factory: true });
  const page = mount();
  await settle();
  choose(page, "Campus");
  await settle();
  assert.equal(picker(page)?.getAttribute("aria-label"), "View: Campus");
  assert.ok(!boardStands(page));
  assert.deepEqual(asked, [WORKSPACE.id]);
  assert.ok(page.querySelector(".factory-campus-scene"), "the campus is drawn");

  choose(page, "Board");
  await settle();
  assert.ok(boardStands(page));
  assert.equal(picker(page)?.getAttribute("aria-label"), "View: Board");
});

test("the campus chosen stands when Factory is opened again in the same session, and a new session opens on the board", async () => {
  launch({ factory: true });
  const session = AtomRegistry.make();
  const first = mount(session);
  await settle();
  choose(first, "Campus");
  await settle();

  const again = mount(session);
  await settle();
  assert.equal(picker(again)?.getAttribute("aria-label"), "View: Campus");
  assert.ok(!boardStands(again));

  const next = mount(AtomRegistry.make());
  await settle();
  assert.ok(boardStands(next));
});

test("with Factory's experiment off, the picker does not stand and the board does", async () => {
  launch({ factory: false });
  const page = mount();
  await settle();
  assert.equal(picker(page), null);
  assert.ok(boardStands(page));
});
