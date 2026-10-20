// @vitest-environment jsdom
import type { AdminMetrics } from "@luke/service/admin/admin-metrics";
import type { AdminOverview } from "@luke/service/admin/admin-overview";
import {
  ACTIVITY_FEATURE,
  FUNNEL_STEP,
  REACH_FEATURE,
} from "@luke/service/admin/admin-overview-vocabulary";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { DashboardScreen } from "../src/admin/screens/dashboard";
import type { AdminRead } from "../src/admin/use-admin-read";

/**
 * admin-dashboard.test.ts -- the Overview states its sections under their
 * own headings, loading or loaded, and reads every metric and every health
 * check in words: each headline tile's figure under its name with its move
 * against the week before, the funnel's and reach's rows with their counts
 * and shares, the retention grid on the basis chosen, the most active
 * accounts with their per-feature counts. A failed read,
 * first or refreshing, says so with Retry, and the header's window and
 * hide-admins controls hand their choice up.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SECTIONS = [
  "This week",
  "Activity by feature",
  "Activation and reach",
  "Retention · weekly cohorts",
  "Most active accounts",
  "Signups",
];

/** One cohort week, its accounts, and the share of them retained in the week itself. */
function cohort(size: number, activeAccounts: number) {
  return {
    weekStart: "2026-10-12",
    size,
    cells: [{ offset: 0, activeAccounts, share: activeAccounts / size, inProgress: true }],
  };
}

/** A synthetic week of the product: a dozen active developers, and what they did. */
function overview(overrides: Partial<AdminOverview> = {}): AdminOverview {
  return {
    headline: {
      activeDevelopers: { days: 7, recent: 12, prior: 10 },
      tasksCreated: { days: 7, recent: 30, prior: 20 },
      agentsStarted: { days: 7, recent: 40, prior: 40 },
      agentsFromAutomations: 10,
      prsMerged: { days: 7, recent: 9, prior: 12 },
      prsOpened: { opened: 20, merged: 15 },
    },
    activity: {
      daily: [
        {
          day: "2026-10-17",
          [ACTIVITY_FEATURE.AGENTS_STARTED]: 4,
          [ACTIVITY_FEATURE.PLAN_REVISIONS]: 3,
          [ACTIVITY_FEATURE.CALLS_HELD]: 2,
          [ACTIVITY_FEATURE.INBOX_ANSWERED]: 1,
          [ACTIVITY_FEATURE.AUTOMATION_RUNS]: 1,
        },
      ],
      trend: { days: 7, recent: 11, prior: 9 },
    },
    funnel: [
      { step: FUNNEL_STEP.SIGNED_UP, accounts: 50, share: 1 },
      { step: FUNNEL_STEP.GITHUB_CONNECTED, accounts: 30, share: 0.6 },
      { step: FUNNEL_STEP.CREATED_TASK, accounts: 25, share: 0.5 },
      { step: FUNNEL_STEP.HELD_CALL, accounts: 10, share: 0.2 },
      { step: FUNNEL_STEP.STARTED_AGENT, accounts: 20, share: 0.4 },
      { step: FUNNEL_STEP.OPENED_PR, accounts: 12, share: 0.24 },
      { step: FUNNEL_STEP.MERGED_PR, accounts: 8, share: 0.16 },
    ],
    reach: {
      activeDevelopers: 12,
      features: [
        { feature: REACH_FEATURE.TASKS, developers: 12, share: 1 },
        { feature: REACH_FEATURE.CODING_AGENTS, developers: 9, share: 0.75 },
        { feature: REACH_FEATURE.INBOX, developers: 6, share: 0.5 },
        { feature: REACH_FEATURE.VOICE_CALLS, developers: 3, share: 0.25 },
        { feature: REACH_FEATURE.INTEGRATIONS, developers: 4, share: 1 / 3 },
        { feature: REACH_FEATURE.AUTOMATIONS, developers: 1, share: 1 / 12 },
        { feature: REACH_FEATURE.CHAT, developers: 0, share: 0 },
      ],
    },
    topAccounts: [
      {
        id: "account-ada",
        name: "Ada Lovelace",
        email: "ada@example.test",
        image: null,
        admin: false,
        activeDays: 6,
        tasks: 4,
        agents: 1234,
        prsMerged: 3,
        callMinutes: 42,
        lastSeenAt: null,
      },
    ],
    retention: { weeks: 1, cohorts: [cohort(10, 7)] },
    ...overrides,
  };
}

/** A synthetic week, read at noon on its last day. */
function metrics(overrides: Partial<AdminMetrics> = {}): AdminMetrics {
  return {
    generatedAt: Date.UTC(2026, 9, 17, 12),
    windowDays: 7,
    users: {
      total: 1234,
      newInWindow: 56,
      signupTrend: { days: 7, recent: 40, prior: 30 },
      dailySignups: [{ day: "2026-10-17", count: 4 }],
    },
    overview: overview(),
    retention: { weeks: 1, cohorts: [cohort(10, 2)] },
    ...overrides,
  };
}

function ready(
  value: AdminMetrics,
  refreshFailure: string | undefined = undefined,
): AdminRead<AdminMetrics> {
  return { status: "ready", value, question: "", refreshFailure };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

/** The dashboard in `state`, recording what its controls hand up into `heard`. */
function render(
  state: AdminRead<AdminMetrics>,
  heard: string[] = [],
  refreshing = false,
): HTMLElement {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(DashboardScreen, {
        read: {
          state,
          refreshing,
          reload: () => heard.push("reload"),
          withdraw: async () => undefined,
          revise: () => undefined,
        },
        hideAdmins: false,
        onHideAdminsChange: (hide) => heard.push(`hide ${hide}`),
        windowDays: 7,
        onWindowDaysChange: (windowDays) => heard.push(`window ${windowDays}`),
        account: undefined,
        onSignOut: async () => undefined,
        onOpenAccount: () => undefined,
        onOpenDay: () => undefined,
        frame: (content) => content,
      }),
    ),
  );
  return container;
}

function sectionHeadings(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("h2"), (heading) => heading.textContent ?? "");
}

/** The words of the smallest element holding `text`, with what follows it in its card. */
function cardOf(page: HTMLElement, label: string): string {
  const name = Array.from(page.querySelectorAll("div")).find(
    (element) => element.children.length === 0 && element.textContent === label,
  );
  return name?.parentElement?.parentElement?.textContent ?? "";
}

test("a loaded dashboard states its sections under their headings, in order", () => {
  const page = render(ready(metrics()));

  expect(sectionHeadings(page)).toEqual(SECTIONS);
});

test("the loading dashboard stands its sections under the same headings, saying it is loading", () => {
  const page = render({ status: "loading" });

  expect(sectionHeadings(page)).toEqual(SECTIONS);
  expect(page.querySelector('[role="status"]')?.textContent).toContain("Loading…");
});

test("each headline tile reads its week's figure under its name, with its move and its detail", () => {
  const page = render(ready(metrics()));

  expect(cardOf(page, "Weekly active developers")).toBe(
    "Weekly active developers12+20% vs the 7 days before",
  );
  expect(cardOf(page, "Tasks created · 7 days")).toBe(
    "Tasks created · 7 days30+50% vs the 7 days before · 2.5 per active developer",
  );
  expect(cardOf(page, "Agents started · 7 days")).toBe(
    "Agents started · 7 days40flat vs the 7 days before · 25% from automations",
  );
  expect(cardOf(page, "PRs merged · 7 days")).toBe(
    "PRs merged · 7 days9−25% vs the 7 days before · 75% of this week's agents' 20 PRs merged",
  );
});

test("a quiet week's tiles state their figures without a share of nothing", () => {
  const quiet = overview().headline;
  const page = render(
    ready(
      metrics({
        overview: overview({
          headline: {
            ...quiet,
            activeDevelopers: { days: 7, recent: 0, prior: 0 },
            agentsStarted: { days: 7, recent: 0, prior: 0 },
            prsOpened: { opened: 0, merged: 0 },
          },
        }),
      }),
    ),
  );

  expect(cardOf(page, "Tasks created · 7 days")).toBe(
    "Tasks created · 7 days30+50% vs the 7 days before",
  );
  expect(cardOf(page, "Agents started · 7 days")).toBe(
    "Agents started · 7 days0flat vs the 7 days before",
  );
  expect(cardOf(page, "PRs merged · 7 days")).toBe("PRs merged · 7 days9−25% vs the 7 days before");
});

/** Each row of the list named `label`, its words joined by a bar. */
function listRows(page: HTMLElement, label: string): string[] {
  const list = page.querySelector(`ul[aria-label="${label}"]`);
  return Array.from(list?.querySelectorAll("li") ?? [], (row) =>
    Array.from(row.children, (cell) => cell.textContent)
      .filter((words) => words !== "")
      .join(" | "),
  );
}

test("the funnel and reach read each row's count and its share of the base", () => {
  const page = render(ready(metrics()));

  expect(listRows(page, "Activation funnel")).toEqual([
    "Signed up | 50 | 100%",
    "GitHub connected | 30 | 60%",
    "Created a task | 25 | 50%",
    "Held a call | 10 | 20%",
    "Started an agent | 20 | 40%",
    "Opened a PR | 12 | 24%",
    "Merged a PR | 8 | 16%",
  ]);
  expect(listRows(page, "Feature reach")).toEqual([
    "Tasks & plans | 12 | 100%",
    "Coding agents | 9 | 75%",
    "Inbox | 6 | 50%",
    "Voice calls | 3 | 25%",
    "Integration connected | 4 | 33%",
    "Automations | 1 | 8%",
    "Chat | 0 | 0%",
  ]);
  expect(page.textContent).toContain("of 12 active developers");
});

test("retention counts meaningful actions until the hosted basis is chosen", () => {
  const page = render(ready(metrics()));
  const bases = page.querySelector('[role="radiogroup"][aria-label="Retained by"]');
  const chosen = () =>
    Array.from(bases?.querySelectorAll('[role="radio"]') ?? [])
      .filter((radio) => radio.getAttribute("aria-checked") === "true")
      .map((radio) => radio.textContent);

  expect(chosen()).toEqual(["Meaningful action"]);
  expect(page.textContent).toContain("70%");
  expect(page.textContent).toContain("created a task, wrote a plan revision");

  act(() => button(page, "Any hosted call").click());

  expect(chosen()).toEqual(["Any hosted call"]);
  expect(page.textContent).toContain("20%");
  expect(page.textContent).not.toContain("70%");
  expect(page.textContent).toContain("spent hosted voice or attention");
});

test("the most active accounts read each one's days and per-feature counts", () => {
  const page = render(ready(metrics()));
  const table = page.querySelector('table[aria-label="Accounts"]');
  const headers = Array.from(table?.querySelectorAll("th") ?? [], (cell) => cell.textContent);
  const cells = Array.from(table?.querySelectorAll("tbody td") ?? [], (cell) => cell.textContent);

  expect(headers).toEqual([
    "Account",
    "Active days",
    "Tasks",
    "Agents",
    "PRs merged",
    "Call min",
    "Last seen",
  ]);
  expect(cells.slice(1)).toEqual(["6 of 7", "4", "1,234", "3", "42", "—"]);
});

/** The button whose words are `words`. */
function button(page: HTMLElement, words: string): HTMLButtonElement {
  const found = Array.from(page.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === words,
  );
  if (found === undefined) throw new Error(`no button reading ${words}`);
  return found;
}

test("a refresh that failed says so over the answer still shown, and Retry reads again", () => {
  const heard: string[] = [];
  const page = render(ready(metrics(), "The metrics endpoint did not answer."), heard);

  expect(page.querySelector('[role="alert"]')?.textContent).toContain(
    "Refresh failed. Still showing the earlier answer. The metrics endpoint did not answer.",
  );
  expect(cardOf(page, "Weekly active developers")).toBe(
    "Weekly active developers12+20% vs the 7 days before",
  );
  act(() => button(page, "Retry").click());
  expect(heard).toEqual(["reload"]);
});

test("a first read that failed says why in place of the page, and Retry reads again", () => {
  const heard: string[] = [];
  const page = render({ status: "error", detail: "The metrics endpoint did not answer." }, heard);

  expect(page.querySelector('[role="alert"]')?.textContent).toContain(
    "The metrics endpoint did not answer.",
  );
  act(() => button(page, "Retry").click());
  expect(heard).toEqual(["reload"]);
});

test("the window is one of three radios, and the hide-admins box hands its choice up", () => {
  const heard: string[] = [];
  const page = render(ready(metrics()), heard);
  const windows = page.querySelector('[role="radiogroup"][aria-label="Window in days"]');
  const radios = Array.from(windows?.querySelectorAll('[role="radio"]') ?? []);

  expect(radios.map((radio) => radio.textContent)).toEqual(["7d", "30d", "90d"]);
  expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
    "false",
  ]);
  act(() => button(page, "90d").click());
  const hide = Array.from(page.querySelectorAll("label")).find(
    (label) => label.textContent === "Hide admins",
  );
  act(() => hide?.querySelector("input")?.click());
  expect(heard).toEqual(["window 90", "hide true"]);
});

test("Retry refuses a press while a read is out, rather than abort it and start over", () => {
  const heard: string[] = [];
  const failed = render(
    { status: "error", detail: "The metrics endpoint did not answer." },
    heard,
    true,
  );
  act(() => button(failed, "Retry").click());
  act(() => root?.unmount());

  const stale = render(ready(metrics(), "The metrics endpoint did not answer."), heard, true);
  act(() => button(stale, "Retry").click());

  expect(heard).toEqual([]);
});
