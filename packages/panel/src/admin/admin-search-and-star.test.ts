// @vitest-environment jsdom
import type { AdminUserList, AdminWorkspaceList } from "@luke/features/admin-answer-wire";
import { ADMIN_WORKSPACES_KIND } from "@luke/features/admin-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { rendererRegistry } from "../renderer-runtime.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost } from "../toast.js";
import { type AdminDoors, AdminDoorsProvider, type AdminReads } from "./admin-doors.js";
import { UsersScreen } from "./screens/users.js";
import { WorkspacesScreen } from "./screens/workspaces.js";

/**
 * admin-search-and-star.test.ts -- the Users and Workspaces pages as a reader
 * meets them once read: a search finds each word it holds wherever the row
 * keeps it, an empty table says whether a search emptied it, and a star the
 * service refuses says so and goes back. Synthetic accounts.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const JANE = {
  id: "account-jane",
  name: "Jane Doe",
  email: "jane@acme.test",
  image: null,
  admin: false,
  createdAt: Date.UTC(2026, 0, 5),
  activeDays: 1,
  lastActiveDay: null,
  lastSeenAt: null,
  calls: 0,
  favorite: false,
};

const BOB = { ...JANE, id: "account-bob", name: "Bob Ross", email: "bob@initech.test" };

function usersList(rows: AdminUserList["rows"], search?: string): AdminUserList {
  return {
    generatedAt: Date.UTC(2026, 9, 24),
    windowDays: 30,
    total: rows.length,
    limit: 200,
    search,
    signIn: { accounts: rows.length, methods: { github: rows.length, google: 0, other: 0 } },
    rows,
  };
}

const QUIET = {
  hideAdmins: false,
  onHideAdminsChange: () => undefined,
  windowDays: 30,
  onWindowDaysChange: () => undefined,
  account: undefined,
  onSignOut: async () => undefined,
  onOpenAccount: () => undefined,
  frame: (content: React.JSX.Element) => content,
} as const;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  window.localStorage.clear();
  document.body.replaceChildren();
});

/** Draws `screen` with the box already holding `search`, over `reads`, beside the window's toasts. */
async function draw(
  screen: React.ReactElement,
  reads: Partial<AdminReads>,
  search = "",
): Promise<HTMLElement> {
  const unanswered = () => Promise.withResolvers<never>().promise;
  const doors: AdminDoors = {
    reads: {
      metrics: unanswered,
      cost: unanswered,
      reliability: unanswered,
      users: unanswered,
      user: unanswered,
      day: unanswered,
      workspaces: unanswered,
      favorite: async () => true,
      ...reads,
    },
    gate: {
      heldAtGate: () => false,
      signedOut: () => createElement("p", null, "Signed out"),
      forbidden: () => createElement("p", null, "Forbidden"),
    },
    address: {
      accountHref: () => undefined,
      search: () => search,
      keepSearch: () => undefined,
      onSearchMoved: () => () => undefined,
    },
  };
  const page = document.body.appendChild(document.createElement("div"));
  const root = createRoot(page);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        rendererRegistry,
        createElement(AdminDoorsProvider, { value: doors }, screen, createElement(ToastHost, {})),
      ),
    ),
  );
  return page;
}

/** The names the accounts table lists, in order. */
function listedNames(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("tbody tr"), (row) => row.textContent ?? "");
}

test("a search of two words finds the account whose name holds one and whose email holds the other", async () => {
  const page = await draw(
    createElement(UsersScreen, QUIET),
    { users: async () => usersList([JANE, BOB]) },
    "jane acme",
  );
  const rows = listedNames(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toContain("Jane Doe");
  expect(page.textContent).toContain("1 of 2 accounts");
});

test("a roster the search emptied says no accounts match, and an empty one says none yet", async () => {
  const searched = await draw(
    createElement(UsersScreen, QUIET),
    { users: async () => usersList([JANE]) },
    "jane initech",
  );
  expect(searched.textContent).toContain("No accounts match");

  const bare = await draw(createElement(UsersScreen, QUIET), { users: async () => usersList([]) });
  expect(bare.textContent).toContain("No accounts yet");
  expect(bare.textContent).not.toContain("No accounts match");
});

function workspacesList(): AdminWorkspaceList {
  return {
    generatedAt: Date.UTC(2026, 9, 24),
    activityDays: 7,
    kind: ADMIN_WORKSPACES_KIND.ALL,
    total: 0,
    limit: 200,
    search: undefined,
    summary: {
      shared: 0,
      sharedActiveWeek: 0,
      invitations: { accepted: 0, pending: 0, expired: 0, settled: 0, acceptanceRate: null },
      github: { sharedWithActive: 0, sharedWithSuspended: 0, activeShare: null },
    },
    rows: [],
  };
}

test("a workspace table says no workspaces match only when a search emptied it", async () => {
  const reads = { workspaces: async () => workspacesList() };
  const searched = await draw(createElement(WorkspacesScreen, QUIET), reads, "north wind");
  expect(searched.textContent).toContain("No workspaces match");

  const bare = await draw(createElement(WorkspacesScreen, QUIET), reads);
  expect(bare.textContent).toContain("No workspaces yet");
});

test("a star the service refuses goes back and says so in a toast", async () => {
  const page = await draw(createElement(UsersScreen, QUIET), {
    users: async () => usersList([JANE]),
    favorite: async () => false,
  });
  const star = () => page.querySelector<HTMLButtonElement>('button[aria-label$="Jane Doe"]');
  expect(star()?.getAttribute("aria-label")).toBe("Favorite Jane Doe");

  await act(async () => star()?.click());

  expect(star()?.getAttribute("aria-label")).toBe("Favorite Jane Doe");
  expect(document.body.textContent).toContain("The favorite could not be saved. Try again.");
});
