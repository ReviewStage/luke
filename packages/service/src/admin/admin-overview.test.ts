import assert from "node:assert/strict";
import { test } from "vitest";
import { buildAdminOverview, emptyOverviewSource } from "./admin-overview.js";
import {
  ACTIVITY_FEATURE,
  DAILY_COUNT,
  type DailyCount,
  FUNNEL_STEP,
  REACH_FEATURE,
} from "./admin-overview-vocabulary.js";
import { ADMIN_METRICS_WINDOW } from "./http.js";

/**
 * admin-overview.test.ts -- the overview's fold: the chart's days are the
 * window's own, zero-filled; each tile's trend compares the last seven UTC
 * days with the seven before, whatever the window; the funnel and reach keep
 * the vocabulary's order with shares of their own bases, and no share of
 * nobody; and the most active accounts keep their rank with their counts
 * joined, call seconds read as whole minutes.
 */

/** Wednesday 2026-10-21 at noon UTC. */
const NOW = Date.UTC(2026, 9, 21, 12);

function dailyOf(
  entries: readonly [DailyCount, Record<string, number>][],
): ReadonlyMap<DailyCount, ReadonlyMap<string, number>> {
  return new Map(entries.map(([count, byDay]) => [count, new Map(Object.entries(byDay))]));
}

test("the chart's days are the window's own, every feature zero-filled, today last", () => {
  const overview = buildAdminOverview(
    {
      ...emptyOverviewSource(),
      daily: dailyOf([
        [DAILY_COUNT.AGENTS_STARTED, { "2026-10-21": 4, "2026-10-14": 9 }],
        [DAILY_COUNT.CALLS_HELD, { "2026-10-15": 2 }],
      ]),
    },
    NOW,
    ADMIN_METRICS_WINDOW.WEEK,
  );

  assert.deepEqual(
    overview.activity.daily.map((point) => point.day),
    [
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
    ],
  );
  assert.deepEqual(overview.activity.daily.at(0), {
    day: "2026-10-15",
    [ACTIVITY_FEATURE.AGENTS_STARTED]: 0,
    [ACTIVITY_FEATURE.PLAN_REVISIONS]: 0,
    [ACTIVITY_FEATURE.CALLS_HELD]: 2,
    [ACTIVITY_FEATURE.INBOX_ANSWERED]: 0,
    [ACTIVITY_FEATURE.AUTOMATION_RUNS]: 0,
  });
  assert.equal(overview.activity.daily.at(-1)?.[ACTIVITY_FEATURE.AGENTS_STARTED], 4);
  // The day before the window still counts toward the prior run.
  assert.deepEqual(overview.activity.trend, { days: 7, recent: 6, prior: 9 });
});

test("each tile compares the last seven days with the seven before, past a short window", () => {
  const overview = buildAdminOverview(
    {
      ...emptyOverviewSource(),
      activeDevelopers: { recent: 12, prior: 10 },
      daily: dailyOf([
        [DAILY_COUNT.TASKS_CREATED, { "2026-10-21": 3, "2026-10-08": 5, "2026-10-07": 100 }],
        [DAILY_COUNT.AGENTS_STARTED, { "2026-10-20": 8 }],
        [DAILY_COUNT.AGENTS_FROM_AUTOMATIONS, { "2026-10-20": 2, "2026-10-12": 1 }],
        [DAILY_COUNT.PRS_MERGED, { "2026-10-16": 1, "2026-10-09": 4 }],
      ]),
      prsOpened: { opened: 5, merged: 3 },
    },
    NOW,
    ADMIN_METRICS_WINDOW.WEEK,
  );

  assert.deepEqual(overview.headline.activeDevelopers, { days: 7, recent: 12, prior: 10 });
  // The 10-07 tasks fall before both runs.
  assert.deepEqual(overview.headline.tasksCreated, { days: 7, recent: 3, prior: 5 });
  assert.deepEqual(overview.headline.agentsStarted, { days: 7, recent: 8, prior: 0 });
  assert.equal(overview.headline.agentsFromAutomations, 2);
  assert.deepEqual(overview.headline.prsMerged, { days: 7, recent: 1, prior: 4 });
  assert.deepEqual(overview.headline.prsOpened, { opened: 5, merged: 3 });
});

test("the funnel and reach keep their order, with shares of their bases and none of nobody", () => {
  const overview = buildAdminOverview(
    {
      ...emptyOverviewSource(),
      activeDevelopers: { recent: 4, prior: 0 },
      funnel: new Map([
        [FUNNEL_STEP.SIGNED_UP, 10],
        [FUNNEL_STEP.CREATED_TASK, 5],
      ]),
      reach: new Map([[REACH_FEATURE.CODING_AGENTS, 3]]),
    },
    NOW,
    ADMIN_METRICS_WINDOW.MONTH,
  );

  assert.deepEqual(
    overview.funnel.map((step) => [step.step, step.accounts, step.share]),
    [
      [FUNNEL_STEP.SIGNED_UP, 10, 1],
      [FUNNEL_STEP.GITHUB_CONNECTED, 0, 0],
      [FUNNEL_STEP.CREATED_TASK, 5, 0.5],
      [FUNNEL_STEP.HELD_CALL, 0, 0],
      [FUNNEL_STEP.STARTED_AGENT, 0, 0],
      [FUNNEL_STEP.OPENED_PR, 0, 0],
      [FUNNEL_STEP.MERGED_PR, 0, 0],
    ],
  );
  assert.equal(overview.reach.activeDevelopers, 4);
  assert.deepEqual(
    overview.reach.features.map((row) => [row.feature, row.share]),
    [
      [REACH_FEATURE.TASKS, 0],
      [REACH_FEATURE.CODING_AGENTS, 0.75],
      [REACH_FEATURE.INBOX, 0],
      [REACH_FEATURE.VOICE_CALLS, 0],
      [REACH_FEATURE.INTEGRATIONS, 0],
      [REACH_FEATURE.AUTOMATIONS, 0],
      [REACH_FEATURE.CHAT, 0],
    ],
  );

  const quiet = buildAdminOverview(emptyOverviewSource(), NOW, ADMIN_METRICS_WINDOW.MONTH);
  assert.ok(quiet.funnel.every((step) => step.share === null));
  assert.ok(quiet.reach.features.every((row) => row.share === null));
});

test("the most active keep their rank, their counts joined and call seconds read as minutes", () => {
  const account = { email: "", image: null, admin: false };
  const overview = buildAdminOverview(
    {
      ...emptyOverviewSource(),
      topAccounts: [
        { ...account, id: "ada", name: "Ada", activeDays: 6 },
        { ...account, id: "bob", name: "Bob", activeDays: 2 },
      ],
      accountCounts: {
        tasks: new Map([["ada", 4]]),
        agents: new Map([
          ["ada", 9],
          ["bob", 1],
        ]),
        prsMerged: new Map([["ada", 2]]),
        callSeconds: new Map([["ada", 150]]),
        lastSeenAt: new Map([["bob", 1_000]]),
      },
    },
    NOW,
    ADMIN_METRICS_WINDOW.MONTH,
  );

  assert.deepEqual(
    overview.topAccounts.map((row) => [
      row.id,
      row.activeDays,
      row.tasks,
      row.agents,
      row.prsMerged,
      row.callMinutes,
      row.lastSeenAt,
    ]),
    [
      ["ada", 6, 4, 9, 2, 3, null],
      ["bob", 2, 0, 1, 0, 0, 1_000],
    ],
  );
});
