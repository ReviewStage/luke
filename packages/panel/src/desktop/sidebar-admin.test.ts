// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { tellAct } from "../act.js";
import type { AppPlatform } from "../app-platform.js";
import { SHELL_ROOM } from "../shell-room.js";
import { fakeActPortAnswering, type SentPortAct } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-admin.test.ts -- the Admin row stands after Automations for an
 * admin alone, and a non-admin is drawn nothing in its place; in a browser
 * tab it is a link to the dashboard in a tab of its own, and in the Mac app
 * its press asks the host to open the dashboard, naming no address; and it
 * is never the place shown.
 */

/** The dashboard's page as a browser tab's platform names it, on the tab's own origin. */
const WEB_ADMIN = "https://luke.test/admin";

/** A browser tab's way to the dashboard: a link to its page (`web-platform.ts`). */
const WEB: Pick<AppPlatform, "adminDashboard"> = {
  adminDashboard: () => ({ href: WEB_ADMIN }),
};

/** The Mac app's way to the dashboard: a press that asks the host to open it (`desktop-platform.ts`). */
const DESKTOP: Pick<AppPlatform, "adminDashboard"> = {
  adminDashboard: () => ({ open: () => tellAct(ACT_KIND.ADMIN_OPEN) }),
};

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

/** The sidebar beside the work, for an account that is an admin or not, on the platform given. */
async function mount(
  admin: boolean,
  platform: Pick<AppPlatform, "adminDashboard">,
): Promise<HTMLElement> {
  fakeAppPlatform(platform);
  handState({}, { access: { admin, nativeAgents: false } });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopSidebar, { ...sidebarProps(tasksControl()), room: SHELL_ROOM.WIDE }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
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
  for (const platform of [WEB, DESKTOP]) {
    const sidebar = await mount(false, platform);

    assert.equal(adminRow(sidebar), undefined);
    assert.doesNotMatch(sidebar.textContent ?? "", /Admin/u);
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
  }
});

test("an admin's Admin row stands right after Automations", async () => {
  const sidebar = await mount(true, DESKTOP);
  const names = placeNames(sidebar);

  assert.equal(names.at(-1), "Admin");
  assert.equal(names.at(-2), "Automations");
});

test("in a browser tab the Admin row is a link to the dashboard that opens in a tab of its own", async () => {
  const sidebar = await mount(true, WEB);
  const row = adminRow(sidebar) ?? assert.fail("the Admin row");

  assert.ok(row instanceof HTMLAnchorElement);
  assert.deepEqual(
    [row.getAttribute("href"), row.getAttribute("target"), row.getAttribute("rel")],
    [WEB_ADMIN, "_blank", "noopener"],
  );
  assert.equal(row.hasAttribute("aria-current"), false);
});

test("in the Mac app pressing the Admin row asks the host to open the dashboard, naming no address, and it never becomes the place shown", async () => {
  const sidebar = await mount(true, DESKTOP);
  const row = adminRow(sidebar) ?? assert.fail("the Admin row");

  assert.ok(row instanceof HTMLButtonElement);
  act(() => row.click());
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });

  assert.deepEqual(sent, [{ kind: ACT_KIND.ADMIN_OPEN }]);
  assert.equal(
    (adminRow(sidebar) ?? assert.fail("the Admin row")).hasAttribute("aria-current"),
    false,
  );
});
