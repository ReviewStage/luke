import assert from "node:assert/strict";
import { test } from "vitest";
import {
  automationDraft,
  changeOf,
  createRequestOf,
  cronOf,
  DRAFT_FIELD,
  draftNextRuns,
  draftProblems,
  presetDraft,
  SCHEDULE_KIND,
  sameDraft,
  scheduleDraftOf,
  withGithubEvent,
  withRepository,
} from "./automation-draft-model.js";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
  GITHUB_SENDER,
  GITHUB_TRIGGER_EVENT,
  PULL_REQUEST_MOMENT,
} from "./automation-wire.js";
import { INTEGRATION_PROVIDER } from "./integration-wire.js";

/**
 * An automation as its editor holds it: a schedule read into the picker's
 * terms and written back, what stops a draft saving, its next runs, and the
 * writes that make or change it, each change only what moved. Synthetic
 * ids and words.
 */

const DEFAULTS = { timezone: "America/New_York", owner: AUTOMATION_SCOPE.PERSONAL };

/** A Wednesday morning in New York, in January, so no daylight-saving change is near. */
const NOW = new Date("2026-01-14T12:00:00Z");

const SAVED: AutomationSummary = {
  id: "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60",
  planId: null,
  planName: null,
  workspaceId: "workspace-acme",
  name: "Nightly flaky-test sweep",
  enabled: true,
  pausedReason: null,
  trigger: {
    kind: AUTOMATION_TRIGGER.SCHEDULE,
    cron: "0 2 * * 1-5",
    timezone: "America/Los_Angeles",
  },
  action: {
    kind: AUTOMATION_ACTION.CODING_AGENT,
    prompt: "Fix the flakiest test.",
    choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
  },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: 1,
  scope: AUTOMATION_SCOPE.WORKSPACE,
  repositories: ["acme/ledger"],
};

test("a cron the picker writes reads back as its kind and time, and any other is kept as it was", () => {
  for (const cron of ["15 * * * *", "30 7 * * *", "0 9 * * 1-5", "0 9 * * 3"]) {
    assert.equal(cronOf(scheduleDraftOf(cron)), cron, cron);
  }
  assert.equal(scheduleDraftOf("15 * * * *").kind, SCHEDULE_KIND.HOURLY);
  assert.deepEqual(
    { ...scheduleDraftOf("0 9 * * 7") },
    { kind: SCHEDULE_KIND.WEEKLY, hour: 9, minute: 0, weekday: 0, cron: "0 9 * * 7" },
  );
  for (const cron of ["0 9 1 * *", "*/30 9-17 * * 1-5", "0 25 * * *", "0 9 * * 1,3"]) {
    const read = scheduleDraftOf(cron);
    assert.equal(read.kind, SCHEDULE_KIND.CUSTOM, cron);
    assert.equal(cronOf(read), cron, cron);
  }
});

test("a new draft runs at nine on weekdays in the window's zone, and a saved one opens as it was saved", () => {
  const fresh = automationDraft(undefined, DEFAULTS);
  assert.equal(cronOf(fresh.schedule), "0 9 * * 1-5");
  assert.equal(fresh.timezone, "America/New_York");
  assert.equal(fresh.repository, null);

  const opened = automationDraft(SAVED, DEFAULTS);
  assert.deepEqual(
    [
      opened.name,
      cronOf(opened.schedule),
      opened.timezone,
      opened.prompt,
      opened.repository,
      opened.owner,
    ],
    [
      "Nightly flaky-test sweep",
      "0 2 * * 1-5",
      "America/Los_Angeles",
      "Fix the flakiest test.",
      "acme/ledger",
      AUTOMATION_SCOPE.WORKSPACE,
    ],
  );
});

test("a draft saves once it is named, told its task, on a schedule Luke reads at most every 15 minutes, and in a repository", () => {
  const fresh = automationDraft(undefined, DEFAULTS);
  assert.deepEqual(Object.keys(draftProblems(fresh, false, NOW)).toSorted(), [
    DRAFT_FIELD.NAME,
    DRAFT_FIELD.PROMPT,
    DRAFT_FIELD.REPOSITORY,
  ]);

  const written = { ...fresh, name: " Sweep ", prompt: "Fix it.", repository: "acme/ledger" };
  assert.deepEqual(draftProblems(written, false, NOW), {});

  const often = { ...written, schedule: scheduleDraftOf("*/5 * * * *") };
  assert.equal(
    draftProblems(often, false, NOW)[DRAFT_FIELD.SCHEDULE],
    "It can run at most every 15 minutes.",
  );
  const unread = { ...written, schedule: scheduleDraftOf("every morning") };
  assert.equal(
    draftProblems(unread, false, NOW)[DRAFT_FIELD.SCHEDULE],
    "That isn't a schedule Luke can read.",
  );
  const nowhere = { ...written, timezone: "Mars/Olympus" };
  assert.equal(draftProblems(nowhere, false, NOW)[DRAFT_FIELD.SCHEDULE], "Pick a time zone.");

  assert.deepEqual(
    draftProblems({ ...written, repository: null }, true, NOW),
    {},
    "a plan's automation works in its plan's repository",
  );
});

test("a draft's next runs fall on its schedule in its own zone", () => {
  const draft = {
    ...automationDraft(undefined, DEFAULTS),
    schedule: scheduleDraftOf("0 9 * * 1-5"),
  };

  assert.deepEqual(
    draftNextRuns(draft, NOW, 2).map((at) => new Date(at).toISOString()),
    ["2026-01-14T14:00:00.000Z", "2026-01-15T14:00:00.000Z"],
  );
  assert.deepEqual(draftNextRuns({ ...draft, timezone: "Mars/Olympus" }, NOW, 2), []);
});

test("a new automation is made in its workspace on its schedule, task, repository, and owner, the words trimmed", () => {
  const draft = {
    ...automationDraft(undefined, { ...DEFAULTS, owner: AUTOMATION_SCOPE.WORKSPACE }),
    name: " Sweep ",
    prompt: " Fix it. ",
    repository: "acme/ledger",
  };

  assert.deepEqual(createRequestOf(draft, "workspace-acme"), {
    workspaceId: "workspace-acme",
    repositories: ["acme/ledger"],
    name: "Sweep",
    trigger: {
      kind: AUTOMATION_TRIGGER.SCHEDULE,
      cron: "0 9 * * 1-5",
      timezone: "America/New_York",
    },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix it." },
    scope: AUTOMATION_SCOPE.WORKSPACE,
    target: { kind: AUTOMATION_TARGET.NEW_AGENT },
    archiveSuccessful: false,
  });
});

test("a save changes only what moved, the task keeping its model, and a draft that moved nothing changes nothing", () => {
  const opened = automationDraft(SAVED, DEFAULTS);
  assert.equal(changeOf(opened, SAVED, DEFAULTS), undefined);
  assert.equal(
    changeOf({ ...opened, name: " Nightly flaky-test sweep " }, SAVED, DEFAULTS),
    undefined,
  );

  assert.deepEqual(
    changeOf(
      {
        ...opened,
        prompt: "Fix the two flakiest tests.",
        schedule: scheduleDraftOf("0 3 * * 1-5"),
      },
      SAVED,
      DEFAULTS,
    ),
    {
      trigger: {
        kind: AUTOMATION_TRIGGER.SCHEDULE,
        cron: "0 3 * * 1-5",
        timezone: "America/Los_Angeles",
      },
      action: { ...SAVED.action, prompt: "Fix the two flakiest tests.", disabledServers: [] },
    },
  );
  assert.deepEqual(
    changeOf(
      { ...opened, repository: "acme/web", owner: AUTOMATION_SCOPE.PERSONAL },
      SAVED,
      DEFAULTS,
    ),
    { repositories: ["acme/web"], scope: AUTOMATION_SCOPE.PERSONAL },
  );
  const onTask = { ...SAVED, planId: "9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e" };
  assert.equal(
    changeOf({ ...automationDraft(onTask, DEFAULTS), repository: "acme/web" }, onTask, DEFAULTS),
    undefined,
    "a plan's automation works in its plan's repository",
  );
});

test("the servers a draft switches off are saved with its task, opened as saved, and a change of them in any order is a change of the task only once they differ", () => {
  const opened = automationDraft(SAVED, DEFAULTS);
  assert.deepEqual(opened.disabledServers, []);
  const switched = {
    ...opened,
    disabledServers: [INTEGRATION_PROVIDER.SENTRY, INTEGRATION_PROVIDER.LINEAR],
  };

  assert.deepEqual(changeOf(switched, SAVED, DEFAULTS), {
    action: {
      ...SAVED.action,
      disabledServers: [INTEGRATION_PROVIDER.SENTRY, INTEGRATION_PROVIDER.LINEAR],
    },
  });
  const saved = {
    ...SAVED,
    action: {
      ...SAVED.action,
      disabledServers: [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.SENTRY],
    },
  };
  assert.deepEqual(automationDraft(saved, DEFAULTS).disabledServers, [
    INTEGRATION_PROVIDER.LINEAR,
    INTEGRATION_PROVIDER.SENTRY,
  ]);
  assert.equal(changeOf(switched, saved, DEFAULTS), undefined, "the same servers in another order");
  assert.deepEqual(changeOf({ ...switched, disabledServers: [] }, saved, DEFAULTS), {
    action: { ...SAVED.action, disabledServers: [] },
  });
  assert.equal(
    createRequestOf(
      { ...switched, name: "Sweep", prompt: "Sweep.", repository: "acme/ledger" },
      "workspace-acme",
    ).action.disabledServers?.length,
    2,
  );
});

test("a change of the repository shown keeps the others its runs work in behind it, once each", () => {
  const several = { ...SAVED, repositories: ["acme/ledger", "acme/web"] };
  const opened = automationDraft(several, DEFAULTS);

  assert.deepEqual(changeOf({ ...opened, repository: "acme/api" }, several, DEFAULTS), {
    repositories: ["acme/api", "acme/web"],
  });
  assert.deepEqual(changeOf({ ...opened, repository: "acme/web" }, several, DEFAULTS), {
    repositories: ["acme/web"],
  });
});

test("an automation fired by an event keeps its trigger: its schedule fields stop nothing and save nothing", () => {
  const onEvent = {
    ...SAVED,
    trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: "issue-opened" as const },
  };
  const opened = automationDraft(onEvent, DEFAULTS);
  const rescheduled = { ...opened, schedule: scheduleDraftOf("*/5 * * * *") };

  assert.equal(opened.triggerKind, AUTOMATION_TRIGGER.GITHUB);
  assert.deepEqual(draftProblems(rescheduled, false, NOW), {});
  assert.deepEqual(draftNextRuns(rescheduled, NOW, 2), []);
  assert.equal(changeOf(rescheduled, onEvent, DEFAULTS), undefined);
});

/** The settings a GitHub trigger a draft writes always states, at a new draft's defaults. */
const SAID_SETTINGS = { senders: [GITHUB_SENDER.PEOPLE], drafts: false, forks: false };

test("a GitHub trigger's settings are written as the row of choices leaves them, and a change of one is a change of the trigger", () => {
  const onEvent = {
    ...SAVED,
    trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED },
  };
  const opened = automationDraft(onEvent, DEFAULTS);
  const chosen = {
    ...opened,
    githubSettings: {
      senders: [GITHUB_SENDER.PEOPLE, GITHUB_SENDER.LUKE_AGENTS],
      moments: [PULL_REQUEST_MOMENT.OPENED, PULL_REQUEST_MOMENT.READY],
      drafts: true,
      forks: false,
    },
  };

  assert.equal(
    changeOf(opened, onEvent, DEFAULTS),
    undefined,
    "a trigger naming none opens on the defaults",
  );
  assert.deepEqual(changeOf(chosen, onEvent, DEFAULTS), {
    trigger: {
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
      ...chosen.githubSettings,
    },
  });
  assert.deepEqual(
    draftProblems(
      { ...chosen, githubSettings: { ...chosen.githubSettings, senders: [] } },
      false,
      NOW,
    )[DRAFT_FIELD.SCHEDULE],
    "Choose whose events start it.",
  );
});

test("a trigger written as a GitHub event or a webhook is made and changed as one, and a GitHub trigger keeps the filters it was given", () => {
  const fresh = {
    ...automationDraft(undefined, DEFAULTS),
    name: "Code review",
    prompt: "Review this pull request.",
    repository: "acme/ledger",
  };
  const filtered = {
    ...SAVED,
    trigger: {
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
      labels: ["bug"],
    },
  };
  const opened = automationDraft(filtered, DEFAULTS);

  assert.deepEqual(
    createRequestOf({ ...fresh, triggerKind: AUTOMATION_TRIGGER.GITHUB }, "workspace-1").trigger,
    {
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
      ...SAID_SETTINGS,
      moments: Object.values(PULL_REQUEST_MOMENT),
    },
  );
  assert.deepEqual(
    changeOf(
      { ...automationDraft(SAVED, DEFAULTS), triggerKind: AUTOMATION_TRIGGER.WEBHOOK },
      SAVED,
      DEFAULTS,
    ),
    { trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } },
  );
  assert.deepEqual(
    changeOf({ ...opened, githubEvent: GITHUB_TRIGGER_EVENT.ISSUE_LABELED }, filtered, DEFAULTS),
    {
      trigger: {
        kind: AUTOMATION_TRIGGER.GITHUB,
        event: GITHUB_TRIGGER_EVENT.ISSUE_LABELED,
        labels: ["bug"],
        ...SAID_SETTINGS,
      },
    },
  );
  assert.ok(!sameDraft(opened, { ...opened, githubEvent: GITHUB_TRIGGER_EVENT.PUSH }));
  // An event chosen, then left for a schedule again, leaves the schedule's draft as it was.
  const scheduled = automationDraft(SAVED, DEFAULTS);
  assert.ok(sameDraft(scheduled, { ...scheduled, githubEvent: GITHUB_TRIGGER_EVENT.PUSH }));
});

test("two drafts are the same where every field the editor writes is, the words trimmed", () => {
  const fresh = automationDraft(undefined, DEFAULTS);

  assert.ok(sameDraft(fresh, { ...fresh, name: "  " }));
  for (const moved of [
    { ...fresh, name: "Sweep" },
    { ...fresh, schedule: scheduleDraftOf("0 10 * * 1-5") },
    { ...fresh, timezone: "Europe/London" },
    { ...fresh, repository: "acme/ledger" },
    { ...fresh, owner: AUTOMATION_SCOPE.WORKSPACE },
  ]) {
    assert.ok(!sameDraft(fresh, moved));
  }
});

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

test("runs land in a new agent each time on the account's default until a model is chosen, or in the one agent chosen", () => {
  const fresh = {
    ...automationDraft(undefined, DEFAULTS),
    name: "Sweep",
    prompt: "Fix it.",
    repository: "acme/ledger",
  };
  const choice = { model: "openai/gpt-6.1-sol", effort: "xhigh" };

  assert.deepEqual(
    createRequestOf({ ...fresh, choice, archiveSuccessful: true }, "workspace-acme").action,
    {
      kind: AUTOMATION_ACTION.CODING_AGENT,
      prompt: "Fix it.",
      choice,
    },
  );
  const same = { ...fresh, target: AUTOMATION_TARGET.SAME_AGENT };
  assert.equal(
    draftProblems(same, false, NOW)[DRAFT_FIELD.AGENT],
    "Choose the agent its runs go to.",
  );
  assert.deepEqual(createRequestOf({ ...same, agentId: AGENT_ID }, "workspace-acme").target, {
    kind: AUTOMATION_TARGET.SAME_AGENT,
    agentId: AGENT_ID,
  });
});

test("a saved automation opens on where its runs land, and a save sends only the target, model, or archiving that moved", () => {
  const onAgent = {
    ...SAVED,
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: AGENT_ID },
    archiveSuccessful: false,
  } as const;
  const opened = automationDraft(onAgent, DEFAULTS);
  assert.deepEqual(
    [opened.target, opened.agentId, opened.choice, opened.archiveSuccessful],
    [AUTOMATION_TARGET.SAME_AGENT, AGENT_ID, SAVED.action.choice, false],
  );

  assert.deepEqual(
    changeOf(
      { ...opened, target: AUTOMATION_TARGET.NEW_AGENT, archiveSuccessful: true },
      onAgent,
      DEFAULTS,
    ),
    {
      target: { kind: AUTOMATION_TARGET.NEW_AGENT },
      archiveSuccessful: true,
    },
  );
  assert.deepEqual(changeOf({ ...opened, choice: null }, onAgent, DEFAULTS), {
    action: {
      kind: AUTOMATION_ACTION.CODING_AGENT,
      prompt: SAVED.action.prompt,
      disabledServers: [],
    },
  });
  assert.equal(
    changeOf({ ...opened, agentId: null }, onAgent, DEFAULTS),
    undefined,
    "a same agent with none chosen is a problem, not a write",
  );
  const gone = { ...SAVED, target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: null } } as const;
  assert.equal(
    automationDraft(gone, DEFAULTS).agentId,
    null,
    "an agent since deleted reads as none chosen",
  );
});

test("a move to another repository lets go of the agent chosen, and a hidden choice of agent changes nothing while a new agent takes each run", () => {
  const onAgent = {
    ...SAVED,
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: AGENT_ID },
  } as const;
  const opened = automationDraft(onAgent, DEFAULTS);

  assert.equal(withRepository(opened, "acme/web").agentId, null);
  assert.equal(
    withRepository(opened, "acme/ledger").agentId,
    AGENT_ID,
    "the same repository keeps it",
  );

  const fresh = automationDraft(SAVED, DEFAULTS);
  const chosenThenLeft = { ...fresh, agentId: AGENT_ID };
  assert.ok(sameDraft(chosenThenLeft, fresh));
  assert.equal(changeOf(chosenThenLeft, SAVED, DEFAULTS), undefined);
});

test("a move to another GitHub event lets go of the filters the event before was given, so a push never keeps an issue's label filter", () => {
  const filtered = {
    ...SAVED,
    trigger: {
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
      labels: ["bug"],
    },
  };
  const opened = automationDraft(filtered, DEFAULTS);

  assert.deepEqual(
    changeOf(withGithubEvent(opened, GITHUB_TRIGGER_EVENT.PUSH), filtered, DEFAULTS),
    {
      trigger: {
        kind: AUTOMATION_TRIGGER.GITHUB,
        event: GITHUB_TRIGGER_EVENT.PUSH,
        ...SAID_SETTINGS,
      },
    },
  );
  assert.equal(withGithubEvent(opened, GITHUB_TRIGGER_EVENT.ISSUE_OPENED), opened);
  // Away and back again, the filters let go of are a change the editor can save, since it now shows none.
  const back = withGithubEvent(
    withGithubEvent(opened, GITHUB_TRIGGER_EVENT.PUSH),
    GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
  );
  assert.ok(!sameDraft(opened, back));
  assert.deepEqual(changeOf(back, filtered, DEFAULTS), {
    trigger: {
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
      ...SAID_SETTINGS,
    },
  });
});

test("a preset's guards are the draft's and are what it is made with, a saved automation opens on its own, and a draft that set none is the same as the automation made from it", () => {
  const fresh = automationDraft(undefined, DEFAULTS);
  const preset = {
    name: "Code review",
    trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED },
    prompt: "Review this pull request.",
    guards: { maxConcurrentRuns: 5, dailyRunCap: 50 },
    archiveSuccessful: true,
    description: "Reviews pull requests.",
  } as const;
  const taken = presetDraft(fresh, preset);

  assert.ok(!sameDraft({ ...taken, guards: { maxConcurrentRuns: 1, dailyRunCap: 10 } }, taken));
  assert.ok(sameDraft(fresh, { ...fresh, guards: { maxConcurrentRuns: 1, dailyRunCap: 10 } }));
  assert.deepEqual(createRequestOf(taken, "workspace-1").guards, preset.guards);
  assert.deepEqual(
    automationDraft({ ...SAVED, guards: preset.guards }, DEFAULTS).guards,
    preset.guards,
  );
});
