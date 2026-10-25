/**
 * automations-fixture.ts -- the synthetic automations a fixture run's Automations profiles open, and the follows their pages hold in place of the service's.
 *
 * Under an Automations profile (`RUN_PROFILE.AUTOMATIONS*`) the account
 * signed in (`settings-fixture.ts`) holds three automations in the listed
 * workspace, one on a schedule, one on its pull requests, and one called by
 * a webhook, each with a history of runs, the webhook's newest run failed. The window opens on their list, on the first one's editor, or on
 * the failed one's with that run marked. Each follow their pages hold is
 * answered here, through the act door (`act.ts`), with the list or the runs
 * as they stand; nothing moves after. Every name, repository, and prompt
 * here is invented; nothing is read from an account.
 */

import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationListView,
  type AutomationRunsView,
  type AutomationWorkspaceRunsView,
} from "@luke/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
  type AutomationWorkspaceRun,
  GITHUB_TRIGGER_EVENT,
} from "@luke/features/automation-wire";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE } from "@luke/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@luke/host/contract";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "./use-tasks-tab.js";

/** When the fixture stands, from which every instant here is counted: a fixed one, never the clock. */
const NOW = Date.parse("2026-10-24T09:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The account signed in, as `settings-fixture.ts` names it, which created two of the three. */
const ACCOUNT_ID = "user-ada";

function uuid(series: string, n: number): string {
  return `${series}-${String(n).padStart(12, "0")}`;
}

const AUTOMATION_ID = {
  SWEEP: uuid("3f0e6f5c-7d1a-4f6e-9a55", 1),
  REVIEW: uuid("3f0e6f5c-7d1a-4f6e-9a55", 2),
  DEPLOY: uuid("3f0e6f5c-7d1a-4f6e-9a55", 3),
} as const;

/** One run, fired `agoHours` before the fixture stands and settled a few minutes after. */
function run(
  n: number,
  agoHours: number,
  firing: AutomationRunSummary["firing"],
  patch: Partial<AutomationRunSummary> = {},
): AutomationRunSummary {
  const firedAt = NOW - agoHours * HOUR;
  return {
    id: uuid("1c2d3e4f-5a6b-4c7d-8e9f", n),
    firing,
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: {
      id: uuid("8c1a6a4f-3d2e-4d8b-8b66", n),
      title: null,
      status: CODING_AGENT_STATUS.COMPLETED,
    },
    firedAt,
    settledAt: firedAt + 4 * MINUTE,
    ...patch,
  };
}

const SCHEDULED = (agoHours: number) => ({
  kind: AUTOMATION_FIRING.SCHEDULE,
  dueAt: NOW - agoHours * HOUR,
});

/** The sweep's runs, every weeknight, the newest still at work. */
const SWEEP_RUNS: readonly AutomationRunSummary[] = [
  run(1, 7, SCHEDULED(7), {
    agent: {
      id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 1),
      title: "Fix the flaky invite expiry test",
      status: CODING_AGENT_STATUS.RUNNING,
    },
    settledAt: NOW - 7 * HOUR + MINUTE,
  }),
  run(2, 31, SCHEDULED(31), {
    agent: {
      id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 2),
      title: "Quarantine the billing export timeout",
      status: CODING_AGENT_STATUS.COMPLETED,
    },
  }),
  run(3, 55, SCHEDULED(55), {
    status: AUTOMATION_RUN_STATUS.SKIPPED,
    reason: AUTOMATION_RUN_REASON.CONCURRENCY,
    agent: null,
  }),
  run(4, 79, SCHEDULED(79), {
    agent: {
      id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 4),
      title: "Retry the usage alert webhook once",
      status: CODING_AGENT_STATUS.COMPLETED,
    },
  }),
];

/** The reviews' runs, one per pull request pushed to. */
const REVIEW_RUNS: readonly AutomationRunSummary[] = [
  run(
    5,
    2,
    {
      kind: AUTOMATION_FIRING.GITHUB,
      event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
      repository: "ada/relay",
      number: 118,
      title: "Accept an invite from its link",
    },
    {
      agent: {
        id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 5),
        title: "Review #118",
        status: CODING_AGENT_STATUS.COMPLETED,
      },
    },
  ),
  run(
    6,
    26,
    {
      kind: AUTOMATION_FIRING.GITHUB,
      event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
      repository: "ada/ledger",
      number: 64,
      title: "Export invoices as CSV",
    },
    {
      agent: {
        id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 6),
        title: "Review #64",
        status: CODING_AGENT_STATUS.COMPLETED,
      },
    },
  ),
];

/** The deploy check's runs, the newest of which could not start its agent. */
const FAILED_RUN_ID = uuid("1c2d3e4f-5a6b-4c7d-8e9f", 7);
const DEPLOY_RUNS: readonly AutomationRunSummary[] = [
  run(
    7,
    1,
    { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 1824 },
    {
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: AUTOMATION_RUN_REASON.CREDENTIAL_MISSING,
      agent: null,
      settledAt: NOW - HOUR + 2_000,
    },
  ),
  run(
    8,
    22,
    { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 1790 },
    {
      agent: {
        id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 8),
        title: "Check the 2.14.0 deploy",
        status: CODING_AGENT_STATUS.COMPLETED,
      },
    },
  ),
  run(
    9,
    46,
    { kind: AUTOMATION_FIRING.MANUAL, userId: ACCOUNT_ID },
    {
      agent: {
        id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 9),
        title: "Check the 2.13.2 deploy",
        status: CODING_AGENT_STATUS.COMPLETED,
      },
    },
  ),
];

const RUNS: ReadonlyMap<string, readonly AutomationRunSummary[]> = new Map([
  [AUTOMATION_ID.SWEEP, SWEEP_RUNS],
  [AUTOMATION_ID.REVIEW, REVIEW_RUNS],
  [AUTOMATION_ID.DEPLOY, DEPLOY_RUNS],
]);

/** The three automations of a workspace, newest first, as its list reads them. */
function automations(workspaceId: string): readonly AutomationSummary[] {
  const common = {
    planId: null,
    planName: null,
    workspaceId,
    enabled: true,
    pausedReason: null,
    guards: AUTOMATION_DEFAULT_GUARDS,
    target: { kind: AUTOMATION_TARGET.NEW_AGENT },
  } as const;
  return [
    {
      ...common,
      id: AUTOMATION_ID.DEPLOY,
      name: "Check each deploy",
      trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
      action: {
        kind: AUTOMATION_ACTION.CODING_AGENT,
        prompt:
          "Open the release the webhook names, read its error rate for an hour, and roll it back if it doubled.",
        choice: { model: "openai/gpt-6.1-sol", effort: "medium" },
      },
      nextRunAt: null,
      lastRun: DEPLOY_RUNS[0] ?? null,
      createdAt: NOW - 9 * DAY,
      scope: AUTOMATION_SCOPE.PERSONAL,
      repositories: ["ada/relay"],
      mine: true,
      creatorId: ACCOUNT_ID,
    },
    {
      ...common,
      id: AUTOMATION_ID.REVIEW,
      name: "Review pull requests",
      trigger: {
        kind: AUTOMATION_TRIGGER.GITHUB,
        event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
        drafts: false,
      },
      action: {
        kind: AUTOMATION_ACTION.CODING_AGENT,
        prompt:
          "Review the pull request for correctness and leave comments on the lines that need a change.",
      },
      nextRunAt: null,
      lastRun: REVIEW_RUNS[0] ?? null,
      createdAt: NOW - 16 * DAY,
      scope: AUTOMATION_SCOPE.WORKSPACE,
      repositories: ["ada/relay", "ada/ledger"],
      mine: true,
      creatorId: ACCOUNT_ID,
    },
    {
      ...common,
      id: AUTOMATION_ID.SWEEP,
      name: "Nightly flaky-test sweep",
      trigger: {
        kind: AUTOMATION_TRIGGER.SCHEDULE,
        cron: "0 2 * * 1-5",
        timezone: "Europe/London",
      },
      action: {
        kind: AUTOMATION_ACTION.CODING_AGENT,
        prompt:
          "Find the flakiest test from last night's runs, fix it or quarantine it, and open a pull request.",
      },
      nextRunAt: NOW + 17 * HOUR,
      lastRun: SWEEP_RUNS[0] ?? null,
      createdAt: NOW - 30 * DAY,
      scope: AUTOMATION_SCOPE.WORKSPACE,
      repositories: ["ada/relay"],
      mine: false,
      creatorId: "user-maya",
    },
  ];
}

/** Every run of the workspace's automations, newest first, each with the automation it is a run of, as the Runs tab reads them. */
function workspaceRuns(workspaceId: string): readonly AutomationWorkspaceRun[] {
  return automations(workspaceId)
    .flatMap((automation) =>
      (RUNS.get(automation.id) ?? []).map((run) => ({
        ...run,
        automation: { id: automation.id, name: automation.name },
      })),
    )
    .toSorted((one, other) => other.firedAt - one.firedAt);
}

/** What a follow of the fixture pushes. */
type FollowedView = AutomationListView | AutomationRunsView | AutomationWorkspaceRunsView;

/** The page each Automations profile opens on. */
const AUTOMATIONS_PLACES: ReadonlyMap<string, AutomationsPlace> = new Map<string, AutomationsPlace>(
  [
    [RUN_PROFILE.AUTOMATIONS, { kind: AUTOMATIONS_PAGE.LIST }],
    [
      RUN_PROFILE.AUTOMATIONS_EDITOR,
      { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID.SWEEP },
    ],
    [
      RUN_PROFILE.AUTOMATIONS_RUNS,
      { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID.DEPLOY, runId: FAILED_RUN_ID },
    ],
  ],
);

/** A follow that pushes what stands once, as the host's does on opening, and nothing after, since nothing here moves. */
async function* pushedOnce(view: FollowedView): AsyncGenerator<FollowedView> {
  yield view;
}

/** What one follow pushes: a workspace's automations or its runs, or one automation's runs, which an id none of them has answers as gone. */
function followed(payload: PortActPayload<typeof ACT_KIND.AUTOMATIONS_FOLLOW>): FollowedView {
  if (payload.kind === AUTOMATION_FOLLOW.WORKSPACE) return { automations: automations(payload.id) };
  if (payload.kind === AUTOMATION_FOLLOW.WORKSPACE_RUNS) return { runs: workspaceRuns(payload.id) };
  const runs = RUNS.get(payload.id);
  return runs === undefined ? { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND } : { runs };
}

/** The page an Automations profile opens at launch; none under any other. */
export function automationsLaunchPlace(profile: string): AutomationsPlace | undefined {
  return AUTOMATIONS_PLACES.get(profile);
}

/**
 * What an Automations profile answers an act with, in place of main, held in
 * a box so an act that answers nothing is told from one left to main: its
 * follows, and nothing else, which the account's own reads answer
 * (`settings-fixture.ts`) or main does.
 */
export function automationsActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (!AUTOMATIONS_PLACES.has(profile) || kind !== ACT_KIND.AUTOMATIONS_FOLLOW) return undefined;
  // SAFETY: the kind is the follow's, so its payload is a follow's and the stream its answer.
  const follow = payload as PortActPayload<typeof ACT_KIND.AUTOMATIONS_FOLLOW>;
  return { answer: pushedOnce(followed(follow)) as PortActResult<PortActKind> };
}
