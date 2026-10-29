import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@luke/database/github-installation-vocabulary";
import { agentTable, type StoredPullRequest } from "@luke/database/schemas/agent";
import { session, user } from "@luke/database/schemas/auth";
import { automation, automationRun } from "@luke/database/schemas/automation";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { inboxItem } from "@luke/database/schemas/inbox";
import { integrationConnection } from "@luke/database/schemas/integration";
import { planRevision } from "@luke/database/schemas/plan-revision";
import { conversations } from "@luke/database/schemas/storage";
import { task } from "@luke/database/schemas/task";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import {
  DAILY_COUNT,
  type DailyCount,
  FUNNEL_STEP,
  REACH_FEATURE,
} from "@luke/features/admin-overview-vocabulary";
import { ADMIN_METRICS_SCOPE, ADMIN_METRICS_WINDOW } from "@luke/features/admin-wire";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { INBOX_STATUS } from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@luke/features/integration-wire";
import { PLAN_ACTOR, type PlanActor } from "@luke/features/task-wire";
import { Effect } from "effect";
import { USER_ROLE } from "./admin-access.js";
import { readAdminOverviewSource } from "./admin-overview-queries.js";

/**
 * admin-overview-queries.test.ts -- the Overview's reads over a real dialect:
 * a meaningful action is a task, the developer's own plan revision, or an
 * agent started, and nothing else makes an account active; each
 * daily count lands on its own UTC day; the funnel counts what the window's
 * new accounts ever did; reach counts the week's active developers alone;
 * the most active accounts carry their own counts; and hiding admins leaves
 * an admin's rows out of every number.
 *
 * Synthetic accounts throughout, read on Wednesday 2026-10-21 at noon UTC over
 * a 7-day window: the recent run is 10-15 to 10-21, the prior 10-08 to 10-14.
 */

const NOW = Date.UTC(2026, 9, 21, 12);

const at = (iso: string) => new Date(iso);

const openAccount = (name: string, createdAt: string, role: string = USER_ROLE.USER) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${name}-${randomUUID()}`;
    yield* db
      .insert(user)
      .values({ id, name, email: `${id}@luke.test`, role, createdAt: at(createdAt) });
    return id;
  });

/** The numbers the tasks below take, each its own whatever its workspace. */
let taskNumbers = 0;

const createTask = (userId: string, organizationId: string, createdAt: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    taskNumbers += 1;
    yield* db.insert(task).values({
      id,
      userId,
      organizationId,
      name: "Synthetic task",
      number: taskNumbers,
      document: "",
      createdAt: at(createdAt),
    });
    return id;
  });

const writeRevision = (taskId: string, userId: string, actor: PlanActor, when: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(planRevision).values({
      taskId,
      seq: 1,
      actor,
      userId,
      document: "",
      changes: 1,
      startedAt: at(when),
      at: at(when),
    });
  });

const MERGED_PULL_REQUEST: StoredPullRequest = {
  number: 7,
  title: "Synthetic pull request",
  url: "https://github.test/acme/api/pull/7",
  state: PULL_REQUEST_STATE.MERGED,
  checks: CHECK_SUMMARY.PASSING,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  mergedAt: Date.parse("2026-10-20T15:00:00Z"),
};

const startAgent = (
  userId: string,
  organizationId: string,
  createdAt: string,
  extra: Partial<typeof agentTable.$inferInsert> = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    yield* db.insert(agentTable).values({
      id,
      organizationId,
      userId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      idempotencyKey: randomUUID(),
      createdAt: at(createdAt),
      ...extra,
    });
    return id;
  });

const answerInboxItem = (userId: string, organizationId: string, agentId: string, when: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(inboxItem).values({
      userId,
      organizationId,
      agentId,
      key: randomUUID(),
      revision: 1,
      version: 1,
      title: "Synthetic item",
      needsReply: true,
      status: INBOX_STATUS.ANSWERED,
      answeredBy: userId,
      postedAt: at(when),
      settledAt: at(when),
      updatedAt: at(when),
    });
  });

/** An automation the account owns, with one run that started an agent and one a guard held back. */
const fireAutomation = (userId: string, organizationId: string, when: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(automation).values({
      id,
      userId,
      organizationId,
      name: "Synthetic automation",
      enabled: true,
      triggerKind: AUTOMATION_TRIGGER.SCHEDULE,
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "UTC" },
      action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "" },
      guards: AUTOMATION_DEFAULT_GUARDS,
    });
    for (const status of [AUTOMATION_RUN_STATUS.STARTED, AUTOMATION_RUN_STATUS.SKIPPED]) {
      yield* db.insert(automationRun).values({
        automationId: id,
        userId,
        dedupeKey: randomUUID(),
        firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: Date.parse(when) },
        status,
        firedAt: at(when),
      });
    }
    return id;
  });

const connectIntegration = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(integrationConnection).values({
      id: randomUUID(),
      userId,
      provider: INTEGRATION_PROVIDER.LINEAR,
      connectSubject: userId,
      connectionName: "linear",
      status: INTEGRATION_STATUS.CONNECTED,
    });
  });

const signIn = (userId: string, updatedAt: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId,
      expiresAt: at("2026-11-21T00:00:00Z"),
      createdAt: at(updatedAt),
      updatedAt: at(updatedAt),
    });
  });

/**
 * Ada joined this week and did one of everything. Bob joined long ago, made a
 * task in the prior week, and this week only had Luke's notetaker write on his
 * plan, which is Luke's and not a meaningful action of his own. Carol joined
 * this week and did nothing. Root is an admin who joined this week and acted.
 */
const seedService = Effect.gen(function* () {
  const db = yield* Database;
  const ada = yield* openAccount("ada", "2026-10-16T09:00:00Z");
  const bob = yield* openAccount("bob", "2026-09-01T09:00:00Z");
  yield* openAccount("carol", "2026-10-18T09:00:00Z");
  const root = yield* openAccount("root", "2026-10-17T09:00:00Z", USER_ROLE.ADMIN);

  const adaWorkspace = yield* openWorkspace(ada);
  yield* db.insert(githubInstallation).values({
    installationId: 101,
    organizationId: adaWorkspace,
    accountId: 201,
    accountLogin: "acme",
    accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
    status: GITHUB_INSTALLATION_STATUS.ACTIVE,
    createdAt: at("2026-10-16T10:00:00Z"),
    updatedAt: at("2026-10-16T10:00:00Z"),
  });
  const adaTask = yield* createTask(ada, adaWorkspace, "2026-10-20T10:00:00Z");
  yield* writeRevision(adaTask, ada, PLAN_ACTOR.DEVELOPER, "2026-10-18T10:00:00Z");
  const merged = yield* startAgent(ada, adaWorkspace, "2026-10-20T11:00:00Z", {
    published: MERGED_PULL_REQUEST,
  });
  yield* fireAutomation(ada, adaWorkspace, "2026-10-20T02:00:00Z");
  // Note that the agent's automation is deleted since, so its row keeps the run's origin and no id.
  yield* startAgent(ada, adaWorkspace, "2026-10-19T02:00:00Z", {
    automationOrigin: {
      name: "Synthetic automation",
      firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: Date.parse("2026-10-19T02:00:00Z") },
      prompt: "",
    },
  });
  yield* answerInboxItem(ada, adaWorkspace, merged, "2026-10-20T12:00:00Z");
  yield* connectIntegration(ada);
  yield* signIn(ada, "2026-10-21T09:00:00Z");

  const bobWorkspace = yield* openWorkspace(bob);
  const bobTask = yield* createTask(bob, bobWorkspace, "2026-10-10T10:00:00Z");
  yield* writeRevision(bobTask, bob, PLAN_ACTOR.NOTETAKER, "2026-10-20T10:00:00Z");
  yield* connectIntegration(bob);

  const rootWorkspace = yield* openWorkspace(root);
  yield* createTask(root, rootWorkspace, "2026-10-20T10:00:00Z");

  return { ada, root };
});

/** One daily count's nonzero days, as a plain record for comparing. */
function daysOf(
  daily: ReadonlyMap<DailyCount, ReadonlyMap<string, number>>,
  count: DailyCount,
): Record<string, number> {
  return Object.fromEntries(daily.get(count) ?? []);
}

it.layer(getTestDB())("the overview's reads", (it) => {
  it.effect(
    "count meaningful actions, daily counts, the funnel, reach, and the most active, admins hidden",
    () =>
      Effect.gen(function* () {
        const { ada, root } = yield* seedService;

        const source = yield* readAdminOverviewSource({
          now: NOW,
          scope: ADMIN_METRICS_SCOPE.NON_ADMINS,
          windowDays: ADMIN_METRICS_WINDOW.WEEK,
        });

        // Bob's notetaker revision makes him no active developer this week.
        assert.deepEqual(source.activeDevelopers, { recent: 1, prior: 1 });
        assert.deepEqual(daysOf(source.daily, DAILY_COUNT.TASKS_CREATED), {
          "2026-10-10": 1,
          "2026-10-20": 1,
        });
        assert.deepEqual(daysOf(source.daily, DAILY_COUNT.AGENTS_STARTED), {
          "2026-10-19": 1,
          "2026-10-20": 1,
        });
        assert.deepEqual(daysOf(source.daily, DAILY_COUNT.AGENTS_FROM_AUTOMATIONS), {
          "2026-10-19": 1,
        });
        assert.deepEqual(daysOf(source.daily, DAILY_COUNT.PRS_MERGED), { "2026-10-20": 1 });
        assert.deepEqual(daysOf(source.daily, DAILY_COUNT.PLAN_REVISIONS), {
          "2026-10-18": 1,
          "2026-10-20": 1,
        });
        assert.deepEqual(daysOf(source.daily, DAILY_COUNT.INBOX_ANSWERED), { "2026-10-20": 1 });
        // The guard's skip started nothing, so it is no run.
        assert.deepEqual(daysOf(source.daily, DAILY_COUNT.AUTOMATION_RUNS), { "2026-10-20": 1 });
        assert.deepEqual(source.prsOpened, { opened: 1, merged: 1 });

        assert.deepEqual(Object.fromEntries(source.funnel), {
          [FUNNEL_STEP.SIGNED_UP]: 2,
          [FUNNEL_STEP.GITHUB_CONNECTED]: 1,
          [FUNNEL_STEP.CREATED_TASK]: 1,
          [FUNNEL_STEP.STARTED_AGENT]: 1,
          [FUNNEL_STEP.OPENED_PR]: 1,
          [FUNNEL_STEP.MERGED_PR]: 1,
        });
        // Bob's own connected integration is not reach: he was not active this week.
        assert.deepEqual(Object.fromEntries(source.reach), {
          [REACH_FEATURE.TASKS]: 1,
          [REACH_FEATURE.CODING_AGENTS]: 1,
          [REACH_FEATURE.INBOX]: 1,
          [REACH_FEATURE.INTEGRATIONS]: 1,
          [REACH_FEATURE.AUTOMATIONS]: 1,
        });

        assert.deepEqual(
          source.topAccounts.map((account) => [account.id, account.activeDays]),
          [[ada, 3]],
        );
        assert.equal(source.accountCounts.tasks.get(ada), 1);
        assert.equal(source.accountCounts.agents.get(ada), 2);
        assert.equal(source.accountCounts.prsMerged.get(ada), 1);
        assert.equal(source.accountCounts.lastSeenAt.get(ada), Date.parse("2026-10-21T09:00:00Z"));
        assert.equal(source.accountCounts.tasks.get(root), undefined);

        // Ada's Sunday revision lands in her signup week; her agents in the next.
        assert.deepEqual(
          Object.fromEntries(source.retention.activeByCohortWeek.get("2026-10-12") ?? []),
          { "2026-10-12": 1, "2026-10-19": 1 },
        );
        assert.deepEqual(
          Object.fromEntries(source.retention.activeByCohortWeek.get("2026-08-31") ?? []),
          { "2026-10-05": 1 },
        );
        assert.equal(source.retention.cohortSizes.get("2026-10-12"), 2);

        const everyone = yield* readAdminOverviewSource({
          now: NOW,
          scope: ADMIN_METRICS_SCOPE.ALL,
          windowDays: ADMIN_METRICS_WINDOW.WEEK,
        });
        assert.deepEqual(everyone.activeDevelopers, { recent: 2, prior: 1 });
        assert.equal(everyone.funnel.get(FUNNEL_STEP.SIGNED_UP), 3);
        assert.deepEqual(
          everyone.topAccounts.map((account) => account.id),
          [ada, root],
        );
        assert.equal(everyone.accountCounts.tasks.get(root), 1);
      }),
  );
});
