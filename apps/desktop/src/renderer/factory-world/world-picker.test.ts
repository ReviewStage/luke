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
import { fakeAppBridge, fakeAppBridgeCalls } from "#testing/app-bridge";
import { stateWith } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { onSideBundles, unlandedBundles } from "#testing/side-bundles";
import { tasksControl } from "#testing/tasks-control";
import { DesktopFactory } from "../desktop/desktop-factory";

/**
 * world-picker.test.ts -- the Factory toolbar's picker: the board first and what the page opens on, each world the build offers after it, a world chosen standing in the board's place until the board is chosen again, the choice kept while Factory closes and opens in the same session, the development build's test pattern offered in no packaged app, and nothing of it standing where Factory's experiment is off.
 *
 * The worlds' scene is never landed here (`unlandedBundles`), so a world
 * chosen stands at its wait; what it draws is `world-page.test.ts`'s.
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

/** Main's document with Factory's experiment as given, in a packaged app or a development build. */
function launch({ factory, packaged }: { factory: boolean; packaged: boolean }): void {
  const snapshot = stateWith(factory ? experimentsOn(EXPERIMENT.FACTORY) : {}, {});
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve({ ...snapshot, run: { ...snapshot.run, packaged } }),
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
  act(() =>
    root?.render(
      onRegistry(
        registry,
        onSideBundles(unlandedBundles(), createElement(DesktopFactory, { tasks })),
      ),
    ),
  );
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

/** Whether the board's stations stand, rather than a world. */
function boardStands(page: HTMLElement): boolean {
  return (
    page.querySelector('section[aria-label="Factory"]') !== null &&
    page.querySelector(".factory-world") === null
  );
}

test("Factory opens on the board, its picker offering the board first, then the worlds, and the development build's test pattern last", async () => {
  launch({ factory: true, packaged: false });
  const page = mount();
  await settle();
  assert.equal(picker(page)?.getAttribute("aria-label"), "View: Board");
  assert.ok(boardStands(page));
  const offered = entries(page);
  assert.equal(offered[0], "Board");
  assert.equal(offered.at(-1), "Test pattern");
  assert.deepEqual(asked, [], "no world is read while the board stands");
});

test("a world chosen stands in the board's place and reads the listed workspace's world; the board chosen again puts the board back", async () => {
  launch({ factory: true, packaged: false });
  const page = mount();
  await settle();
  choose(page, "Test pattern");
  await settle();
  assert.equal(picker(page)?.getAttribute("aria-label"), "View: Test pattern");
  assert.ok(!boardStands(page));
  assert.deepEqual(asked, [WORKSPACE.id]);

  choose(page, "Board");
  await settle();
  assert.ok(boardStands(page));
  assert.equal(picker(page)?.getAttribute("aria-label"), "View: Board");
});

test("the world chosen stands when Factory is opened again in the same session, and a new session opens on the board", async () => {
  launch({ factory: true, packaged: false });
  const session = AtomRegistry.make();
  const first = mount(session);
  await settle();
  choose(first, "Test pattern");
  await settle();

  const again = mount(session);
  await settle();
  assert.equal(picker(again)?.getAttribute("aria-label"), "View: Test pattern");
  assert.ok(!boardStands(again));

  const next = mount(AtomRegistry.make());
  await settle();
  assert.ok(boardStands(next));
});

test("a packaged app opens on the board and offers its worlds, but not the development build's test pattern", async () => {
  launch({ factory: true, packaged: true });
  const page = mount();
  await settle();
  assert.ok(boardStands(page));
  const offered = entries(page);
  assert.equal(offered[0], "Board");
  assert.ok(offered.length > 1, "a world is offered");
  assert.ok(!offered.includes("Test pattern"));
});

test("with Factory's experiment off, no world is offered", async () => {
  launch({ factory: false, packaged: false });
  const page = mount();
  await settle();
  assert.equal(picker(page), null);
  assert.ok(boardStands(page));
});
