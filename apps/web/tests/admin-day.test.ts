// @vitest-environment jsdom
import "@repo/panel/testing/resize-observer";
import type {
  AdminDayAccount,
  AdminDayActiveAccount,
  AdminDayDetail,
} from "@repo/features/admin-answer-wire";
import { DayScreen } from "@repo/panel/admin/screens/day";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { readLanded, underWebAdminDoors } from "./support/admin-doors";

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

const ADA_ACTIVE: AdminDayActiveAccount = {
  id: "account-ada",
  name: "Ada Lovelace",
  email: "ada@example.test",
  image: null,
  admin: true,
  counts: {
    tasksCreated: 3,
    descriptionRevisions: 14,
    agentsStarted: 9,
    inboxAnswered: 2,
    automationRuns: 1,
  },
};

const LIN_ACTIVE: AdminDayActiveAccount = {
  id: "account-lin",
  name: "Lin",
  email: "lin@example.test",
  image: null,
  admin: false,
  counts: {
    tasksCreated: 1,
    descriptionRevisions: 0,
    agentsStarted: 2,
    inboxAnswered: 0,
    automationRuns: 0,
  },
};

function detail(overrides: Partial<AdminDayDetail> = {}): AdminDayDetail {
  return {
    generatedAt: Date.UTC(2026, 9, 14, 12),
    day: DAY,
    limit: 2,
    activity: {
      features: {
        agentsStarted: 12,
        descriptionRevisions: 15,
        inboxAnswered: 2,
        automationRuns: 1,
      },
      activeDevelopers: 4,
      accounts: [ADA_ACTIVE, LIN_ACTIVE],
    },
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
  window.localStorage.setItem("app-admin-sign-in-chosen", "true");
  const opened: string[] = [];
  const backs: number[] = [];
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      underWebAdminDoors(
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
      ),
    );
  });
  if (body !== undefined) await readLanded(page);
  return { page, opened, backs };
}

function headings(page: HTMLElement, level: string): string[] {
  return Array.from(page.querySelectorAll(level), (heading) => heading.textContent ?? "");
}

function rows(page: HTMLElement, label: string): string[][] {
  const table = page.querySelector(`table[aria-label="${label}"]`);
  if (table === null) throw new Error(`no table named ${label}`);
  return Array.from(table.querySelectorAll("tr"), (row) =>
    Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent ?? ""),
  );
}

function wayBack(page: HTMLElement): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>('header nav[aria-label="Path"] button');
  if (found === null) throw new Error("no way back");
  return found;
}

function current(page: HTMLElement): string | undefined {
  return page.querySelector('header [aria-current="page"]')?.textContent ?? undefined;
}

function link(page: HTMLElement, words: string): HTMLAnchorElement {
  const found = Array.from(page.querySelectorAll("a")).find((anchor) =>
    anchor.textContent?.includes(words),
  );
  if (found === undefined) throw new Error(`no link reading ${words}`);
  return found;
}

function press(target: Element, init: MouseEventInit = {}): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

test("a loaded day names itself and states its totals and accounts under their headings", async () => {
  const { page } = await openDay(detail());

  expect(current(page)).toBe("October 12, 2026");
  expect(page.textContent).not.toContain("so far today");
  expect(headings(page, "h2")).toEqual([
    "This day",
    "Accounts active this day",
    "Hosted tier · this day · retired",
    "Hosted-tier accounts this day · retired",
  ]);
  expect(page.textContent).toContain("Active developers4");
  expect(page.textContent).toContain("Agents started12");
  expect(page.textContent).toContain("Description revisions15");
  expect(page.textContent).toContain("Inbox items answered2");
  expect(page.textContent).toContain("Automation runs1");
  expect(page.textContent).toContain("Active accounts3");
  expect(page.textContent).toContain("Hosted calls1,250");
});

test("the accounts read busiest first, an admin marked in words and an email shown once", async () => {
  const { page } = await openDay(detail());

  expect(rows(page, "Accounts active this day")).toEqual([
    ["Account", "Tasks", "Description revisions", "Agents", "Inbox answered", "Automation runs"],
    ["AAda LovelaceAdminada@example.test", "3", "14", "9", "2", "1"],
    ["LLinlin@example.test", "1", "0", "2", "0", "0"],
  ]);
  expect(page.textContent).toContain(
    "Only the 2 busiest accounts are listed. Active developers counts all 4.",
  );
  expect(rows(page, "Hosted-tier accounts this day")).toEqual([
    ["Account", "Calls"],
    ["AAda LovelaceAdminada@example.test", "1,204"],
    ["Ggrace@example.test", "37"],
  ]);
  expect(page.textContent).toContain(
    "Only the 2 busiest accounts are listed. The totals count all 3.",
  );
});

test("today's page counts its totals so far", async () => {
  const { page } = await openDay(detail({ generatedAt: Date.UTC(2026, 9, 12, 15) }));

  expect(page.textContent).toContain("Active developers4so far today");
  expect(page.textContent).toContain("Active accounts3so far today");
});

test("a day of agents and tasks with no calls lists its accounts and says the hosted tier is empty", async () => {
  const { page } = await openDay(
    detail({ totals: { accounts: 0, calls: 0 }, accounts: [], limit: 50 }),
  );

  expect(rows(page, "Accounts active this day")).toHaveLength(3);
  expect(page.querySelector('table[aria-label="Hosted-tier accounts this day"]')).toBeNull();
  expect(page.textContent).toContain("No hosted-tier calls recorded on this day.");
  expect(page.textContent).not.toContain("Calls count the hosted-tier calls");
});

test("a plain press on an account or its row opens it; a modified press is the browser's", async () => {
  const { page, opened } = await openDay(detail());
  const name = link(page, "Ada Lovelace");

  expect(name.getAttribute("href")).toContain("account-ada");
  expect(press(name)).toBe(true);
  expect(press(name, { metaKey: true })).toBe(false);
  const linRow = page.querySelectorAll("tbody tr")[1];
  if (linRow === undefined) throw new Error("no second row");
  press(linRow.querySelector("td:last-child") ?? linRow);

  expect(opened).toEqual(["account-ada", "account-lin"]);
});

test("the toolbar leads with the way back to the overview, which moves in place, loading or loaded", async () => {
  const loading = await openDay(undefined);
  expect(current(loading.page)).toBe("October 12, 2026");
  expect(wayBack(loading.page).textContent).toBe("Overview");
  act(() => wayBack(loading.page).click());
  expect(loading.backs).toHaveLength(1);
  act(() => root?.unmount());

  const loaded = await openDay(detail());
  act(() => wayBack(loaded.page).click());
  expect(loaded.backs).toHaveLength(1);
});
