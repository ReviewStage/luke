// @vitest-environment jsdom
import type { AdminUserList, AdminUserListRow } from "@luke/service/admin/admin-users";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { UsersScreen } from "../src/admin/screens/users";

/**
 * admin-users.test.ts -- the roster names itself and its search before its
 * first answer lands, says it is loading, and takes typing then;
 * loaded, it counts and lists the accounts under the search, narrows them
 * at once as a maintainer types, and says no account matches in the table's
 * place when none does. The network, the HTTP boundary to Luke, is a fake
 * that answers the roster's read or leaves it hanging.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ADA: AdminUserListRow = {
  id: "account-ada",
  name: "Ada Lovelace",
  email: "ada@example.test",
  image: null,
  admin: true,
  createdAt: Date.UTC(2026, 8, 1),
  activeDays: 12,
  lastActiveDay: "2026-10-12",
  lastSeenAt: Date.UTC(2026, 9, 12),
  calls: 1204,
  favorite: false,
};

const GRACE: AdminUserListRow = {
  id: "account-grace",
  name: "Grace Hopper",
  email: "grace@example.test",
  image: null,
  admin: false,
  createdAt: Date.UTC(2026, 9, 2),
  activeDays: 3,
  lastActiveDay: null,
  lastSeenAt: null,
  calls: 37,
  favorite: false,
};

/** A synthetic roster of two accounts, both listed. */
function roster(overrides: Partial<AdminUserList> = {}): AdminUserList {
  return {
    generatedAt: Date.UTC(2026, 9, 14, 12),
    windowDays: 30,
    total: 2,
    limit: 500,
    search: undefined,
    rows: [ADA, GRACE],
    ...overrides,
  };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

function answer(body: AdminUserList): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The roster's page, signed in, with its read answered by `body`, or left hanging without one. */
async function openUsers(body: AdminUserList | undefined): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    body === undefined ? new Promise(() => undefined) : Promise.resolve(answer(body)),
  );
  return mount();
}

/** The roster's page with its first read held until the returned `land` answers it with `body`. */
async function openUsersAnsweredLater(): Promise<{
  page: HTMLElement;
  land: (body: AdminUserList) => Promise<void>;
}> {
  let resolve: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((settle) => {
    resolve = settle;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => pending);
  const page = await mount();
  return {
    page,
    land: async (body) => {
      await act(async () => resolve(answer(body)));
    },
  };
}

async function mount(): Promise<HTMLElement> {
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      createElement(UsersScreen, {
        hideAdmins: false,
        onHideAdminsChange: () => undefined,
        windowDays: 30,
        onWindowDaysChange: () => undefined,
        account: undefined,
        onSignOut: async () => undefined,
        onOpenAccount: () => undefined,
        frame: (content) => content,
      }),
    );
  });
  return page;
}

function searchBox(page: HTMLElement): HTMLInputElement {
  const box = page.querySelector<HTMLInputElement>(
    'input[aria-label="Search accounts by name or email"]',
  );
  if (box === null) throw new Error("no search box");
  return box;
}

/** Types `words` into `box` the way React hears a keystroke. */
function type(box: HTMLInputElement, words: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, words);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Each body row's account cell, in the words it reads. */
function accounts(page: HTMLElement): string[] {
  return Array.from(
    page.querySelectorAll("tbody tr"),
    (row) => row.querySelector("a")?.textContent ?? "",
  );
}

test("before its first answer the roster names itself, says it is loading, and takes a search", async () => {
  const page = await openUsers(undefined);

  expect(page.querySelector("h1")?.textContent).toBe("Users");
  expect(page.querySelector('[role="status"][aria-busy="true"]')?.textContent).toContain(
    "Loading…",
  );
  expect(page.querySelector("table")).toBeNull();
  type(searchBox(page), "ada");
  expect(searchBox(page).value).toBe("ada");
  expect(window.location.search).toBe("?q=ada");
});

test("a loaded roster counts and lists its accounts under the search", async () => {
  const page = await openUsers(roster());

  expect(page.querySelector("h1")?.textContent).toBe("Users");
  expect(page.textContent).toContain("2 of 2 accounts");
  expect(accounts(page)).toEqual([
    expect.stringContaining("Ada Lovelace"),
    expect.stringContaining("Grace Hopper"),
  ]);
  expect(page.textContent).toContain("Last seen is the account's latest sign-in session");
});

test("typing narrows the loaded accounts at once and counts what is left", async () => {
  const page = await openUsers(roster());

  type(searchBox(page), "grace");

  expect(accounts(page)).toEqual([expect.stringContaining("Grace Hopper")]);
  expect(page.textContent).toContain("1 of 2 accounts");
});

test("a search no account answers says so in the table's place", async () => {
  const page = await openUsers(roster());

  type(searchBox(page), "nobody");

  expect(page.querySelector("table")).toBeNull();
  expect(page.textContent).toContain("No account matches.");
  expect(page.textContent).toContain("0 of 2 accounts");
  expect(searchBox(page).value).toBe("nobody");
});

test("a search typed while loading keeps its focus when the first answer lands", async () => {
  const { page, land } = await openUsersAnsweredLater();
  const box = searchBox(page);
  act(() => box.focus());
  type(box, "a");

  await land(roster());

  expect(searchBox(page)).toBe(box);
  expect(document.activeElement).toBe(box);
});

test("a miss among a truncated roster's loaded rows still says search reads every account", async () => {
  const page = await openUsers(roster({ total: 1284 }));

  type(searchBox(page), "nobody");

  expect(page.textContent).toContain("No account matches.");
  expect(page.textContent).toContain(
    "Only the 2 most recently active accounts are listed. Search reads every account.",
  );
});
