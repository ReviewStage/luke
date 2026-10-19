// @vitest-environment jsdom
import type { AdminWorkspaceList, AdminWorkspaceRow } from "@luke/service/admin/admin-workspaces";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS } from "../src/admin/routing";
import { WorkspacesScreen } from "../src/admin/screens/workspaces";

/**
 * admin-workspaces.test.ts -- the Workspaces tab heads its table with the
 * shared workspaces' four counts, lists each workspace with its owner,
 * GitHub installation, and integrations, narrows the rows as a maintainer
 * types, asks for every workspace once "Shared only" is cleared, and opens a
 * row's owner on a press. The network, the HTTP boundary to Luke, is a fake
 * that answers every read with the list given and writes down what it was
 * asked.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const NORTHWIND: AdminWorkspaceRow = {
  id: "workspace-northwind",
  name: "Northwind",
  personal: false,
  owner: {
    id: "account-grace",
    name: "Grace Hopper",
    email: "grace@example.test",
    image: null,
    admin: false,
  },
  members: 9,
  installations: [{ login: "northwind", status: "active" }],
  integrations: [
    { provider: "linear", status: "connected" },
    { provider: "notion", status: "expired" },
  ],
  tasksWeek: 14,
  agentsWeek: 52,
  prsMergedWeek: 21,
  createdAt: Date.UTC(2026, 7, 14),
};

const FELDSPAR: AdminWorkspaceRow = {
  ...NORTHWIND,
  id: "workspace-feldspar",
  name: "Feldspar",
  owner: null,
  members: 3,
  installations: [{ login: "feldspar-io", status: "suspended" }],
  integrations: [],
  tasksWeek: 1,
  agentsWeek: 0,
  prsMergedWeek: 0,
};

function workspaces(overrides: Partial<AdminWorkspaceList> = {}): AdminWorkspaceList {
  return {
    generatedAt: Date.UTC(2026, 9, 14, 12),
    activityDays: 7,
    kind: "shared",
    search: undefined,
    total: 2,
    limit: 200,
    summary: {
      shared: 20,
      sharedActiveWeek: 12,
      invitations: { accepted: 18, pending: 31, expired: 9, settled: 25, acceptanceRate: 0.72 },
      github: { sharedWithActive: 17, sharedWithSuspended: 6, activeShare: 0.85 },
    },
    rows: [NORTHWIND, FELDSPAR],
    ...overrides,
  };
}

let root: Root | undefined;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

/** The tab, signed in, with every read answered by `body`; answers the page, the addresses read, and the accounts opened. */
async function openWorkspaces(body: AdminWorkspaceList) {
  const asked: string[] = [];
  const opened: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    asked.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      createElement(WorkspacesScreen, {
        hideAdmins: true,
        onHideAdminsChange: () => undefined,
        account: undefined,
        onSignOut: async () => undefined,
        onOpenAccount: (id) => opened.push(id),
        frame: (content) => content,
      }),
    );
  });
  return { page, asked, opened };
}

/** Types `words` into the search box the way React hears a keystroke. */
function type(page: HTMLElement, words: string): void {
  const box = page.querySelector<HTMLInputElement>('input[aria-label="Search workspaces by name"]');
  if (box === null) throw new Error("no search box");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, words);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Each body row's words. */
function rows(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("tbody tr"), (row) => row.textContent ?? "");
}

test("the tab heads its table with the shared workspaces' four counts", async () => {
  const { page } = await openWorkspaces(workspaces());

  expect(page.querySelector("h1")?.textContent).toBe("Workspaces");
  expect(page.textContent).toContain("Shared workspaces20");
  expect(page.textContent).toContain("60% of shared");
  expect(page.textContent).toContain("72%");
  expect(page.textContent).toContain("31 pending · 9 expired");
  expect(page.textContent).toContain("85%");
  expect(page.textContent).toContain("6 suspended");
});

test("a row names its workspace, owner, installation, and integrations", async () => {
  const { page } = await openWorkspaces(workspaces());

  const [northwind, feldspar] = rows(page);
  expect(northwind).toContain("Northwind");
  expect(northwind).toContain("Grace Hopper");
  expect(northwind).toContain("northwindActive");
  expect(northwind).toContain("Linear");
  expect(northwind).toContain("Notion · expired");
  expect(feldspar).toContain("feldspar-ioSuspended");
  expect(feldspar).toContain("None");
});

test("typing narrows the loaded workspaces at once, and a miss says so", async () => {
  const { page } = await openWorkspaces(workspaces());

  type(page, "feld");
  expect(rows(page)).toEqual([expect.stringContaining("Feldspar")]);
  expect(page.textContent).toContain("1 of 2 workspaces");

  type(page, "nobody");
  expect(page.querySelector("table")).toBeNull();
  expect(page.textContent).toContain("No workspace matches.");
  // The headline counts stand whatever the search narrows.
  expect(page.textContent).toContain("Shared workspaces20");
});

test("clearing Shared only asks for every workspace, and is remembered", async () => {
  const { page, asked } = await openWorkspaces(workspaces());
  expect(asked).toEqual(["/api/admin/workspaces"]);

  const sharedOnly = Array.from(page.querySelectorAll("label")).find(
    (label) => label.textContent === "Shared only",
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => sharedOnly?.click());
  await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

  expect(asked.at(-1)).toBe("/api/admin/workspaces?kind=all");
  expect(window.localStorage.getItem("luke-admin-workspaces-shared-only")).toBe("false");
});

test("a row opens its owner's account, and a row with no owner opens nothing", async () => {
  const { page, opened } = await openWorkspaces(workspaces());

  const [northwind, feldspar] = Array.from(page.querySelectorAll<HTMLElement>("tbody tr"));
  act(() => northwind?.click());
  act(() => feldspar?.click());

  expect(opened).toEqual(["account-grace"]);
});
