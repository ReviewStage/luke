// @vitest-environment jsdom

/**
 * app-redraws.test.ts -- what a delivery of main's document draws again in the window: a patch to the settings alone draws the settings' readers and none of the tasks' columns, and a patch to the tasks draws the tasks' columns.
 *
 * The window is drawn whole through `App`, on a fake bridge that delivers
 * each document as main would, a new tree each time. What is drawn again is
 * read through wrappers around three surfaces that draw the real ones:
 * ⌘K, which reads the settings, the sidebar's foot, under the sidebar, and
 * the home page, under the Tasks column. Synthetic tasks.
 */

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { type AppBridge, bridgeEntries } from "@luke/host/bridge";
import { PUSH_METHOD } from "@luke/host/contract";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { memoryHistory } from "@luke/ui/history-adapter";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { App } from "./app.js";
import { installWindowHistory } from "./navigation-history.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { stateWith } from "./testing/app-state.js";

/** How many times each recorded surface was drawn, by its name. */
const draws = vi.hoisted(() => new Map<string, number>());

// Note that each wrapper draws the real surface beneath it and only counts,
// because what is under test is whether the window draws it, not what it draws.
vi.mock("./desktop/command-palette.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./desktop/command-palette.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    CommandPalette: (props: Parameters<typeof actual.CommandPalette>[0]) => {
      draws.set("palette", (draws.get("palette") ?? 0) + 1);
      return draw(actual.CommandPalette, props);
    },
  };
});
vi.mock("./desktop/sidebar-foot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./desktop/sidebar-foot.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    SidebarFoot: (props: Parameters<typeof actual.SidebarFoot>[0]) => {
      draws.set("sidebar", (draws.get("sidebar") ?? 0) + 1);
      return draw(actual.SidebarFoot, props);
    },
  };
});
vi.mock("./desktop/desktop-home.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./desktop/desktop-home.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    DesktopHome: (props: Parameters<typeof actual.DesktopHome>[0]) => {
      draws.set("home", (draws.get("home") ?? 0) + 1);
      return draw(actual.DesktopHome, props);
    },
  };
});

const AT = 1_792_000_000_000;

const INVITES: TaskSummary = {
  id: "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
  workspaceId: "workspace-acme",
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
};

/** Main's document for a signed-in account at `version`, no task listed. */
const FIRST: AppStateSnapshot = stateWith({}, {});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;
let listeners = new Set<(snapshot: AppStateSnapshot) => void>();

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  draws.clear();
  listeners = new Set();
  fakeAppPlatform({ ...QUIET_PANEL, applySessionReplay: () => undefined });
  installWindowHistory(memoryHistory());
  // Every bridge call is quiet but the two the document is read through, as a window with nothing else to hear.
  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke" ? () => Promise.resolve(undefined) : () => undefined,
    ]),
  ]);
  fakeAppBridge({
    ...quiet,
    requestAppState: () => Promise.resolve(structuredClone(FIRST)),
    onAppState: (listener: (snapshot: AppStateSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies Partial<AppBridge>);
  // Every act is refused, as a service that answers nothing would.
  fakeActPortAnswering(() => Promise.reject(refusedOnPort("Not here.")));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Lets every promise settled so far run its continuations, the window's state among them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 24; tick += 1) await Promise.resolve();
  });
}

/** The window drawn on main's first document, every surface's count then cleared. */
async function drawWindow(): Promise<void> {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      createElement(RegistryContext.Provider, { value: AtomRegistry.make() }, createElement(App)),
    ),
  );
  await settle();
  assert.ok((draws.get("sidebar") ?? 0) > 0, "the sidebar stands");
  assert.ok((draws.get("home") ?? 0) > 0, "the home page stands");
  draws.clear();
}

/** Delivers `snapshot` as main would, a new tree, and lets the window draw what it draws. */
async function deliver(snapshot: AppStateSnapshot): Promise<void> {
  act(() => {
    for (const listener of listeners) listener(structuredClone(snapshot));
  });
  await settle();
}

test("a delivery that moves only the settings draws ⌘K again and neither the sidebar nor the home page", async () => {
  await drawWindow();
  await deliver({
    ...FIRST,
    version: 2,
    settings: appSettingsWire(settingsView({ duckOtherMedia: false })),
  });
  assert.ok((draws.get("palette") ?? 0) > 0, "⌘K, which reads the settings, is drawn again");
  assert.equal(draws.get("sidebar") ?? 0, 0, "the sidebar is not drawn again");
  assert.equal(draws.get("home") ?? 0, 0, "the home page is not drawn again");
});

test("a delivery that moves the tasks draws the sidebar and the home page again", async () => {
  await drawWindow();
  await deliver({ ...FIRST, version: 2, tasks: { ...IDLE_TASKS_VIEW, tasks: [INVITES] } });
  assert.ok((draws.get("sidebar") ?? 0) > 0, "the sidebar is drawn again");
  assert.ok((draws.get("home") ?? 0) > 0, "the home page is drawn again");
});
