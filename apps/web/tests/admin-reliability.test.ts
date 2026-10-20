// @vitest-environment jsdom

import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import { AUTOMATION_RUN_REASON } from "@luke/features/automation-wire";
import { CODING_AGENT_FAILURE } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { PROVIDER_KEY_PROVIDER, PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import { adminIntegrations } from "@luke/service/admin/admin-health";
import type { AdminReliability } from "@luke/service/admin/admin-reliability";
import { ADMIN_ATTENTION_KIND } from "@luke/service/admin/http";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { ReliabilityScreen } from "../src/admin/screens/reliability";

/**
 * admin-reliability.test.ts -- the Reliability screen states its sections
 * under their own headings, loading or loaded; reads each failure rate as a
 * share with what it is a share of, and none at all where the database did
 * not answer, since its silence is no count; names an account that needs attention
 * by what broke and its status alone, a press on it opening its account
 * page; reads every provider's configuration in words; links product
 * analytics only where the deployment names its console; and offers the two
 * windows it reads. The network, the HTTP boundary to Luke, is a fake that
 * answers the read.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SECTIONS = ["Failures", "Why work failed", "Accounts that need attention", "System health"];

const CONSOLE_URL = "https://analytics.example.test/project/1";

/** A synthetic week, read at noon on its last day. */
function reliability(overrides: Partial<AdminReliability> = {}): AdminReliability {
  return {
    generatedAt: Date.UTC(2026, 9, 17, 12),
    windowDays: 7,
    headline: {
      lukeTurns: { failed: 412, total: 29_880 },
      agentRuns: { failed: 68, total: 1000 },
      abandonedTurns: 37,
      calls: { failed: 0, total: 0 },
      automationRuns: { failed: 43, skipped: 90, total: 1000 },
    },
    daily: [
      { day: "2026-10-16", lukeTurns: 0.01, agentRuns: 0.05, calls: null, automationRuns: 0.04 },
      { day: "2026-10-17", lukeTurns: 0.02, agentRuns: null, calls: null, automationRuns: null },
    ],
    agentFailures: [{ failure: CODING_AGENT_FAILURE.MODEL, count: 40 }],
    automationReasons: [{ reason: AUTOMATION_RUN_REASON.CONCURRENCY, skipped: 90, failed: 0 }],
    attention: {
      total: 1,
      limit: 50,
      accounts: [
        {
          id: "account-ada",
          name: "Ada Lovelace",
          email: "ada@example.test",
          image: null,
          admin: false,
          brokenSince: Date.UTC(2026, 9, 15, 9),
          problems: [
            {
              kind: ADMIN_ATTENTION_KIND.PROVIDER_KEY,
              provider: PROVIDER_KEY_PROVIDER.OPENAI,
              status: PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
              since: Date.UTC(2026, 9, 15, 9),
            },
            {
              kind: ADMIN_ATTENTION_KIND.GITHUB_INSTALLATION,
              status: GITHUB_INSTALLATION_STATUS.SUSPENDED,
              since: Date.UTC(2026, 9, 12, 9),
            },
          ],
          failedAgents: 4,
        },
      ],
    },
    analyticsConsoleUrl: CONSOLE_URL,
    systemHealth: {
      database: { reachable: true, latencyMs: 42 },
      integrations: adminIntegrations({
        hostedTier: true,
        codingAgents: true,
        githubApp: false,
        githubSignIn: true,
        googleSignIn: false,
        callAvatar: false,
        errorReporting: true,
        analyticsRecording: true,
        analyticsErasure: true,
        sweep: true,
        eveDeployment: true,
        ownKeys: true,
        workspaceLinear: false,
        connectors: new Map([[INTEGRATION_PROVIDER.LINEAR, true]]),
      }),
    },
    ...overrides,
  };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
});

interface Opened {
  page: HTMLElement;
  heard: string[];
}

/** The screen, signed in, with its read answered by `body`, or left hanging without one. */
async function openReliability(body: AdminReliability | undefined): Promise<Opened> {
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
  const heard: string[] = [];
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      createElement(ReliabilityScreen, {
        hideAdmins: true,
        onHideAdminsChange: (hide) => heard.push(`hide ${hide}`),
        windowDays: 7,
        onWindowDaysChange: (windowDays) => heard.push(`window ${windowDays}`),
        account: undefined,
        onSignOut: async () => undefined,
        onOpenAccount: (id) => heard.push(`open ${id}`),
        frame: (content) => content,
      }),
    );
  });
  return { page, heard };
}

function sectionHeadings(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("h2"), (heading) => heading.textContent ?? "");
}

/** The words of the smallest element holding `label`, with what follows it in its card. */
function cardOf(page: HTMLElement, label: string): string {
  const name = Array.from(page.querySelectorAll("div")).find(
    (element) => element.children.length === 0 && element.textContent === label,
  );
  return name?.parentElement?.parentElement?.textContent ?? "";
}

test("a loaded screen states its sections under their headings, in order", async () => {
  const { page } = await openReliability(reliability());

  expect(sectionHeadings(page)).toEqual(SECTIONS);
});

test("the loading screen stands its sections under the same headings, saying it is loading", async () => {
  const { page } = await openReliability(undefined);

  expect(sectionHeadings(page)).toEqual(SECTIONS);
  expect(page.querySelector('[role="status"]')?.textContent).toContain("Loading…");
});

test("each rate reads as a share with what it is a share of", async () => {
  const { page } = await openReliability(reliability());

  expect(cardOf(page, "Luke turns failed")).toBe("Luke turns failed1.4%412 of 29,880 turns");
  expect(cardOf(page, "Coding-agent runs failed")).toBe(
    "Coding-agent runs failed6.8%68 of 1,000 runs",
  );
  expect(cardOf(page, "Abandoned by the sweep")).toBe(
    "Abandoned by the sweep37turns past their bound",
  );
  expect(cardOf(page, "Calls dropped")).toBe("Calls dropped—no calls ended in 7 days");
  expect(cardOf(page, "Automation runs failed")).toBe("Automation runs failed4.3%+ 9.0% skipped");
});

test("a database that did not answer shows no count and no account, and says why", async () => {
  const healthy = reliability();
  const { page } = await openReliability(
    reliability({
      systemHealth: { ...healthy.systemHealth, database: { reachable: false, latencyMs: 9 } },
    }),
  );

  expect(sectionHeadings(page)).toEqual(["Failures", "System health"]);
  expect(page.textContent).toContain("The database did not answer its probe");
  expect(page.textContent).not.toContain("Ada Lovelace");
  expect(cardOf(page, "Luke turns failed")).toBe("");
  expect(cardOf(page, "Database")).toBe("DatabaseUnreachableprobe round-trip 9 ms");
});

test("an account that needs attention reads what broke by status alone, and a press opens it", async () => {
  const { page, heard } = await openReliability(reliability());
  const row = Array.from(page.querySelectorAll("tbody tr")).find((candidate) =>
    candidate.textContent?.includes("Ada Lovelace"),
  );

  expect(row?.textContent).toContain("OpenAI key · quota exceeded");
  expect(row?.textContent).toContain("GitHub App · suspended");
  const name = row?.querySelector<HTMLAnchorElement>("a");
  await act(async () => {
    name?.click();
  });
  expect(heard).toContain("open account-ada");
});

test("system health reads the database and every provider's configuration in words", async () => {
  const { page } = await openReliability(reliability());
  const states = Array.from(page.querySelectorAll("li"), (row) =>
    Array.from(row.querySelectorAll("span"))
      .filter((span) => span.children.length === 0)
      .map((span) => span.textContent)
      .join(": "),
  );

  expect(cardOf(page, "Database")).toBe("DatabaseReachableprobe round-trip 42 ms");
  expect(states).toContain("GitHub App (installations and webhooks): Not configured");
  expect(states).toContain("Coding agents on Luke's key (Anthropic): Configured");
  expect(states).toContain("Linear (Vercel Connect): Configured");
});

test("product analytics is a link only where the deployment names its console", async () => {
  const linked = await openReliability(reliability());
  const link = Array.from(linked.page.querySelectorAll("a")).find(
    (anchor) => anchor.textContent === "product analytics",
  );
  expect(link?.getAttribute("href")).toBe(CONSOLE_URL);
  act(() => root?.unmount());

  const unnamed = await openReliability(reliability({ analyticsConsoleUrl: undefined }));
  expect(unnamed.page.textContent).toContain("live in product analytics, not this database");
  expect(
    Array.from(unnamed.page.querySelectorAll("a")).some(
      (anchor) => anchor.textContent === "product analytics",
    ),
  ).toBe(false);
});

test("the window is a week or a month, and its press hands the choice up", async () => {
  const { page, heard } = await openReliability(reliability());
  const windows = page.querySelector('[role="radiogroup"][aria-label="Window in days"]');
  const radios = Array.from(windows?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);

  expect(radios.map((radio) => radio.textContent)).toEqual(["7d", "30d"]);
  await act(async () => {
    radios[1]?.click();
  });
  expect(heard).toEqual(["window 30"]);
});
