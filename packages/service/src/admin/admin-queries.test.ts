import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { agentTable } from "@repo/database/schemas/agent";
import { account, user } from "@repo/database/schemas/auth";
import { planRevision } from "@repo/database/schemas/plan-revision";
import { conversations } from "@repo/database/schemas/storage";
import { task } from "@repo/database/schemas/task";
import { hostedUsage } from "@repo/database/schemas/usage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_WINDOW,
  type AdminMetricsScope,
} from "@repo/features/admin-wire";
import { PLAN_ACTOR, type PlanActor } from "@repo/features/task-wire";
import { Effect } from "effect";
import { USER_ROLE } from "./admin-access.js";
import { readAdminAccountSource } from "./admin-account-queries.js";
import { readAdminUserSource, readAdminUsersSource } from "./admin-queries.js";
import { buildAdminUserDetail } from "./admin-user.js";

/**
 * admin-queries.test.ts -- the Users read carries the sign-in methods the
 * Overview used to: every account the scope keeps, by each method it linked,
 * whatever the search narrowed the rows to, and an admin's own left out
 * while admins are hidden; and it ranks and counts accounts by meaningful
 * actions, never by hosted calls, as one account's page reads its activity.
 * Synthetic accounts throughout.
 *
 * The file has its database to itself (`getTestDB` opens a fresh PGlite, or
 * clones the migrated Postgres, per file), so a user id needs no random part
 * to stay unique, and must carry none: the search matches a substring of the
 * email, which is built from the id, and a random hex UUID holds "ada" often
 * enough to make a second account match it.
 */

const NOW = Date.UTC(2026, 9, 21, 12);

const openAccount = (name: string, providers: readonly string[], role: string = USER_ROLE.USER) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${name}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test`, role });
    for (const providerId of providers) {
      yield* db.insert(account).values({
        id: randomUUID(),
        accountId: randomUUID(),
        providerId,
        userId: id,
        updatedAt: new Date(NOW),
      });
    }
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
      createdAt: new Date(createdAt),
    });
    return id;
  });

/** A plan revision of `taskId`, numbered `seq`, written by `actor` as `userId`. */
const revisePlan = (taskId: string, seq: number, actor: PlanActor, userId: string, at: string) =>
  Database.use((db) =>
    db.insert(planRevision).values({
      taskId,
      seq,
      actor,
      userId,
      document: "",
      changes: 1,
      startedAt: new Date(at),
      at: new Date(at),
    }),
  );

const startAgent = (userId: string, organizationId: string, createdAt: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.AGENT });
    yield* db.insert(agentTable).values({
      id: randomUUID(),
      organizationId,
      userId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      idempotencyKey: randomUUID(),
      createdAt: new Date(createdAt),
    });
  });

it.layer(getTestDB())("the Users read", (it) => {
  it.effect("counts every kept account's sign-in methods, whatever the search", () =>
    Effect.gen(function* () {
      const viewerId = yield* openAccount("root", ["github"], USER_ROLE.ADMIN);
      yield* openAccount("ada", ["github", "google"]);
      yield* openAccount("grace", ["google"]);
      yield* openAccount("linus", ["passkey"]);

      const read = (scope: AdminMetricsScope) =>
        readAdminUsersSource({
          now: NOW,
          scope,
          search: "ada",
          viewerId,
          windowDays: ADMIN_METRICS_WINDOW.MONTH,
        });

      const hidden = yield* read(ADMIN_METRICS_SCOPE.NON_ADMINS);
      assert.equal(hidden.total, 1);
      assert.deepEqual(hidden.signIn, {
        accounts: 3,
        methods: { github: 1, google: 2, other: 1 },
      });

      const everyone = yield* read(ADMIN_METRICS_SCOPE.ALL);
      assert.deepEqual(everyone.signIn, {
        accounts: 4,
        methods: { github: 2, google: 2, other: 1 },
      });
    }),
  );

  it.effect("ranks and counts accounts by meaningful actions, not hosted calls", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const viewerId = yield* openAccount("viewer", [], USER_ROLE.ADMIN);
      const builder = yield* openAccount("rank-builder", []);
      const lapsed = yield* openAccount("rank-lapsed", []);
      const dictating = yield* openAccount("rank-dictating", []);
      const workspace = yield* openWorkspace(builder);
      // Two days inside the 30-day window, and one action before it that the
      // window's count leaves out.
      yield* createTask(builder, workspace, "2026-10-20T09:00:00Z");
      yield* startAgent(builder, workspace, "2026-10-20T10:00:00Z");
      yield* startAgent(builder, workspace, "2026-10-21T08:00:00Z");
      yield* createTask(builder, workspace, "2026-08-01T09:00:00Z");
      // Quiet for the window, active months before it.
      yield* createTask(lapsed, workspace, "2026-05-04T09:00:00Z");
      // Hosted calls every day of the window, and nothing else.
      yield* db.insert(hostedUsage).values([
        { userId: dictating, day: "2026-10-20", calls: 40 },
        { userId: dictating, day: "2026-10-21", calls: 60 },
      ]);

      const list = yield* readAdminUsersSource({
        now: NOW,
        scope: ADMIN_METRICS_SCOPE.NON_ADMINS,
        search: "rank",
        viewerId,
        windowDays: ADMIN_METRICS_WINDOW.MONTH,
      });

      assert.deepEqual(
        list.rows.map((row) => [row.id, row.activeDays, row.lastActiveDay, row.lastSeenAt]),
        [
          [builder, 2, "2026-10-21", null],
          [lapsed, 0, "2026-05-04", null],
          [dictating, 0, null, null],
        ],
      );
    }),
  );

  it.effect("reads an account's activity from its meaningful actions, with no hosted usage", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const builder = yield* openAccount("page-builder", []);
      const neighbor = yield* openAccount("page-neighbor", []);
      const workspace = yield* openWorkspace(builder);
      // A task on the 18th, a quiet 19th, then a revision of that task and an
      // agent yesterday, and a task and an agent today.
      const planned = yield* createTask(builder, workspace, "2026-10-18T09:00:00Z");
      yield* revisePlan(planned, 1, PLAN_ACTOR.DEVELOPER, builder, "2026-10-20T09:00:00Z");
      yield* startAgent(builder, workspace, "2026-10-20T08:00:00Z");
      yield* createTask(builder, workspace, "2026-10-21T09:00:00Z");
      yield* startAgent(builder, workspace, "2026-10-21T10:00:00Z");
      // An agent's revision is the agent's, and a year and more ago is past the read.
      yield* revisePlan(planned, 2, PLAN_ACTOR.AGENT, builder, "2026-10-19T09:00:00Z");
      yield* createTask(builder, workspace, "2025-09-01T09:00:00Z");
      // A neighbor's task on the quiet day, and hosted calls of the neighbor's alone.
      yield* createTask(neighbor, workspace, "2026-10-19T09:00:00Z");
      yield* db.insert(hostedUsage).values({ userId: neighbor, day: "2026-10-19", calls: 40 });

      const windowDays = ADMIN_METRICS_WINDOW.MONTH;
      const [source, support] = yield* Effect.all([
        readAdminUserSource({ userId: builder, now: NOW, windowDays }),
        readAdminAccountSource({ userId: builder, now: NOW, windowDays }),
      ]);
      if (source === undefined) throw new Error("the account was not read");
      const { actions, activity } = buildAdminUserDetail(source, support, NOW, windowDays);

      assert.deepEqual(actions.daily.slice(-4), [
        { day: "2026-10-18", tasksCreated: 1, planRevisions: 0, agentsStarted: 0 },
        { day: "2026-10-19", tasksCreated: 0, planRevisions: 0, agentsStarted: 0 },
        { day: "2026-10-20", tasksCreated: 0, planRevisions: 1, agentsStarted: 1 },
        { day: "2026-10-21", tasksCreated: 1, planRevisions: 0, agentsStarted: 1 },
      ]);
      assert.equal(actions.activeDaysWindow, 3);
      assert.deepEqual(actions.activeDaysTrend, { days: 7, recent: 3, prior: 0 });
      assert.deepEqual(actions.actionsTrend, { days: 7, recent: 5, prior: 0 });
      assert.equal(actions.currentStreakDays, 2);
      assert.equal(actions.firstActiveDay, "2026-10-18");
      assert.equal(actions.lastActiveDay, "2026-10-21");
      assert.deepEqual(actions.calendarDaily.at(-1), { day: "2026-10-21", count: 2 });
      assert.equal(activity.activeDaysWindow, 0);
    }),
  );
});
