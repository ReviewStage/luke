// @vitest-environment jsdom
import type { AdminUserDetail } from "@luke/service/admin/admin-user";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountScreen } from "../src/admin/screens/account";

/**
 * admin-account.test.ts -- one account's page names the account, marks an
 * admin in words, says when it joined and how it signs in, states its daily
 * use and its volume under their own headings, and moves the way a
 * maintainer asks: a plain press on the way back moves in place, loading or
 * loaded, and a modified one is left to the browser's own gesture; an id no
 * account carries offers the way back too. The network, the HTTP boundary to
 * Luke, is a fake that answers the account's read.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ID = "account-ada";

/** A synthetic admin account read on a fixed day, with a week of hosted use. */
function detail(overrides: Partial<AdminUserDetail["account"]> = {}): AdminUserDetail {
  return {
    generatedAt: Date.UTC(2026, 9, 14, 12),
    windowDays: 30,
    account: {
      id: ID,
      name: "Ada Lovelace",
      email: "ada@example.test",
      image: null,
      admin: true,
      createdAt: Date.UTC(2026, 0, 5),
      signInMethods: ["github", "google"],
      ...overrides,
    },
    activity: {
      daily: [
        { day: "2026-10-13", calls: 40 },
        { day: "2026-10-14", calls: 2 },
      ],
      calendarDaily: [
        { day: "2026-10-13", calls: 40 },
        { day: "2026-10-14", calls: 2 },
      ],
      usageTrend: { days: 7, recent: 42, prior: 10 },
      activeDaysWindow: 12,
      activeDaysTrend: { days: 7, recent: 5, prior: 3 },
      currentStreakDays: 1,
      callsWindow: 1234567,
      allTime: {
        activeDays: 48,
        firstActiveDay: "2026-01-06",
        lastActiveDay: "2026-10-14",
        calls: 2345678,
      },
    },
  };
}

interface Opened {
  page: HTMLElement;
  backs: number[];
}

let root: Root | undefined;

/** jsdom's stand-in for the browser's ResizeObserver, which it lacks; the page is never resized. */
class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.replaceChildren();
});

/** The account's page, signed in, with its read answered by `response`, or left hanging without one. */
async function openAccount(response: Response | undefined): Promise<Opened> {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    response === undefined ? new Promise(() => undefined) : Promise.resolve(response),
  );
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
  const backs: number[] = [];
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      createElement(AccountScreen, {
        id: ID,
        windowDays: 30,
        onWindowDaysChange: () => undefined,
        account: undefined,
        onSignOut: async () => undefined,
        onBack: () => backs.push(backs.length),
        frame: (content) => content,
      }),
    );
  });
  return { page, backs };
}

function answer(body: AdminUserDetail): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function headings(page: HTMLElement, level: string): string[] {
  return Array.from(page.querySelectorAll(level), (heading) => heading.textContent ?? "");
}

function link(page: HTMLElement, words: string): HTMLAnchorElement {
  const found = Array.from(page.querySelectorAll("a")).find((anchor) =>
    anchor.textContent?.includes(words),
  );
  if (found === undefined) throw new Error(`no link reading ${words}`);
  return found;
}

/** A primary-button press on `target`, modified as asked; whether the page took it over. */
function press(target: Element, init: MouseEventInit = {}): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

test("a loaded account names itself, marks an admin in words, and says how it signs in", async () => {
  const { page } = await openAccount(answer(detail()));

  expect(headings(page, "h1")).toEqual(["Ada Lovelace"]);
  expect(page.textContent).toContain("ada@example.testAdmin");
  expect(page.textContent).toContain("ada@example.test");
  expect(page.textContent).toContain("Joined Jan 5, 2026 · signs in with GitHub, Google");
});

test("an account that is no admin and links no provider says neither", async () => {
  const { page } = await openAccount(answer(detail({ admin: false, signInMethods: [] })));

  expect(page.textContent).not.toContain("Admin");
  expect(page.textContent).not.toContain("signs in with");
  expect(page.textContent).toContain("Joined Jan 5, 2026");
});

test("the account's daily use and volume stand under their own headings", async () => {
  const { page } = await openAccount(answer(detail()));

  expect(headings(page, "h2")).toEqual(
    expect.arrayContaining(["Daily use · hosted tier", "Volume"]),
  );
  expect(page.textContent).toContain("Active days · 30 days12of 30 window days");
  expect(page.textContent).toContain("Current streak1 day");
  expect(page.textContent).toContain("Last activeOct 14first active Jan 6");
  expect(page.textContent).toContain("Hosted calls · 30 days1,234,5672,345,678 all time");
  expect(page.textContent).toContain("Active days · all time48");
});

test("the way back to the users moves in place on a plain press, loading or loaded", async () => {
  const loading = await openAccount(undefined);
  expect(press(link(loading.page, "All users"))).toBe(true);
  expect(loading.backs).toHaveLength(1);
  act(() => root?.unmount());

  const loaded = await openAccount(answer(detail()));
  const back = link(loaded.page, "All users");
  expect(back.getAttribute("href")).toContain("users");
  expect(press(back, { metaKey: true })).toBe(false);
  expect(press(back)).toBe(true);
  expect(loaded.backs).toHaveLength(1);
});

test("an id no account carries says so and offers the way back to the users", async () => {
  const { page, backs } = await openAccount(new Response(null, { status: 404 }));

  expect(headings(page, "h1")).toEqual(["No such account"]);
  const back = Array.from(page.querySelectorAll("button")).find(
    (button) => button.textContent === "Back to users",
  );
  if (back === undefined) throw new Error("no way back");
  press(back);
  expect(backs).toHaveLength(1);
});
