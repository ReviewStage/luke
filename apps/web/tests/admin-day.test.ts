// @vitest-environment jsdom
import type { AdminDayAccount, AdminDayDetail } from "@luke/service/admin/admin-day";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { DayScreen } from "../src/admin/screens/day";

/**
 * admin-day.test.ts -- one day's page names the day it covers and whether it
 * is still filling, states its totals and its accounts under their own
 * headings, busiest first with an admin marked in words, and moves the way a
 * maintainer asks: a plain press on an account or on the way back moves in
 * place, and a modified one is left to the browser's own gesture. The
 * network, the HTTP boundary to Luke, is a fake that answers the day's read.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DAY = "2026-10-12";

const ADA: AdminDayAccount = {
  id: "account-ada",
  name: "Ada Lovelace",
  email: "ada@example.test",
  image: null,
  admin: true,
  calls: 1204,
};

const GRACE: AdminDayAccount = {
  id: "account-grace",
  name: "",
  email: "grace@example.test",
  image: null,
  admin: false,
  calls: 37,
};

/** A synthetic past day, read two days after it closed, with two accounts of three listed. */
function detail(overrides: Partial<AdminDayDetail> = {}): AdminDayDetail {
  return {
    generatedAt: Date.UTC(2026, 9, 14, 12),
    day: DAY,
    limit: 2,
    totals: { accounts: 3, calls: 1250 },
    accounts: [ADA, GRACE],
    ...overrides,
  };
}

interface Opened {
  page: HTMLElement;
  opened: string[];
  backs: number[];
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
});

/** The day's page, signed in, with its read answered by `body`, or left hanging without one. */
async function openDay(body: AdminDayDetail | undefined): Promise<Opened> {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    body === undefined
      ? new Promise(() => undefined)
      : Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
  );
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
  const opened: string[] = [];
  const backs: number[] = [];
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      createElement(DayScreen, {
        day: DAY,
        hideAdmins: false,
        onHideAdminsChange: () => undefined,
        account: undefined,
        onSignOut: async () => undefined,
        onBack: () => backs.push(backs.length),
        onOpenAccount: (id) => opened.push(id),
        frame: (content) => content,
      }),
    );
  });
  return { page, opened, backs };
}

function headings(page: HTMLElement, level: string): string[] {
  return Array.from(page.querySelectorAll(level), (heading) => heading.textContent ?? "");
}

/** Each table row's cells, in the words they read. */
function rows(page: HTMLElement): string[][] {
  return Array.from(page.querySelectorAll("tr"), (row) =>
    Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent ?? ""),
  );
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

test("a loaded day names itself and states its totals and accounts under their headings", async () => {
  const { page } = await openDay(detail());

  expect(headings(page, "h1")).toEqual(["Day", "October 12, 2026"]);
  expect(page.textContent).toContain("One UTC day of hosted-tier calls");
  expect(page.textContent).not.toContain("still filling");
  expect(headings(page, "h2")).toEqual(["Hosted tier · this day", "Accounts active this day"]);
  expect(page.textContent).toContain("Active accounts3");
  expect(page.textContent).toContain("Hosted calls1,250");
});

test("the accounts read busiest first, an admin marked in words and an email shown once", async () => {
  const { page } = await openDay(detail());

  expect(rows(page)).toEqual([
    ["Account", "Calls"],
    ["AAda LovelaceAdminada@example.test", "1,204"],
    ["Ggrace@example.test", "37"],
  ]);
  expect(page.textContent).toContain(
    "Only the 2 busiest accounts are listed. The totals count all 3.",
  );
});

test("today's page says it is still filling and counts its totals so far", async () => {
  const { page } = await openDay(detail({ generatedAt: Date.UTC(2026, 9, 12, 15) }));

  expect(page.textContent).toContain("One UTC day of hosted-tier calls — still filling");
  expect(page.textContent).toContain("Active accounts3so far today");
});

test("a day with no calls says so in place of the table, with no note under it", async () => {
  const { page } = await openDay(
    detail({ totals: { accounts: 0, calls: 0 }, accounts: [], limit: 50 }),
  );

  expect(page.querySelector("table")).toBeNull();
  expect(page.textContent).toContain("No hosted-tier calls recorded on this day.");
  expect(page.textContent).not.toContain("Voice and attention count");
});

test("a plain press on an account or its row opens it; a modified press is the browser's", async () => {
  const { page, opened } = await openDay(detail());
  const name = link(page, "Ada Lovelace");

  expect(name.getAttribute("href")).toContain("account-ada");
  expect(press(name)).toBe(true);
  expect(press(name, { metaKey: true })).toBe(false);
  const graceRow = page.querySelectorAll("tbody tr")[1];
  if (graceRow === undefined) throw new Error("no second row");
  press(graceRow.querySelector("td:last-child") ?? graceRow);

  expect(opened).toEqual(["account-ada", "account-grace"]);
});

test("the way back to the dashboard moves in place on a plain press, loading or loaded", async () => {
  const loading = await openDay(undefined);
  expect(headings(loading.page, "h1")).toEqual(["Day", "October 12, 2026"]);
  expect(press(link(loading.page, "Dashboard"))).toBe(true);
  expect(loading.backs).toHaveLength(1);
  act(() => root?.unmount());

  const loaded = await openDay(detail());
  const back = link(loaded.page, "Dashboard");
  expect(press(back, { ctrlKey: true })).toBe(false);
  expect(press(back)).toBe(true);
  expect(loaded.backs).toHaveLength(1);
});
