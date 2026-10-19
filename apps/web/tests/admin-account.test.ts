// @vitest-environment jsdom
import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import {
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { PROVIDER_KEY_PROVIDER, PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import {
  ADMIN_FAILURE_KIND,
  ADMIN_PULL_REQUEST,
  ADMIN_WORKSPACE_KIND,
} from "@luke/service/admin/admin-account-wire";
import type { AdminUserDetail } from "@luke/service/admin/admin-user";
import { EXPERIMENT } from "@luke/settings";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountScreen } from "../src/admin/screens/account";

/**
 * admin-account.test.ts -- one account's page names the account, marks an
 * admin in words, says when it joined, was last seen, and how it signs in,
 * states its daily use and its volume under their own headings, lays out
 * what a maintainer supports it from (its work, agents, workspaces, keys and
 * connections, defaults, and failures), and moves the way a
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
      callMinutes: 612,
    },
    recentAgents: [
      {
        id: "agent-merged",
        createdAt: Date.UTC(2026, 9, 14, 8, 5),
        repository: "acme/relay",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        contextWindow: CONTEXT_WINDOW.LONG,
        status: CODING_AGENT_STATUS.COMPLETED,
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
        status: CODING_AGENT_STATUS.FAILED,
        failure: CODING_AGENT_FAILURE.PROVIDER_KEY,
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
      experiments: [{ key: EXPERIMENT.CHAT, name: "Chat" }],
    },
    failures: [
      {
        kind: ADMIN_FAILURE_KIND.AGENT,
        at: Date.UTC(2026, 9, 13, 16, 42),
        reason: CODING_AGENT_FAILURE.PROVIDER_KEY,
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

/** Each body row of the table `label` names, its cells' words joined by a bar. */
function rows(page: HTMLElement, label: string): string[] {
  const table = page.querySelector(`table[aria-label="${label}"]`);
  if (table === null) throw new Error(`no table named ${label}`);
  return Array.from(table.querySelectorAll("tbody tr"), (row) =>
    Array.from(row.querySelectorAll("td"), (cell) => cell.textContent ?? "").join("|"),
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

test("a loaded account names itself, marks an admin in words, and says how it signs in", async () => {
  const { page } = await openAccount(answer(detail()));

  expect(headings(page, "h1")).toEqual(["Ada Lovelace"]);
  expect(page.textContent).toContain("ada@example.testAdmin");
  expect(page.textContent).toContain("ada@example.test");
  expect(page.textContent).toContain(
    "Joined Jan 5, 2026 · last seen Oct 14, 09:30 UTC · signs in with GitHub, Google",
  );
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
  expect(page.textContent).toContain("Coding agents · 30 days405% failed");
  expect(page.textContent).toContain("Pull requests merged12of 17 opened");
  expect(page.textContent).toContain("Call minutes · 30 days612");

  const agents = rows(page, "The account's newest coding agents");
  expect(agents).toEqual([
    "Oct 14, 08:05 UTC|acme/relay|anthropic/claude-opus-5.5 · high|completed|merged",
    "Oct 13, 16:40 UTC|acme/web|openai/gpt-5.5 · medium · standard window|failedprovider_key|—",
  ]);
  expect(rows(page, "The account's workspaces")).toEqual([
    "Ada's workspacePersonal|owner|1|not installed",
    "AcmeShared workspace|member|9|active",
  ]);
  expect(rows(page, "The account's provider keys and integration connections")).toEqual([
    "Provider key|openai|quota_exceeded|Oct 13, 16:41 UTC",
    "Connection|linear|connected|Sep 2, 00:00 UTC",
  ]);
  expect(page.textContent).toContain("Coding agents start on anthropic/claude-opus-5.5 · high.");
  expect(page.textContent).toContain("Experiments:Chat");
  expect(rows(page, "The account's recent failures")).toEqual([
    "Oct 13, 16:42 UTC|Coding agent failed|provider_key",
    "Oct 13, 16:41 UTC|Provider key · openai|quota_exceeded",
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
          callMinutes: 0,
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
  expect(page.textContent).toContain("Coding agents · 30 days0none started");
  expect(page.textContent).toContain("No coding agent started yet.");
  expect(page.textContent).toContain("In no workspace.");
  expect(page.textContent).toContain("No provider key or connection.");
  expect(page.textContent).toContain("Coding agents start on the catalog's default.");
  expect(page.textContent).toContain("No experiments turned on.");
  expect(page.textContent).toContain("Nothing failed in this window.");
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
