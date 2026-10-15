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
  SCHEDULE_KIND,
  scheduleDraftOf,
} from "./automation-draft-model.js";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "./automation-wire.js";

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
      action: { ...SAVED.action, prompt: "Fix the two flakiest tests." },
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
  const onPlan = { ...SAVED, planId: "9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e" };
  assert.equal(
    changeOf({ ...automationDraft(onPlan, DEFAULTS), repository: "acme/web" }, onPlan, DEFAULTS),
    undefined,
    "a plan's automation works in its plan's repository",
  );
});
