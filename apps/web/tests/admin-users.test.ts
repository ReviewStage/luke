// @vitest-environment jsdom
import type { AdminUserList, AdminUserListRow } from "@repo/features/admin-answer-wire";
import { ADMIN_USERS_SEARCH_MAX_LENGTH } from "@repo/features/admin-wire";
import { UsersScreen } from "@repo/panel/admin/screens/users";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { readLanded, underWebAdminDoors } from "./support/admin-doors";

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
  favorite: false,
};

function roster(overrides: Partial<AdminUserList> = {}): AdminUserList {
  return {
    generatedAt: Date.UTC(2026, 9, 14, 12),
    windowDays: 30,
    total: 2,
    limit: 500,
    search: undefined,
    signIn: { accounts: 4, methods: { github: 3, google: 1, other: 0 } },
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

async function openUsers(body: AdminUserList | undefined): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    body === undefined ? new Promise(() => undefined) : Promise.resolve(answer(body)),
  );
  const page = await mount();
  if (body !== undefined) await readLanded(page);
  return page;
}

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
      await readLanded(page);
    },
  };
}

async function mount(): Promise<HTMLElement> {
  window.localStorage.setItem("app-admin-sign-in-chosen", "true");
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      underWebAdminDoors(
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
      ),
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

function type(box: HTMLInputElement, words: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, words);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

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
    "Reading users",
  );
  expect(page.querySelector("tbody a")).toBeNull();
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
  expect(page.textContent).toContain("No accounts match");
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

  expect(page.textContent).toContain("No accounts match");
  expect(page.textContent).toContain(
    "Only the 2 most recently active accounts are listed. Search reads every account.",
  );
});

test("a search is held to the service's own bound, however much is pasted", async () => {
  const page = await openUsers(roster());

  type(searchBox(page), "a".repeat(ADMIN_USERS_SEARCH_MAX_LENGTH + 20));

  expect(searchBox(page).value).toHaveLength(ADMIN_USERS_SEARCH_MAX_LENGTH);
});

test("clearing the search lists every account again and takes it out of the address", async () => {
  const page = await openUsers(roster());
  type(searchBox(page), "grace");

  const clear = page.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]');
  act(() => clear?.click());

  expect(searchBox(page).value).toBe("");
  expect(window.location.search).toBe("");
  expect(accounts(page)).toHaveLength(2);
});

test("under the roster, the sign-in methods count every account, whatever the search", async () => {
  const page = await openUsers(roster({ search: "ada", total: 1, rows: [ADA] }));

  const headings = Array.from(page.querySelectorAll("h2"), (heading) => heading.textContent);
  expect(headings).toContain("Sign-in methods");
  expect(page.textContent).toContain("Linked sign-in methods");
  expect(page.textContent).toContain("GitHubGoogle");
  expect(page.textContent).not.toContain("Other");
});

test("a search that finds nobody still shows how every kept account signs in", async () => {
  const page = await openUsers(roster({ search: "nobody", total: 0, rows: [] }));

  expect(page.textContent).toContain("No accounts match");
  expect(page.textContent).toContain("Linked sign-in methods");
  expect(page.textContent).toContain("GitHubGoogle");
});
