// @vitest-environment jsdom
import type { AdminMetrics } from "@luke/service/admin/admin-metrics";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountScreen } from "../src/admin/screens/account";
import { CostScreen } from "../src/admin/screens/cost";
import { DashboardScreen } from "../src/admin/screens/dashboard";
import { DayScreen } from "../src/admin/screens/day";
import { ReliabilityScreen } from "../src/admin/screens/reliability";
import { UsersScreen } from "../src/admin/screens/users";
import { WorkspacesScreen } from "../src/admin/screens/workspaces";
import type { AdminRead } from "../src/admin/use-admin-read";

/**
 * admin-page-frame.test.ts -- every admin screen stands under the app's
 * toolbar, its title, or its way back and its name, at the start and its
 * controls at the end, loading or failed alike: a read that failed says why
 * in the page under that toolbar, with Retry, rather than in a page of its
 * own that drops the title and the controls, and an account no row carries
 * says it was not found under the same toolbar, its way back still there.
 * The network, the HTTP boundary to Luke, is a fake that refuses each read,
 * or leaves it hanging.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** One screen as a maintainer reaches it, and the toolbar it should stand under. */
interface Screen {
  readonly name: string;
  /** The screen, handed whether its read is hanging, so the dashboard's own read can say so. */
  readonly element: (hanging: boolean) => React.ReactElement;
  /** The words the toolbar heads the page with, its way back's first where it has one. */
  readonly heading: string;
  /** Words each of the toolbar's controls reads. */
  readonly controls: readonly string[];
}

const WINDOWS = "7d30d90d";

const HIDE_ADMINS = "Hide admins";

const NO_ANSWER = "The metrics endpoint did not answer.";

/** Every prop a screen asks of its shell that this file does not watch. */
const SHELL = {
  hideAdmins: false,
  onHideAdminsChange: () => undefined,
  windowDays: 7,
  onWindowDaysChange: () => undefined,
  account: undefined,
  onSignOut: async () => undefined,
  onOpenAccount: () => undefined,
  frame: (content: React.JSX.Element) => content,
} as const;

/** The dashboard's read, which its shell holds, failed or still out. */
function metricsRead(hanging: boolean): AdminRead<AdminMetrics> {
  return hanging ? { status: "loading" } : { status: "error", detail: NO_ANSWER };
}

const SCREENS: readonly Screen[] = [
  {
    name: "Overview",
    element: (hanging) =>
      createElement(DashboardScreen, {
        ...SHELL,
        read: {
          state: metricsRead(hanging),
          refreshing: false,
          reload: () => undefined,
          withdraw: async () => undefined,
          revise: () => undefined,
        },
        onOpenDay: () => undefined,
      }),
    heading: "Overview",
    controls: [WINDOWS, HIDE_ADMINS],
  },
  {
    name: "Cost",
    element: () => createElement(CostScreen, SHELL),
    heading: "Cost",
    controls: [WINDOWS, HIDE_ADMINS],
  },
  {
    name: "Reliability",
    element: () => createElement(ReliabilityScreen, SHELL),
    heading: "Reliability",
    controls: [HIDE_ADMINS],
  },
  {
    name: "Users",
    element: () => createElement(UsersScreen, SHELL),
    heading: "Users",
    controls: [WINDOWS, HIDE_ADMINS],
  },
  {
    name: "Workspaces",
    element: () => createElement(WorkspacesScreen, SHELL),
    heading: "Workspaces",
    controls: ["Shared only", HIDE_ADMINS],
  },
  {
    name: "an account",
    element: () =>
      createElement(AccountScreen, { ...SHELL, id: "account-ada", onBack: () => undefined }),
    heading: "UsersAccount",
    controls: [WINDOWS],
  },
  {
    name: "a day",
    element: () =>
      createElement(DayScreen, { ...SHELL, day: "2026-10-12", onBack: () => undefined }),
    heading: "OverviewOctober 12, 2026",
    controls: [HIDE_ADMINS],
  },
];

let root: Root | undefined;

/** jsdom's stand-in for the browser's ResizeObserver, which it lacks; the page is never resized. */
class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.replaceChildren();
});

/** `screen` with every read answered by `status`, or left hanging without one. */
async function open(screen: Screen, status: number | undefined): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    status === undefined
      ? new Promise(() => undefined)
      : Promise.resolve(new Response(null, { status })),
  );
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => root?.render(screen.element(status === undefined)));
  return page;
}

/** The toolbar heading the page, inside the page's own landmark. */
function toolbar(page: HTMLElement): HTMLElement {
  const found = page.querySelector<HTMLElement>("main header.desktop-toolbar");
  if (found === null) throw new Error("no toolbar heads the page");
  return found;
}

/** The toolbar's heading, its title or its way back and the page's name. */
function heading(page: HTMLElement): string {
  return toolbar(page).querySelector(".desktop-toolbar-heading")?.textContent ?? "";
}

/** The toolbar's controls at its end. */
function controls(page: HTMLElement): string {
  return toolbar(page).querySelector(".desktop-toolbar-actions")?.textContent ?? "";
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
    heading: "UsersAccount",
    controls: [WINDOWS],
  };
  const page = await open(account, 404);

  expect(heading(page)).toBe("UsersAccount");
  expect(controls(page)).toContain(WINDOWS);
  expect(page.querySelector("main")?.textContent).toContain(
    "Not foundThis account doesn't exist, or you don't have access to it.",
  );
  const back = Array.from(toolbar(page).querySelectorAll("button")).find(
    (button) => button.textContent === "Users",
  );
  act(() => back?.click());
  expect(backs).toHaveLength(1);
});
