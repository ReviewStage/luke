/**
 * automation-runs.ts -- 0.21.0 shot "Automation runs": Automations' Runs tab over acme's automations, newest first, three still working and two failed, fired by Sentry issues and alerts, schedules, GitHub, and a webhook, and the sidebar's Automations row counting the runs at work.
 *
 * Throwaway (`README.md`). The one streaming read the page and the sidebar
 * share (`AUTOMATIONS_FOLLOW`) is answered once per follow with a fresh
 * generator; one step opens Automations on its Runs tab.
 */

import { AUTOMATION_FOLLOW } from "@luke/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  GITHUB_TRIGGER_EVENT,
  type AutomationRunSummary,
  type AutomationSummary,
  type AutomationWorkspaceRun,
} from "@luke/features/automation-wire";
import { CODING_AGENT_FAILURE, CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { SENTRY_LEVEL, SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "@luke/features/trigger-catalog";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import type { AutomationsPlace } from "../tasks/use-tasks-tab";
import { standingPlan, standingPlans } from "./board";
import { ago, daysAgo } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const uuid = (series: string, n: number): string => `${series}-${String(n).padStart(12, "0")}`;
const R = (n: number): string => uuid("b82d1f63-4c5e-4f70-8b21", n);
const G = (n: number): string => uuid("c93e2a74-5d6f-4a81-9c32", n);

const AUTOMATION = {
  SENTRY_RELAY: uuid("a71c0e52-3b4d-4e6f-9a10", 1),
  SENTRY_LEDGER: uuid("a71c0e52-3b4d-4e6f-9a10", 2),
  DEPENDENCIES: uuid("a71c0e52-3b4d-4e6f-9a10", 3),
  BILLING: uuid("a71c0e52-3b4d-4e6f-9a10", 4),
  REVIEW_WEB: uuid("a71c0e52-3b4d-4e6f-9a10", 5),
  CHECKS_MAIN: uuid("a71c0e52-3b4d-4e6f-9a10", 6),
  SMOKE: uuid("a71c0e52-3b4d-4e6f-9a10", 7),
  FLAKY: uuid("a71c0e52-3b4d-4e6f-9a10", 8),
} as const;

const NAME: Readonly<Record<string, string>> = {
  [AUTOMATION.SENTRY_RELAY]: "Triage new Sentry issues in relay",
  [AUTOMATION.SENTRY_LEDGER]: "Fix Sentry alerts in ledger",
  [AUTOMATION.DEPENDENCIES]: "Nightly dependency updates",
  [AUTOMATION.BILLING]: "Weekly billing reconciliation",
  [AUTOMATION.REVIEW_WEB]: "Review pull requests in web",
  [AUTOMATION.CHECKS_MAIN]: "Fix failing checks on main",
  [AUTOMATION.SMOKE]: "Post-deploy smoke check",
  [AUTOMATION.FLAKY]: "Flaky test sweep",
};

type RunAgent = NonNullable<AutomationRunSummary["agent"]>;

function agentOf(n: number, title: string, status: RunAgent["status"], more: Partial<RunAgent> = {}): RunAgent {
  return { id: G(n), title, status, ...more };
}

function sentry(
  event: (typeof SENTRY_TRIGGER_EVENT)[keyof typeof SENTRY_TRIGGER_EVENT],
  id: string,
  title: string,
): AutomationRunSummary["firing"] {
  return {
    kind: AUTOMATION_FIRING.INTEGRATION,
    provider: TRIGGER_PROVIDER.SENTRY,
    event,
    subject: { id, title, url: `https://acme.sentry.io/issues/${id}/` },
  };
}

function run(
  n: number,
  minutes: number,
  automationId: string,
  firing: AutomationRunSummary["firing"],
  agent: AutomationRunSummary["agent"],
  patch: Partial<AutomationRunSummary> = {},
): AutomationWorkspaceRun {
  const firedAt = ago(minutes);
  const working = agent?.status === CODING_AGENT_STATUS.RUNNING || agent?.status === CODING_AGENT_STATUS.STARTING;
  return {
    id: R(n),
    firing,
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent,
    firedAt,
    settledAt: working ? null : firedAt + 6 * 60_000,
    automation: { id: automationId, name: NAME[automationId] ?? "" },
    ...patch,
  };
}

/** Fifteen runs, newest first: three working, two failed, one skipped. */
function acmeRuns(): AutomationWorkspaceRun[] {
  return [
    run(1, 3, AUTOMATION.SENTRY_RELAY,
      sentry(SENTRY_TRIGGER_EVENT.ISSUE_CREATED, "4821907345", "TypeError: Cannot read properties of undefined (reading 'inviteId')"),
      agentOf(1, "Guard accept-invite against a missing invite", CODING_AGENT_STATUS.RUNNING)),
    run(2, 9, AUTOMATION.SMOKE, { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 1432 },
      agentOf(2, "Smoke-test the web 3.8.0 deploy", CODING_AGENT_STATUS.RUNNING)),
    run(3, 14, AUTOMATION.REVIEW_WEB,
      { kind: AUTOMATION_FIRING.GITHUB, event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED, repository: "acme/web", number: 135, title: "Theme the usage charts for dark mode" },
      agentOf(3, "Review #135", CODING_AGENT_STATUS.STARTING)),
    run(4, 41, AUTOMATION.SENTRY_LEDGER,
      sentry(SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED, "4819920112", "InvoiceTotalMismatch: ledger total differs from Stripe"),
      agentOf(4, "Round invoice totals before comparing with Stripe", CODING_AGENT_STATUS.FAILED, { failureReason: CODING_AGENT_FAILURE.SANDBOX })),
    run(5, 2 * 60, AUTOMATION.DEPENDENCIES, { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: ago(120) },
      agentOf(5, "Bump the Stripe and Postmark SDKs", CODING_AGENT_STATUS.COMPLETED)),
    run(6, 3 * 60, AUTOMATION.SENTRY_RELAY,
      sentry(SENTRY_TRIGGER_EVENT.ISSUE_CREATED, "4817733021", "TimeoutError: Postmark send exceeded 10s"),
      agentOf(6, "Retry invite emails when Postmark times out", CODING_AGENT_STATUS.COMPLETED)),
    run(7, 5 * 60, AUTOMATION.CHECKS_MAIN,
      { kind: AUTOMATION_FIRING.GITHUB, event: GITHUB_TRIGGER_EVENT.CHECK_FAILED, repository: "acme/relay", branch: "main" },
      agentOf(7, "Fix the invite expiry test on main", CODING_AGENT_STATUS.COMPLETED)),
    run(8, 9 * 60, AUTOMATION.BILLING, { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: ago(9 * 60) },
      agentOf(8, "Reconcile October invoices against Stripe", CODING_AGENT_STATUS.COMPLETED)),
    run(9, 14 * 60, AUTOMATION.SMOKE, { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 1398 },
      null, { status: AUTOMATION_RUN_STATUS.FAILED, reason: AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE }),
    run(10, 26 * 60, AUTOMATION.DEPENDENCIES, { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: ago(26 * 60) },
      agentOf(10, "Update Vite and Vitest in web", CODING_AGENT_STATUS.COMPLETED)),
    run(11, 2 * 24 * 60, AUTOMATION.SENTRY_RELAY,
      sentry(SENTRY_TRIGGER_EVENT.ISSUE_CREATED, "4810021876", "RangeError: invite expiry is in the past"),
      agentOf(11, "Reject invites whose expiry has passed", CODING_AGENT_STATUS.COMPLETED)),
    run(12, 2 * 24 * 60 + 180, AUTOMATION.REVIEW_WEB,
      { kind: AUTOMATION_FIRING.GITHUB, event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED, repository: "acme/web", number: 131, title: "Add the onboarding checklist to the dashboard" },
      agentOf(12, "Review #131", CODING_AGENT_STATUS.COMPLETED)),
    run(13, 3 * 24 * 60, AUTOMATION.DEPENDENCIES, { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: ago(3 * 24 * 60) },
      agentOf(13, "Bump Drizzle and drizzle-kit in relay", CODING_AGENT_STATUS.COMPLETED)),
    run(14, 3 * 24 * 60 + 300, AUTOMATION.CHECKS_MAIN,
      { kind: AUTOMATION_FIRING.GITHUB, event: GITHUB_TRIGGER_EVENT.CHECK_FAILED, repository: "acme/relay", branch: "main" },
      agentOf(14, "Fix the seats test after the billing migration", CODING_AGENT_STATUS.COMPLETED)),
    run(15, 4 * 24 * 60, AUTOMATION.SENTRY_RELAY,
      sentry(SENTRY_TRIGGER_EVENT.ISSUE_CREATED, "4806610032", "Error: duplicate key value violates unique constraint \"memberships_invite_token_key\""),
      agentOf(15, "Mint invite tokens with enough entropy to stay unique", CODING_AGENT_STATUS.COMPLETED)),
  ];
}

/** acme's eight automations, each with its newest run. */
function acmeAutomations(): AutomationSummary[] {
  const runs = acmeRuns();
  const last = (id: string): AutomationRunSummary | null => {
    const found = runs.find((each) => each.automation.id === id);
    if (found === undefined) return null;
    const { automation: _automation, ...summary } = found;
    return summary;
  };
  const automation = (
    id: string,
    trigger: AutomationSummary["trigger"],
    repositories: string[],
    creator: (typeof MEMBER)[keyof typeof MEMBER],
    more: Partial<AutomationSummary> = {},
  ): AutomationSummary => ({
    id,
    planId: null,
    planName: null,
    workspaceId: SHOT_ID.WORKSPACE,
    name: NAME[id] ?? "",
    enabled: true,
    trigger,
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: `${NAME[id] ?? ""}.` },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: last(id),
    createdAt: daysAgo(20),
    scope: AUTOMATION_SCOPE.WORKSPACE,
    repositories,
    target: { kind: AUTOMATION_TARGET.NEW_AGENT },
    mine: creator === MEMBER.DEAN,
    creatorId: creator.userId,
    ...more,
  });
  return [
    automation(AUTOMATION.SENTRY_RELAY, { kind: AUTOMATION_TRIGGER.INTEGRATION, provider: TRIGGER_PROVIDER.SENTRY, event: SENTRY_TRIGGER_EVENT.ISSUE_CREATED, filters: { project: ["relay"], environment: ["production"] } }, ["acme/relay"], MEMBER.DANA),
    automation(AUTOMATION.SENTRY_LEDGER, { kind: AUTOMATION_TRIGGER.INTEGRATION, provider: TRIGGER_PROVIDER.SENTRY, event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED, filters: { project: ["ledger"], level: [SENTRY_LEVEL.ERROR, SENTRY_LEVEL.FATAL] } }, ["acme/ledger"], MEMBER.DEAN),
    automation(AUTOMATION.DEPENDENCIES, { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "America/Los_Angeles" }, ["acme/relay", "acme/ledger", "acme/web"], MEMBER.JORDAN, { nextRunAt: ago(-(22 * 60 - 120)) }),
    automation(AUTOMATION.BILLING, { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1", timezone: "America/Los_Angeles" }, ["acme/ledger"], MEMBER.PRIYA, { nextRunAt: ago(-5 * 24 * 60) }),
    automation(AUTOMATION.REVIEW_WEB, { kind: AUTOMATION_TRIGGER.GITHUB, event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED }, ["acme/web"], MEMBER.THEO),
    automation(AUTOMATION.CHECKS_MAIN, { kind: AUTOMATION_TRIGGER.GITHUB, event: GITHUB_TRIGGER_EVENT.CHECK_FAILED, branches: ["main"] }, ["acme/relay"], MEMBER.DEAN),
    automation(AUTOMATION.SMOKE, { kind: AUTOMATION_TRIGGER.WEBHOOK }, ["acme/web"], MEMBER.DEAN, { scope: AUTOMATION_SCOPE.PERSONAL }),
    automation(AUTOMATION.FLAKY, { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 6 * * 1-5", timezone: "America/Los_Angeles" }, ["acme/relay"], MEMBER.DEAN, { scope: AUTOMATION_SCOPE.PERSONAL, enabled: false }),
  ];
}

/** Hands a follow its one view; a fresh generator for each, since several follows stand at once. */
async function* once<View>(view: View): AsyncGenerator<View> {
  yield view;
}

export function automationRunsShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({ plan: standingPlan(), plans: standingPlans(), extra: { workspaces: whoWorkspaces(members.length) } }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
      [ACT_KIND.AUTOMATIONS_FOLLOW]: (follow) => {
        const acme = follow.id === SHOT_ID.WORKSPACE;
        if (follow.kind === AUTOMATION_FOLLOW.WORKSPACE) return once({ automations: acme ? acmeAutomations() : [] }) as never;
        if (follow.kind === AUTOMATION_FOLLOW.WORKSPACE_RUNS) return once({ runs: acme ? acmeRuns() : [] }) as never;
        return once({ runs: acmeRuns().filter((each) => each.automation.id === follow.id) }) as never;
      },
    },
    steps: [
      {
        key: "automations-runs",
        ready: ({ plans }) => plans.workspace?.id === SHOT_ID.WORKSPACE,
        // Note that the Runs page is named by its value, because importing the tab's module here closes an import cycle.
        run: ({ plans }) => plans.automationsView.onOpen({ kind: "runs" } as AutomationsPlace),
      },
    ],
  };
}
