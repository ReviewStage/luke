// @vitest-environment jsdom
import { AccountScreen } from "@repo/panel/admin/screens/account";
import { CostScreen } from "@repo/panel/admin/screens/cost";
import { DashboardScreen } from "@repo/panel/admin/screens/dashboard";
import { DayScreen } from "@repo/panel/admin/screens/day";
import { ReliabilityScreen } from "@repo/panel/admin/screens/reliability";
import { UsersScreen } from "@repo/panel/admin/screens/users";
import { WorkspacesScreen } from "@repo/panel/admin/screens/workspaces";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readLanded, underWebAdminDoors } from "./support/admin-doors";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

interface Screen {
  readonly name: string;
  readonly element: () => React.ReactElement;
  readonly heading: string;
  readonly controls: readonly string[];
}

const VIEW_OPTIONS = "View options";

const RANGE = "Last 7 days";

const SHELL = {
  hideAdmins: false,
  onHideAdminsChange: () => undefined,
  windowDays: 7,
  onWindowDaysChange: () => undefined,
  account: undefined,
  onSignOut: async () => undefined,
  onOpenAccount: () => undefined,
  onOpenWorkspace: () => undefined,
  frame: (content: React.JSX.Element) => content,
} as const;

const SCREENS: readonly Screen[] = [
  {
    name: "Overview",
    element: () => createElement(DashboardScreen, { ...SHELL, onOpenDay: () => undefined }),
    heading: `Overview${RANGE}`,
    controls: [VIEW_OPTIONS],
  },
  {
    name: "Cost",
    element: () => createElement(CostScreen, SHELL),
    heading: `Cost${RANGE}`,
    controls: [VIEW_OPTIONS],
  },
  {
    name: "Reliability",
    element: () => createElement(ReliabilityScreen, SHELL),
    heading: `Reliability${RANGE}`,
    controls: [VIEW_OPTIONS],
  },
  {
    name: "Users",
    element: () => createElement(UsersScreen, SHELL),
    heading: `Users${RANGE}`,
    controls: [VIEW_OPTIONS],
  },
  {
    name: "Workspaces",
    element: () => createElement(WorkspacesScreen, SHELL),
    heading: "Workspaces",
    controls: [VIEW_OPTIONS],
  },
  {
    name: "an account",
    element: () =>
      createElement(AccountScreen, { ...SHELL, id: "account-ada", onBack: () => undefined }),
    heading: `UsersAccount${RANGE}`,
    controls: [VIEW_OPTIONS],
  },
  {
    name: "a day",
    element: () =>
      createElement(DayScreen, { ...SHELL, day: "2026-10-12", onBack: () => undefined }),
    heading: "OverviewOctober 12, 2026",
    controls: [VIEW_OPTIONS],
  },
];

let root: Root | undefined;

class StillResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
  window.localStorage.setItem("app-admin-sign-in-chosen", "true");
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.replaceChildren();
});

async function open(screen: Screen, status: number | undefined): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    status === undefined
      ? new Promise(() => undefined)
      : Promise.resolve(new Response(null, { status })),
  );
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => root?.render(underWebAdminDoors(screen.element())));
  if (status !== undefined) await readLanded(page);
  return page;
}

function toolbar(page: HTMLElement): HTMLElement {
  const found = page.querySelector<HTMLElement>("main header.ui-toolbar");
  if (found === null) throw new Error("no toolbar heads the page");
  return found;
}

function heading(page: HTMLElement): string {
  return toolbar(page).querySelector(".ui-toolbar-heading")?.textContent ?? "";
}

function controls(page: HTMLElement): string {
  const actions = toolbar(page).querySelector(".ui-toolbar-actions");
  const named = [...(actions?.querySelectorAll("[aria-label]") ?? [])].map(
    (each) => each.getAttribute("aria-label") ?? "",
  );
  return [actions?.textContent ?? "", ...named].join(" ");
}

test.each(SCREENS)(
  "$name loads under the app's toolbar, its controls at its end",
  async (screen) => {
    const page = await open(screen, undefined);

    expect(heading(page)).toBe(screen.heading);
    for (const words of screen.controls) expect(controls(page)).toContain(words);
  },
);

test.each(SCREENS)(
  "$name keeps its toolbar when its read fails, with Retry in the page under it",
  async (screen) => {
    const page = await open(screen, 500);

    expect(heading(page)).toBe(screen.heading);
    for (const words of screen.controls) expect(controls(page)).toContain(words);
    const alert = page.querySelector("main [role=alert]");
    expect(alert).not.toBeNull();
    expect(toolbar(page).contains(alert)).toBe(false);
    expect(
      Array.from(page.querySelectorAll("main button")).some(
        (button) => button.textContent === "Retry",
      ),
    ).toBe(true);
  },
);

test("an id no account carries says it was not found under the page's toolbar, its way back still there", async () => {
  const backs: number[] = [];
  const account: Screen = {
    name: "a missing account",
    element: () =>
      createElement(AccountScreen, {
        ...SHELL,
        id: "account-gone",
        onBack: () => backs.push(backs.length),
      }),
    heading: `UsersAccount${RANGE}`,
    controls: [VIEW_OPTIONS],
  };
  const page = await open(account, 404);

  expect(heading(page)).toBe(`UsersAccount${RANGE}`);
  expect(controls(page)).toContain(VIEW_OPTIONS);
  expect(page.querySelector("main")?.textContent).toContain(
    "Not foundThis account doesn't exist, or you don't have access to it.",
  );
  const back = Array.from(toolbar(page).querySelectorAll("button")).find(
    (button) => button.textContent === "Users",
  );
  act(() => back?.click());
  expect(backs).toHaveLength(1);
});
