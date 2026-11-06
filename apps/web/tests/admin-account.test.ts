// @vitest-environment jsdom

import {
  ADMIN_FAILURE_KIND,
  ADMIN_PULL_REQUEST,
  ADMIN_WORKSPACE_KIND,
} from "@repo/features/admin-account-wire";
import type { AdminActionDay, AdminUserDetail } from "@repo/features/admin-answer-wire";
import { AGENT_FAILURE, AGENT_STATUS, CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { GITHUB_INSTALLATION_STATUS } from "@repo/features/github-installation-wire";
import { INTEGRATION_ROW_STATUS } from "@repo/features/integration-row-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { PROVIDER_KEY_PROVIDER, PROVIDER_KEY_STATUS } from "@repo/features/provider-key-wire";
import { type AdminDoors, AdminDoorsProvider, useAdminDoors } from "@repo/panel/admin/admin-doors";
import { AccountScreen } from "@repo/panel/admin/screens/account";
import { EXPERIMENT } from "@repo/settings";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readLanded, underWebAdminDoors } from "./support/admin-doors";

/**
 * admin-account.test.ts -- one account's page names the account, marks an
 * admin in words, says when it joined, was last seen, and how it signs in,
 * leads with its activity by meaningful actions, keeps the retired hosted
 * tier's daily use and volume last, lays out
 * what a maintainer supports it from (its work, agents, workspaces, keys and
 * connections, defaults, and failures), and leads its toolbar with the way
 * back to the users, which moves in place, loading or loaded; and offers
 * Impersonate only where the page can sign in as a member, to a non-admin
 * whose grant of support access stands. The network,
 * the HTTP boundary to the service, is a fake that answers the account's read.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ID = "account-ada";

/**
 * The account's trailing year of actions, as the read folds it: one task on
 * Jan 7, then a task and an agent on each of the last nine days, ending on
 * the fixed day. Every figure below is worked from it by hand.
 */
const ACTIONS_YEAR: AdminActionDay[] = Array.from({ length: 371 }, (_, index) => {
  const day = new Date(Date.UTC(2026, 9, 14 - 370 + index)).toISOString().slice(0, 10);
  const streak = index >= 362;
  return {
    day,
    tasksCreated: streak || day === "2026-01-07" ? 1 : 0,
    planRevisions: 0,
    agentsStarted: streak ? 1 : 0,
  };
});

/** A synthetic admin account read on a fixed day, with two days of actions and of hosted use. */
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
      supportAccessUntil: null,
      ...overrides,
    },
    actions: {
      daily: ACTIONS_YEAR.slice(-30),
      calendarDaily: ACTIONS_YEAR.map((day) => ({
        day: day.day,
        count: day.tasksCreated + day.planRevisions + day.agentsStarted,
      })),
      actionsTrend: { days: 7, recent: 14, prior: 4 },
      activeDaysWindow: 9,
      activeDaysTrend: { days: 7, recent: 7, prior: 2 },
      currentStreakDays: 9,
      firstActiveDay: "2026-01-07",
      lastActiveDay: "2026-10-14",
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
    support: support(),
  };
}

/** The account's support sections: a week of work, two agents, two workspaces, a broken key, and two failures. */
function support(overrides: Partial<AdminUserDetail["support"]> = {}): AdminUserDetail["support"] {
  return {
    lastSeenAt: Date.UTC(2026, 9, 14, 9, 30),
    totals: {
      tasksCreated: 74,
      agentsStarted: 40,
      agentsFailed: 2,
      agentsRead: 40,
      pullRequestsOpened: 17,
      pullRequestsMerged: 12,
    },
    recentAgents: [
      {
        id: "agent-merged",
        createdAt: Date.UTC(2026, 9, 14, 8, 5),
        repository: "acme/relay",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        contextWindow: CONTEXT_WINDOW.LONG,
        status: AGENT_STATUS.COMPLETED,
        failure: null,
        pullRequest: ADMIN_PULL_REQUEST.MERGED,
      },
      {
        id: "agent-failed",
        createdAt: Date.UTC(2026, 9, 13, 16, 40),
        repository: "acme/web",
        model: "openai/gpt-5.5",
        effort: "medium",
        contextWindow: CONTEXT_WINDOW.STANDARD,
        status: AGENT_STATUS.FAILED,
        failure: AGENT_FAILURE.PROVIDER_KEY,
        pullRequest: ADMIN_PULL_REQUEST.NONE,
      },
    ],
    workspaces: [
      {
        id: "workspace-own",
        name: "Ada's workspace",
        kind: ADMIN_WORKSPACE_KIND.PERSONAL,
        role: "owner",
        memberCount: 1,
        github: [],
      },
      {
        id: "workspace-acme",
        name: "Acme",
        kind: ADMIN_WORKSPACE_KIND.SHARED,
        role: "member",
        memberCount: 9,
        github: [GITHUB_INSTALLATION_STATUS.ACTIVE],
      },
    ],
    providerKeys: [
      {
        provider: PROVIDER_KEY_PROVIDER.OPENAI,
        status: PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
        statusAt: Date.UTC(2026, 9, 13, 16, 41),
        fastAccess: null,
      },
    ],
    connections: [
      {
        provider: INTEGRATION_PROVIDER.LINEAR,
        status: INTEGRATION_ROW_STATUS.CONNECTED,
        at: Date.UTC(2026, 8, 2),
      },
    ],
    defaults: {
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      contextWindow: null,
      experiments: [{ key: EXPERIMENT.MEMORY, name: "Memory" }],
    },
    failures: [
      {
        kind: ADMIN_FAILURE_KIND.AGENT,
        at: Date.UTC(2026, 9, 13, 16, 42),
        reason: AGENT_FAILURE.PROVIDER_KEY,
      },
      {
        kind: ADMIN_FAILURE_KIND.KEY,
        at: Date.UTC(2026, 9, 13, 16, 41),
        provider: PROVIDER_KEY_PROVIDER.OPENAI,
        reason: PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
      },
    ],
    ...overrides,
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
  unobserve(): void {}
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

/** The doors above with the sign-in as a member answered by `impersonate`, or left out, as the app's mount leaves it. */
function WithImpersonate({
  impersonate,
  children,
}: {
  impersonate: AdminDoors["impersonate"];
  children?: ReactNode;
}): ReactElement {
  const { impersonate: _page, ...doors } = useAdminDoors();
  return createElement(
    AdminDoorsProvider,
    { value: impersonate === undefined ? doors : { ...doors, impersonate } },
    children,
  );
}

/**
 * The account's page, signed in, with its read answered by `response`, or
 * left hanging without one; under `doors`, the sign-in as a member is
 * answered by the test's own door, or left out.
 */
async function openAccount(
  response: Response | undefined,
  doors: { impersonate: AdminDoors["impersonate"] } | undefined = undefined,
): Promise<Opened> {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    response === undefined ? new Promise(() => undefined) : Promise.resolve(response),
  );
  window.localStorage.setItem("app-admin-sign-in-chosen", "true");
  const backs: number[] = [];
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    const screen = createElement(AccountScreen, {
      id: ID,
      windowDays: 30,
      onWindowDaysChange: () => undefined,
      account: undefined,
      onSignOut: async () => undefined,
      onBack: () => backs.push(backs.length),
      onOpenWorkspace: () => undefined,
      frame: (content) => content,
    });
    root?.render(
      underWebAdminDoors(
        doors === undefined
          ? screen
          : createElement(WithImpersonate, { impersonate: doors.impersonate }, screen),
      ),
    );
  });
  if (response !== undefined) await readLanded(page);
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

/** Each body row of the table `label` names, its cells' words joined by a bar. */
function rows(page: HTMLElement, label: string): string[] {
  const table = page.querySelector(`table[aria-label="${label}"]`);
  if (table === null) throw new Error(`no table named ${label}`);
  return Array.from(table.querySelectorAll("tbody tr"), (row) =>
    Array.from(row.querySelectorAll("td"), (cell) => cell.textContent ?? "").join("|"),
  );
}

/** The toolbar's way back, the button its path leads with. */
function wayBack(page: HTMLElement): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>('header nav[aria-label="Path"] button');
  if (found === null) throw new Error("no way back");
  return found;
}

/** The page the path says the reader stands on. */
function current(page: HTMLElement): string | undefined {
  return page.querySelector('header [aria-current="page"]')?.textContent ?? undefined;
}

test("a loaded account names itself, marks an admin in words, and says how it signs in", async () => {
  const { page } = await openAccount(answer(detail()));

  expect(current(page)).toBe("Ada Lovelace");
  expect(page.querySelector('section[aria-label="Ada Lovelace"]')).not.toBeNull();
  expect(page.textContent).toContain("ada@example.testAdmin");
  expect(page.textContent).toContain("ada@example.test");
  expect(page.textContent).toContain(
    "Joined Jan 5, 2026 · last seen Oct 14, 9:30 AM UTC · signs in with GitHub, Google",
  );
});

/** The toolbar's Impersonate, where it stands. */
function impersonateButton(page: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(page.querySelectorAll("button")).find(
    (button) => button.textContent === "Impersonate",
  );
}

/** A grant of support access that runs out after the account was read (Oct 14, noon). */
const GRANT_STANDS = Date.UTC(2026, 9, 20, 12);

test.each([
  { case: "a member whose grant stands", account: { admin: false }, offered: true },
  { case: "an admin whose grant stands", account: { admin: true }, offered: false },
  {
    case: "a member whose grant ran out",
    account: { admin: false, supportAccessUntil: Date.UTC(2026, 9, 13) },
    offered: false,
  },
  {
    case: "a member on a mount that cannot sign in as one",
    account: { admin: false },
    offered: false,
    doors: { impersonate: undefined },
  },
])("Impersonate stands for $case: $offered", async ({ account, offered, doors }) => {
  const { page } = await openAccount(
    answer(detail({ supportAccessUntil: GRANT_STANDS, ...account })),
    doors,
  );

  expect(impersonateButton(page) !== undefined).toBe(offered);
});

test("the masthead says until when a member's grant stands, and a refused Impersonate says why in the service's words", async () => {
  const asked: string[] = [];
  const { page } = await openAccount(
    answer(detail({ admin: false, supportAccessUntil: GRANT_STANDS })),
    {
      impersonate: (userId) => {
        asked.push(userId);
        return Promise.resolve("The member has not granted support access.");
      },
    },
  );
  expect(page.textContent).toContain("support access until Oct 20, 12:00 PM UTC");

  await act(async () => impersonateButton(page)?.click());

  expect(asked).toEqual([ID]);
  expect(page.textContent).toContain("The member has not granted support access.");
});

test("an account that is no admin and links no provider says neither", async () => {
  const { page } = await openAccount(answer(detail({ admin: false, signInMethods: [] })));

  expect(page.textContent).not.toContain("Admin");
  expect(page.textContent).not.toContain("signs in with");
  expect(page.textContent).toContain("Joined Jan 5, 2026");
});

/** The section the heading `title` names. */
function section(page: HTMLElement, title: string): HTMLElement {
  const found = Array.from(page.querySelectorAll("section")).find(
    (candidate) => candidate.querySelector("h2")?.textContent === title,
  );
  if (found === undefined) throw new Error(`no section headed ${title}`);
  return found;
}

test("the account's activity by meaningful actions leads the page", async () => {
  const { page } = await openAccount(answer(detail()));

  expect(headings(page, "h2")[0]).toBe("Activity");
  const activity = section(page, "Activity");
  expect(activity.textContent).toContain("Active days · 30 days9of 30 window days");
  expect(activity.textContent).toContain("Current streak9 days");
  expect(activity.textContent).toContain("Active days · 7 days72 the week before");
  expect(activity.textContent).toContain("Last activeOct 14first active Jan 7");
  expect(activity.textContent).toContain("14 in the last 7 days, against 4 before");
  for (const kind of ["Tasks created", "Description revisions", "Agents started"]) {
    expect(activity.textContent).toContain(kind);
  }
  expect(
    activity.querySelector('[aria-label="Oct 14 (so far today) — 2 meaningful actions"]'),
  ).not.toBeNull();
});

test("the account's hosted-tier use stands last, under a retired heading", async () => {
  const { page } = await openAccount(answer(detail()));

  expect(headings(page, "h2").at(-1)).toBe("Hosted tier · retired");
  const hosted = section(page, "Hosted tier · retired");
  expect(hosted.textContent).toContain("Active days · 30 days12of 30 window days");
  expect(hosted.textContent).toContain("Current streak1 day");
  expect(hosted.textContent).toContain("Last activeOct 14first active Jan 6");
  expect(hosted.textContent).toContain("Hosted calls · 30 days1,234,5672,345,678 all time");
  expect(hosted.textContent).toContain("Active days · all time48");
});

test("the support sections say what the account did and what broke, by the service's own words", async () => {
  const { page } = await openAccount(answer(detail()));

  expect(headings(page, "h2")).toEqual(
    expect.arrayContaining([
      "Work",
      "Recent agents",
      "Workspaces",
      "Keys and connections",
      "Defaults and experiments",
      "Recent failures · 30 days",
    ]),
  );
  expect(page.textContent).toContain("Tasks created · 30 days74");
  expect(page.textContent).toContain("Agents · 30 days405% failed");
  expect(page.textContent).toContain("Pull requests merged · 30 days12of 17 opened");

  const agents = rows(page, "The account's newest agents");
  expect(agents).toEqual([
    "Oct 14, 8:05 AM UTC|acme/relay|anthropic/claude-opus-5.5 · high|Finished|Merged",
    "Oct 13, 4:40 PM UTC|acme/web|openai/gpt-5.5 · medium · standard window|Failedprovider_key|—",
  ]);
  expect(rows(page, "The account's workspaces")).toEqual([
    "Ada's workspacePersonal|owner|1|not installed",
    "AcmeShared workspace|member|9|Active",
  ]);
  expect(rows(page, "The account's provider keys and integration connections")).toEqual([
    "Provider key|openai|quota_exceeded|Oct 13, 4:41 PM UTC",
    "Connection|linear|Connected|Sep 2, 12:00 AM UTC",
  ]);
  expect(page.textContent).toContain("Agents start on anthropic/claude-opus-5.5 · high.");
  expect(page.textContent).toContain("Experiments:Memory");
  expect(rows(page, "The account's recent failures")).toEqual([
    "Oct 13, 4:42 PM UTC|Agent failed|provider_key",
    "Oct 13, 4:41 PM UTC|Provider key · openai|quota_exceeded",
  ]);
});

test("an account with nothing to support from says so in each section", async () => {
  const { page } = await openAccount(
    answer({
      ...detail(),
      support: support({
        lastSeenAt: null,
        totals: {
          tasksCreated: 0,
          agentsStarted: 0,
          agentsFailed: 0,
          agentsRead: 0,
          pullRequestsOpened: 0,
          pullRequestsMerged: 0,
        },
        recentAgents: [],
        workspaces: [],
        providerKeys: [],
        connections: [],
        defaults: { model: null, effort: null, contextWindow: null, experiments: [] },
        failures: [],
      }),
    }),
  );

  expect(page.textContent).toContain("last seen never");
  expect(page.textContent).toContain("Agents · 30 days0none started");
  expect(page.textContent).toContain("No agent started yet.");
  expect(page.textContent).toContain("In no workspace.");
  expect(page.textContent).toContain("No provider key or connection.");
  expect(page.textContent).toContain("Agents start on the catalog's default.");
  expect(page.textContent).toContain("No experiments turned on.");
  expect(page.textContent).toContain("Nothing failed in this window.");
});

test("the toolbar leads with the way back to the users, which moves in place, loading or loaded", async () => {
  const loading = await openAccount(undefined);
  expect(wayBack(loading.page).textContent).toBe("Users");
  expect(current(loading.page)).toBe("Account");
  act(() => wayBack(loading.page).click());
  expect(loading.backs).toHaveLength(1);
  act(() => root?.unmount());

  const loaded = await openAccount(answer(detail()));
  expect(wayBack(loaded.page).textContent).toBe("Users");
  act(() => wayBack(loaded.page).click());
  expect(loaded.backs).toHaveLength(1);
});
