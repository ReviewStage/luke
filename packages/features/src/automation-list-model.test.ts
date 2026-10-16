import assert from "node:assert/strict";
import { test } from "vitest";
import {
  AUTOMATION_NEXT,
  AUTOMATION_RUN_STANDING,
  automationGroups,
  automationNext,
  automationRunLine,
  automationRunStanding,
  automationRunTitle,
  automationTriggerText,
} from "./automation-list-model.js";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
  type AutomationTrigger,
  GITHUB_SENDER,
  GITHUB_TRIGGER_EVENT,
  PULL_REQUEST_MOMENT,
} from "./automation-wire.js";
import { CODING_AGENT_FAILURE, CODING_AGENT_STATUS } from "./coding-agent-wire.js";

/**
 * The Automations list as a window draws it: the workspace's automations
 * before the account's personal ones, a schedule said in words, a newest
 * run's standing, and when each runs next. Synthetic ids and words.
 */

const SCHEDULE = {
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron: "0 9 * * 1-5",
  timezone: "America/New_York",
} as const;

function automation(id: string, extra: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    id,
    planId: null,
    planName: null,
    workspaceId: "workspace-1",
    name: `Automation ${id}`,
    enabled: true,
    pausedReason: null,
    trigger: SCHEDULE,
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage today's issues." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: 5_000,
    lastRun: null,
    createdAt: 1,
    ...extra,
  };
}

function run(extra: Partial<AutomationRunSummary>): AutomationRunSummary {
  return {
    id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    firing: { kind: "manual" },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: null,
    firedAt: 2,
    settledAt: 3,
    ...extra,
  };
}

test("the workspace's automations come before the personal ones, and an owner with none stands nowhere", () => {
  const mine = automation("a", { scope: AUTOMATION_SCOPE.PERSONAL });
  const shared = automation("b", { scope: AUTOMATION_SCOPE.WORKSPACE });
  const older = automation("c");
  const alsoShared = automation("d", { scope: AUTOMATION_SCOPE.WORKSPACE });

  assert.deepEqual(automationGroups([mine, shared, older, alsoShared]), [
    { owner: AUTOMATION_SCOPE.WORKSPACE, automations: [shared, alsoShared] },
    { owner: AUTOMATION_SCOPE.PERSONAL, automations: [mine, older] },
  ]);
  assert.deepEqual(automationGroups([mine]), [
    { owner: AUTOMATION_SCOPE.PERSONAL, automations: [mine] },
  ]);
  assert.deepEqual(automationGroups([]), []);
});

test("a schedule the picker writes is said in words in its zone's city, and any other as its cron", () => {
  const said = (cron: string, timezone = "America/New_York") =>
    automationTriggerText({ kind: AUTOMATION_TRIGGER.SCHEDULE, cron, timezone });

  assert.equal(said("0 9 * * 1-5"), "Weekdays at 9:00 · New York");
  assert.equal(said("30 7 * * *", "Europe/London"), "Every day at 7:30 · London");
  assert.equal(said("0 9 * * 1"), "Mondays at 9:00 · New York");
  assert.equal(said("0 9 * * 0"), "Sundays at 9:00 · New York");
  assert.equal(said("0 * * * *", "UTC"), "Every hour · UTC");
  assert.equal(said("0 9 1 * *"), "0 9 1 * * · New York");
  assert.equal(said("*/30 9-17 * * 1-5"), "*/30 9-17 * * 1-5 · New York");
});

test("a GitHub event is said as what happens, by whom, where, and the labels, branches, drafts, and forks it keeps to, and a webhook as its call", () => {
  const event = (settings: Partial<Extract<AutomationTrigger, { kind: "github" }>> = {}) => ({
    kind: AUTOMATION_TRIGGER.GITHUB,
    event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
    ...settings,
  });

  assert.equal(
    automationTriggerText(event(), ["acme/ledger"]),
    "When a pull request by people is opened, marked ready, or pushed to in acme/ledger",
  );
  assert.equal(
    automationTriggerText(event({ senders: [GITHUB_SENDER.PEOPLE, GITHUB_SENDER.LUKE_AGENTS] }), [
      "acme/ledger",
    ]),
    "When a pull request by people or Luke's agents is opened, marked ready, or pushed to in acme/ledger",
  );
  assert.equal(
    automationTriggerText(
      event({
        senders: [GITHUB_SENDER.PEOPLE, GITHUB_SENDER.PEOPLE, GITHUB_SENDER.OTHER_BOTS],
        moments: [
          PULL_REQUEST_MOMENT.PUSHED,
          PULL_REQUEST_MOMENT.OPENED,
          PULL_REQUEST_MOMENT.PUSHED,
        ],
      }),
      ["acme/ledger"],
    ),
    "When a pull request by people or other bots is opened or pushed to in acme/ledger",
  );
  assert.equal(
    automationTriggerText(
      event({
        senders: Object.values(GITHUB_SENDER),
        moments: [PULL_REQUEST_MOMENT.OPENED, PULL_REQUEST_MOMENT.READY],
        labels: ["bug", "p1"],
        branches: ["main"],
        drafts: true,
        forks: true,
      }),
      ["acme/api", "acme/web", "acme/ledger"],
    ),
    "When a pull request by anyone is opened or marked ready in acme/api, acme/web, or acme/ledger labelled bug or p1 on main, drafts and forks included",
  );
  assert.equal(
    automationTriggerText(
      { kind: AUTOMATION_TRIGGER.GITHUB, event: GITHUB_TRIGGER_EVENT.CHECK_FAILED },
      ["acme/ledger"],
    ),
    "When a check fails in acme/ledger",
  );
  assert.equal(
    automationTriggerText({ kind: AUTOMATION_TRIGGER.WEBHOOK }, ["acme/ledger"]),
    "When its webhook is called",
  );
});

test("a newest run is working while its agent works, failed where it could not start or its agent failed, and at rest otherwise", () => {
  const agent = (status: (typeof CODING_AGENT_STATUS)[keyof typeof CODING_AGENT_STATUS]) => ({
    id: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
    title: null,
    status,
  });

  assert.equal(automationRunStanding(null), AUTOMATION_RUN_STANDING.REST);
  assert.equal(
    automationRunStanding(run({ agent: agent(CODING_AGENT_STATUS.RUNNING) })),
    AUTOMATION_RUN_STANDING.WORKING,
  );
  assert.equal(
    automationRunStanding(run({ agent: agent(CODING_AGENT_STATUS.STARTING) })),
    AUTOMATION_RUN_STANDING.WORKING,
  );
  assert.equal(
    automationRunStanding(run({ status: AUTOMATION_RUN_STATUS.FAILED })),
    AUTOMATION_RUN_STANDING.FAILED,
  );
  assert.equal(
    automationRunStanding(run({ agent: agent(CODING_AGENT_STATUS.FAILED) })),
    AUTOMATION_RUN_STANDING.FAILED,
  );
  assert.equal(
    automationRunStanding(run({ agent: agent(CODING_AGENT_STATUS.COMPLETED) })),
    AUTOMATION_RUN_STANDING.REST,
  );
  assert.equal(
    automationRunStanding(run({ status: AUTOMATION_RUN_STATUS.SKIPPED })),
    AUTOMATION_RUN_STANDING.REST,
  );
});

test("an automation turned off says so before any instant, and one with no instant due says it has none", () => {
  assert.deepEqual(automationNext(automation("a")), { kind: AUTOMATION_NEXT.AT, at: 5_000 });
  assert.deepEqual(automationNext(automation("a", { enabled: false })), {
    kind: AUTOMATION_NEXT.OFF,
  });
  assert.deepEqual(automationNext(automation("a", { nextRunAt: null })), {
    kind: AUTOMATION_NEXT.UNSCHEDULED,
  });
});

test("a run is titled by its agent where the agent has a title, else by what fired it", () => {
  const agent = {
    id: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
    title: "Fix the flaky test",
    status: CODING_AGENT_STATUS.RUNNING,
  };

  assert.equal(automationRunTitle(run({ agent })), "Fix the flaky test");
  assert.equal(automationRunTitle(run({ agent: { ...agent, title: null } })), "Run now");
  assert.equal(
    automationRunTitle(run({ firing: { kind: "schedule", dueAt: 1 } })),
    "Scheduled run",
  );
});

test("a run's line says why it did not start, else where its agent stands, or that it waits", () => {
  const agent = (status: (typeof CODING_AGENT_STATUS)[keyof typeof CODING_AGENT_STATUS]) => ({
    id: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
    title: null,
    status,
  });

  assert.equal(
    automationRunLine(
      run({ status: AUTOMATION_RUN_STATUS.FAILED, reason: AUTOMATION_RUN_REASON.CREATOR_LEFT }),
    ),
    "Its creator is no longer in the workspace.",
  );
  assert.equal(
    automationRunLine(
      run({ status: AUTOMATION_RUN_STATUS.SKIPPED, reason: AUTOMATION_RUN_REASON.CONCURRENCY }),
    ),
    "Skipped: an earlier run's agent was still at work.",
  );
  assert.equal(
    automationRunLine(run({ status: AUTOMATION_RUN_STATUS.QUEUED })),
    "Waiting to start",
  );
  assert.equal(automationRunLine(run({ agent: agent(CODING_AGENT_STATUS.RUNNING) })), "Working");
  assert.equal(automationRunLine(run({ agent: agent(CODING_AGENT_STATUS.COMPLETED) })), "Finished");
  assert.equal(automationRunLine(run({ agent: null })), "Its agent is gone");
  assert.equal(
    automationRunLine(run({ agent: agent(CODING_AGENT_STATUS.FAILED) })),
    "Its agent failed",
  );
  assert.equal(
    automationRunLine(
      run({
        agent: {
          ...agent(CODING_AGENT_STATUS.FAILED),
          failureReason: CODING_AGENT_FAILURE.SANDBOX,
        },
      }),
    ),
    "Its agent failed: the sandbox or checkout failed",
  );
  const keyRefused = run({
    agent: {
      ...agent(CODING_AGENT_STATUS.FAILED),
      failureReason: CODING_AGENT_FAILURE.PROVIDER_KEY,
    },
  });
  assert.equal(
    automationRunLine(keyRefused, "its creator"),
    "Its agent failed: its creator's API key was refused or can't be read",
    "another's automation names whose key, and no Settings the reader cannot mend",
  );
  assert.match(automationRunLine(keyRefused), /check Settings › Coding agents › API keys$/u);
  const onTeammatesAgent = run({
    agent: {
      ...agent(CODING_AGENT_STATUS.FAILED),
      failureReason: CODING_AGENT_FAILURE.PROVIDER_KEY,
      ownKey: false,
    },
  });
  assert.equal(
    automationRunLine(onTeammatesAgent),
    "Its agent failed: its owner's API key was refused or can't be read",
    "a same-agent run on a teammate's agent names that agent's owner, whoever made the automation",
  );
  assert.match(
    automationRunLine(
      run({
        agent: {
          ...agent(CODING_AGENT_STATUS.FAILED),
          failureReason: CODING_AGENT_FAILURE.PROVIDER_KEY,
          ownKey: true,
        },
      }),
      "its creator",
    ),
    /check Settings › Coding agents › API keys$/u,
    "the reader's own agent is the reader's key, even on another's automation",
  );
});
