import { AGENT_STATUS } from "@repo/features/agent-wire";
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
} from "@repo/features/automation-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { type AppAutomationReads, type AppStateSnapshot, RUN_PROFILE } from "@repo/host/app-state";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "./use-tasks-tab.js";

const NOW = Date.parse("2026-10-24T09:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ACCOUNT_ID = "user-ada";

function uuid(series: string, n: number): string {
  return `${series}-${String(n).padStart(12, "0")}`;
}

const AUTOMATION_ID = {
  SWEEP: uuid("3f0e6f5c-7d1a-4f6e-9a55", 1),
  REVIEW: uuid("3f0e6f5c-7d1a-4f6e-9a55", 2),
  DEPLOY: uuid("3f0e6f5c-7d1a-4f6e-9a55", 3),
} as const;

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
      status: AGENT_STATUS.COMPLETED,
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

const SWEEP_RUNS: readonly AutomationRunSummary[] = [
  run(1, 7, SCHEDULED(7), {
    agent: {
      id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 1),
      title: "Fix the flaky invite expiry test",
      status: AGENT_STATUS.RUNNING,
    },
    settledAt: NOW - 7 * HOUR + MINUTE,
  }),
  run(2, 31, SCHEDULED(31), {
    agent: {
      id: uuid("8c1a6a4f-3d2e-4d8b-8b66", 2),
      title: "Quarantine the billing export timeout",
      status: AGENT_STATUS.COMPLETED,
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
      status: AGENT_STATUS.COMPLETED,
    },
  }),
];

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
        status: AGENT_STATUS.COMPLETED,
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
        status: AGENT_STATUS.COMPLETED,
      },
    },
  ),
];

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
        status: AGENT_STATUS.COMPLETED,
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
        status: AGENT_STATUS.COMPLETED,
      },
    },
  ),
];

const RUNS: ReadonlyMap<string, readonly AutomationRunSummary[]> = new Map([
  [AUTOMATION_ID.SWEEP, SWEEP_RUNS],
  [AUTOMATION_ID.REVIEW, REVIEW_RUNS],
  [AUTOMATION_ID.DEPLOY, DEPLOY_RUNS],
]);

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
        kind: AUTOMATION_ACTION.AGENT,
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
        kind: AUTOMATION_ACTION.AGENT,
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
        kind: AUTOMATION_ACTION.AGENT,
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

export function automationsLaunchPlace(profile: string): AutomationsPlace | undefined {
  return AUTOMATIONS_PLACES.get(profile);
}

function stagedReads(workspaceIds: readonly string[]): AppAutomationReads {
  const ofEach = <Rows>(ids: readonly string[], rows: (id: string) => Rows) =>
    Object.fromEntries(ids.map((id) => [id, { rows: rows(id) }]));
  return {
    [LIVE_READ.AUTOMATIONS]: ofEach(workspaceIds, automations),
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: ofEach(workspaceIds, workspaceRuns),
    [LIVE_READ.AUTOMATION_RUNS]: ofEach([...RUNS.keys()], (id) => RUNS.get(id) ?? []),
  };
}

const STAGED_READS = new WeakMap<readonly string[], AppAutomationReads>();

const LAID_OVER = {
  [LIVE_READ.AUTOMATIONS]: new WeakMap<object, object>(),
  [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: new WeakMap<object, object>(),
  [LIVE_READ.AUTOMATION_RUNS]: new WeakMap<object, object>(),
} as const satisfies Record<keyof AppAutomationReads, WeakMap<object, object>>;

function laidOver<Read extends keyof AppAutomationReads>(
  read: Read,
  held: AppAutomationReads[Read],
  staged: AppAutomationReads[Read],
): AppAutomationReads[Read] {
  const kept = LAID_OVER[read];
  const laid = kept.get(held);
  if (laid !== undefined) return laid as AppAutomationReads[Read];
  const next = { ...held, ...staged };
  kept.set(held, next);
  return next;
}

export function automationsAppState(
  state: AppStateSnapshot,
  workspaceIds: readonly string[],
): AppStateSnapshot {
  if (!AUTOMATIONS_PLACES.has(state.run.profile)) return state;
  let staged = STAGED_READS.get(workspaceIds);
  if (staged === undefined) {
    staged = stagedReads(workspaceIds);
    STAGED_READS.set(workspaceIds, staged);
  }
  return {
    ...state,
    [LIVE_READ.AUTOMATIONS]: laidOver(
      LIVE_READ.AUTOMATIONS,
      state[LIVE_READ.AUTOMATIONS],
      staged[LIVE_READ.AUTOMATIONS],
    ),
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: laidOver(
      LIVE_READ.AUTOMATION_WORKSPACE_RUNS,
      state[LIVE_READ.AUTOMATION_WORKSPACE_RUNS],
      staged[LIVE_READ.AUTOMATION_WORKSPACE_RUNS],
    ),
    [LIVE_READ.AUTOMATION_RUNS]: laidOver(
      LIVE_READ.AUTOMATION_RUNS,
      state[LIVE_READ.AUTOMATION_RUNS],
      staged[LIVE_READ.AUTOMATION_RUNS],
    ),
  };
}
