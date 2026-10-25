// @vitest-environment jsdom
import { ADMIN_PULL_REQUEST, ADMIN_WORKSPACE_KIND } from "@luke/features/admin-account-wire";
import type { AdminAccountSupport, AdminWorkspaceList } from "@luke/features/admin-answer-wire";
import { ADMIN_WORKSPACES_KIND } from "@luke/features/admin-wire";
import { CODING_AGENT_STATUS, CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { GITHUB_INSTALLATION_STATUS } from "@luke/features/github-installation-wire";
import { INTEGRATION_ROW_STATUS } from "@luke/features/integration-row-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { STATUS_TONE } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { rendererRegistry } from "../renderer-runtime.js";
import { PULL_REQUEST_TONE } from "../tasks/pull-request-mark.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { type AdminDoors, AdminDoorsProvider } from "./admin-doors.js";
import { AccountSupportSections } from "./screens/account-support.js";
import { WorkspacesScreen } from "./screens/workspaces.js";

/**
 * admin-status-words.test.ts -- the admin pages say a status in the app's own
 * words and tones, and one state wears one tone on every screen: a pull
 * request is green open, purple merged and red closed as the sidebar draws it,
 * an expired sign-in needs attention, and an uninstalled GitHub App is a
 * danger on the account page and the workspaces table alike. Synthetic data.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` in a page of its own, once its reads have answered. */
async function draw(element: React.ReactElement, doors?: AdminDoors): Promise<HTMLElement> {
  const page = document.body.appendChild(document.createElement("div"));
  const root = createRoot(page);
  roots.push(root);
  const content =
    doors === undefined ? element : createElement(AdminDoorsProvider, { value: doors }, element);
  await act(async () => root.render(onRegistry(rendererRegistry, content)));
  return page;
}

/** Each badge's words and the tone it is drawn in. */
function badges(page: HTMLElement): Map<string, string | null> {
  return new Map(
    Array.from(page.querySelectorAll("[data-tone]"), (badge) => [
      badge.textContent ?? "",
      badge.getAttribute("data-tone"),
    ]),
  );
}

const SUPPORT: AdminAccountSupport = {
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
  recentAgents: [CODING_AGENT_STATUS.RUNNING, CODING_AGENT_STATUS.CANCELLED].map(
    (status, index) => ({
      id: `agent-${status}`,
      createdAt: Date.UTC(2026, 9, 24, index),
      repository: "acme/web",
      model: "claude",
      effort: "high",
      contextWindow: CONTEXT_WINDOW.STANDARD,
      status,
      failure: null,
      pullRequest:
        [ADMIN_PULL_REQUEST.OPEN, ADMIN_PULL_REQUEST.CLOSED][index] ?? ADMIN_PULL_REQUEST.NONE,
    }),
  ),
  workspaces: [
    {
      id: "workspace-acme",
      name: "Acme",
      kind: ADMIN_WORKSPACE_KIND.SHARED,
      role: "owner",
      memberCount: 3,
      github: [GITHUB_INSTALLATION_STATUS.DELETED],
    },
  ],
  providerKeys: [],
  connections: [
    { provider: INTEGRATION_PROVIDER.LINEAR, status: INTEGRATION_ROW_STATUS.EXPIRED, at: 0 },
  ],
  defaults: { model: null, effort: null, contextWindow: null, experiments: [] },
  failures: [],
};

const WORKSPACES: AdminWorkspaceList = {
  generatedAt: Date.UTC(2026, 9, 24),
  activityDays: 7,
  kind: ADMIN_WORKSPACES_KIND.ALL,
  total: 1,
  limit: 200,
  search: undefined,
  summary: {
    shared: 1,
    sharedActiveWeek: 0,
    invitations: { accepted: 0, pending: 0, expired: 0, settled: 0, acceptanceRate: null },
    github: { sharedWithActive: 0, sharedWithSuspended: 0, activeShare: null },
  },
  rows: [
    {
      id: "workspace-acme",
      name: "Acme",
      personal: false,
      owner: null,
      members: 3,
      installations: [{ login: "acme", status: GITHUB_INSTALLATION_STATUS.DELETED }],
      integrations: [
        { provider: INTEGRATION_PROVIDER.LINEAR, status: INTEGRATION_ROW_STATUS.EXPIRED },
      ],
      tasksWeek: 0,
      agentsWeek: 0,
      prsMergedWeek: 0,
      createdAt: Date.UTC(2026, 0, 1),
    },
  ],
};

const unanswered = () => Promise.withResolvers<never>().promise;

const WORKSPACE_DOORS: AdminDoors = {
  reads: {
    metrics: unanswered,
    cost: unanswered,
    reliability: unanswered,
    users: unanswered,
    user: unanswered,
    day: unanswered,
    workspaces: async () => WORKSPACES,
    favorite: async () => true,
  },
  gate: {
    heldAtGate: () => false,
    signedOut: () => createElement("p", null, "Signed out"),
    forbidden: () => createElement("p", null, "Forbidden"),
  },
  address: {
    accountHref: () => undefined,
    search: () => "",
    keepSearch: () => undefined,
    onSearchMoved: () => () => undefined,
  },
};

const WORKSPACES_PROPS = {
  hideAdmins: false,
  onHideAdminsChange: () => undefined,
  windowDays: 30,
  onWindowDaysChange: () => undefined,
  account: undefined,
  onSignOut: async () => undefined,
  onOpenAccount: () => undefined,
  frame: (content: React.JSX.Element) => content,
} as const;

test("an agent's status and pull request read as the app words them, in the app's tones", async () => {
  const seen = badges(
    await draw(createElement(AccountSupportSections, { support: SUPPORT, windowDays: 30 })),
  );
  expect(seen.get("Working")).toBe(STATUS_TONE.WORKING);
  expect(seen.get("Stopped")).toBe(STATUS_TONE.NEUTRAL);
  expect(seen.get("Open")).toBe(PULL_REQUEST_TONE.open);
  expect(seen.get("Open")).toBe(STATUS_TONE.COMPLETE);
  expect(seen.get("Closed")).toBe(PULL_REQUEST_TONE.closed);
  expect(seen.get("Closed")).toBe(STATUS_TONE.DANGER);
});

test("an expired sign-in and an uninstalled GitHub App wear the same tone on the account page and the workspaces table", async () => {
  const account = badges(
    await draw(createElement(AccountSupportSections, { support: SUPPORT, windowDays: 30 })),
  );
  const workspaces = badges(
    await draw(createElement(WorkspacesScreen, WORKSPACES_PROPS), WORKSPACE_DOORS),
  );

  expect(account.get("Sign-in expired")).toBe(STATUS_TONE.ATTENTION);
  expect(workspaces.get("Linear · Sign-in expired")).toBe(STATUS_TONE.ATTENTION);
  expect(account.get("Uninstalled")).toBe(STATUS_TONE.DANGER);
  expect(workspaces.get("Uninstalled")).toBe(STATUS_TONE.DANGER);
});
