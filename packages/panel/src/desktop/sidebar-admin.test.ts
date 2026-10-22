// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { fakeActPortAnswering, type SentPortAct } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-admin.test.ts -- the Admin row stands after Automations for an
 * admin alone, and a non-admin is drawn nothing in its place; its press
 * opens the window's Admin place rather than a browser, asking the host for
 * nothing; the place then takes the window, its own list where this sidebar
 * stood (`desktop-admin.test.ts`).
 */

const roots: Root[] = [];

/** Every act the sidebar sent, in order. */
let sent: SentPortAct[] = [];

beforeEach(() => {
  sent = [];
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The sidebar beside the work, for an account that is an admin or not. */
async function mount(admin: boolean): Promise<{ sidebar: HTMLElement; opened: number }> {
  handState({}, { access: { admin } });
  const counted = { opened: 0 };
  const tasks = tasksControl();
  const control = {
    ...tasks,
    adminView: {
      ...tasks.adminView,
      onOpen: () => {
        counted.opened += 1;
      },
    },
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopSidebar, { ...sidebarProps(control), room: SHELL_ROOM.WIDE }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return {
    sidebar: container,
    get opened() {
      return counted.opened;
    },
  };
}

/** The names of the rows the sidebar's places draw, top to bottom. */
function placeNames(sidebar: HTMLElement): string[] {
  const places = sidebar.querySelector(".sidebar-places") ?? assert.fail("the sidebar's places");
  return [...places.querySelectorAll(".luke-nav-item-name")].map((name) => name.textContent ?? "");
}

/** The Admin row, wherever it is drawn. */
function adminRow(sidebar: HTMLElement): HTMLElement | undefined {
  return [...sidebar.querySelectorAll<HTMLElement>(".luke-nav-item")].find(
    (row) => row.querySelector(".luke-nav-item-name")?.textContent === "Admin",
  );
}

test("an account that is no admin is drawn no Admin row, neither hidden nor held back", async () => {
  const { sidebar } = await mount(false);

  assert.equal(adminRow(sidebar), undefined);
  assert.doesNotMatch(sidebar.textContent ?? "", /Admin/u);
});

test("an admin's Admin row stands right after Automations", async () => {
  const { sidebar } = await mount(true);
  const names = placeNames(sidebar);

  assert.equal(names.at(-1), "Admin");
  assert.equal(names.at(-2), "Automations");
});

test("pressing the Admin row opens the window's Admin place and asks the host for nothing", async () => {
  const mounted = await mount(true);
  const row = adminRow(mounted.sidebar) ?? assert.fail("the Admin row");

  assert.ok(row instanceof HTMLButtonElement);
  act(() => row.click());
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });

  assert.equal(mounted.opened, 1);
  assert.deepEqual(sent, []);
});
