// @vitest-environment jsdom
import { type AdminMetrics, adminIntegrations } from "@luke/service/admin/admin-metrics";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { DashboardScreen } from "../src/admin/screens/dashboard";
import type { AdminRead } from "../src/admin/use-admin-read";

/**
 * admin-dashboard.test.ts -- the dashboard states its sections under their
 * own headings, loading or loaded, and reads every metric and every health
 * check in words: each card's figure under its name, each integration's
 * state beside it, the database's reachability with its probe time, and the
 * analytics processor as a link only where the deployment names one. A
 * failed read, first or refreshing, says so with Retry, and the header's
 * window and hide-admins controls hand their choice up.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SECTIONS = [
  "User activity",
  "Signup retention · weekly cohorts",
  "Feature usage · hosted tier",
  "Most active hosted-tier accounts",
  "Reliability",
  "System health",
];

const CONSOLE_URL = "https://analytics.example.test/project/1";

/** A synthetic week, read at noon on its last day, with hosted voice wired and Google sign-in not. */
function metrics(overrides: Partial<AdminMetrics> = {}): AdminMetrics {
  return {
    generatedAt: Date.UTC(2026, 9, 17, 12),
    windowDays: 7,
    users: {
      total: 1234,
      newInWindow: 56,
      signupTrend: { days: 7, recent: 40, prior: 30 },
      signInMethods: { google: 700, github: 500, other: 34 },
      dailySignups: [{ day: "2026-10-17", count: 4 }],
    },
    featureUsage: {
      callsToday: 321,
      callsWindow: 4321,
      activeUsersToday: 89,
      activeUsersWindow: 210,
      usageTrend: { days: 7, recent: 4321, prior: 4000 },
      daily: [{ day: "2026-10-17", calls: 321 }],
      topUsers: [],
    },
    retention: { weeks: 1, cohorts: [] },
    reliability: { analyticsConsoleUrl: CONSOLE_URL },
    systemHealth: {
      database: { reachable: false, latencyMs: 42 },
      integrations: adminIntegrations({
        analyticsRecording: true,
        analyticsErasure: true,
        hostedTier: true,
        googleSignIn: false,
        githubSignIn: true,
      }),
    },
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
function render(state: AdminRead<AdminMetrics>, heard: string[] = []): HTMLElement {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(DashboardScreen, {
        read: {
          state,
          refreshing: false,
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

/** Each integration's name beside the state it reads in. */
function integrationStates(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("li"), (row) =>
    Array.from(row.querySelectorAll("span"))
      .filter((span) => span.children.length === 0)
      .map((span) => span.textContent)
      .join(": "),
  );
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

test("each metric card reads its figure and its hint under its name", () => {
  const page = render(ready(metrics()));

  expect(cardOf(page, "Total accounts")).toBe("Total accounts1,234");
  expect(cardOf(page, "New · 7 days")).toBe("New · 7 days4056 in 7 days");
  expect(cardOf(page, "Active today")).toBe("Active today89210 accounts in 7 days");
  expect(cardOf(page, "Hosted calls · today")).toBe("Hosted calls · today3214,321 in 7 days");
});

test("system health reads the database's reachability and every integration's state in words", () => {
  const page = render(ready(metrics()));

  expect(cardOf(page, "Database")).toBe("DatabaseUnreachableprobe round-trip 42 ms");
  expect(integrationStates(page)).toEqual([
    "Hosted voice & attention (OpenAI): Configured",
    "Product analytics recording: Configured",
    "Analytics erasure on account delete: Configured",
    "Google sign-in: Not configured",
    "GitHub sign-in: Configured",
  ]);
});

test("reliability links the analytics processor only where the deployment names its console", () => {
  const linked = render(ready(metrics()));
  const link = Array.from(linked.querySelectorAll("a")).find(
    (anchor) => anchor.textContent === "the analytics processor",
  );
  expect(link?.getAttribute("href")).toBe(CONSOLE_URL);

  const unnamed = render(ready(metrics({ reliability: {} })));
  expect(unnamed.textContent).toContain("which live with the analytics processor rather than");
  expect(
    Array.from(unnamed.querySelectorAll("a")).some(
      (anchor) => anchor.textContent === "the analytics processor",
    ),
  ).toBe(false);
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
  expect(cardOf(page, "Total accounts")).toBe("Total accounts1,234");
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
