import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { automation, automationRun } from "../../schemas/automation.js";
import { personalWorkspace } from "../../schemas/personal-workspace.js";
import { task } from "../../schemas/plan.js";
import { getTestDB } from "../../testing/index.js";
import {
  automationRunsSince,
  claimDueAutomations,
  createAutomation,
  deleteAutomation,
  githubAutomationsOn,
  listAutomationRuns,
  listAutomations,
  type NewAutomation,
  ownFailedAutomationRuns,
  queuedAutomationRuns,
  readAutomation,
  readWebhookAutomation,
  recordAutomationRun,
  settleAutomationRun,
  updateAutomation,
} from "../automation-store.js";
import { createTask, updateTask } from "../task-store.js";

/**
 * An account's automations and their runs, over a real dialect: made only
 * on a plan the account reaches, read and changed by that account alone
 * while it still reaches the plan, one run per firing however often it is
 * claimed, a run settled once, and a schedule claimed once when due, its
 * backlog moved on rather than run.
 *
 * Synthetic accounts, workspaces, and plans throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A plan in a workspace the account owns, as the organization plugin would leave the rows. */
const openTask = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const organizationId = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Test Workspace",
      slug: `workspace-${organizationId}`,
      createdAt: now,
    });
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId, userId, role: "owner", createdAt: now });
    const made = yield* createTask(userId, {
      organizationId,
      name: "Nightly triage",
      repository: "acme/api",
    });
    return made.id;
  });

const nightly = (taskId: string): NewAutomation => ({
  taskId,
  name: "Nightly flaky-test sweep",
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "Europe/London" },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Find and fix one flaky test." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: new Date("2026-10-15T01:00:00Z"),
  webhookSecretHash: null,
});

it.layer(getTestDB())("the automation store", (it) => {
  it.effect(
    "a webhook automation reads for a call while its owner is a member of its workspace, and its run keeps the body for the sweep alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const taskId = yield* openTask(owner);
        // Never due, so no other test's claim finds it.
        const onTask = Option.getOrThrow(
          yield* createAutomation(owner, { ...nightly(taskId), nextRunAt: null }),
        );
        const workspace = onTask.organizationId ?? "";
        const hooked = Option.getOrThrow(
          yield* createAutomation(owner, {
            ...nightly(taskId),
            taskId: null,
            organizationId: workspace,
            repositories: ["acme/api"],
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
            nextRunAt: null,
            webhookSecretHash: "ab".repeat(32),
          }),
        );

        const read = yield* readWebhookAutomation(hooked.id);
        const scheduled = yield* readWebhookAutomation(onTask.id);
        yield* recordAutomationRun(hooked, {
          dedupeKey: randomUUID(),
          firing: { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 5 },
          payload: "hello",
          firedAt: new Date(),
        });
        const queued = (yield* queuedAutomationRuns(new Date(0), 100)).filter(
          (run) => run.automationId === hooked.id,
        );
        const db = yield* Database;
        yield* db.delete(member).where(eq(member.userId, owner));
        const departed = yield* readWebhookAutomation(hooked.id);

        assert.deepEqual(
          Option.map(read, (row) => row.webhookSecretHash),
          Option.some("ab".repeat(32)),
        );
        assert.ok(Option.isNone(scheduled), "an automation that is no webhook reads as none");
        assert.deepEqual(
          queued.map((run) => run.payload),
          ["hello"],
        );
        assert.ok(Option.isNone(departed), "a departed owner's webhook reads as none");
      }),
  );

  it.effect(
    "an automation made on a workspace with no plan takes the workspace and repositories named, lists under that workspace, and is made by no account outside it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const outsider = yield* openAccount;
        const taskId = yield* openTask(owner);
        const onTask = Option.getOrThrow(yield* createAutomation(owner, nightly(taskId)));
        const workspace = onTask.organizationId ?? "";
        const made = (by: string) =>
          createAutomation(by, {
            ...nightly(taskId),
            taskId: null,
            organizationId: workspace,
            repositories: ["acme/api", "acme/web"],
          });

        const taskless = Option.getOrThrow(yield* made(owner));
        const refused = yield* made(outsider);

        assert.deepEqual(
          [taskless.taskId, taskless.taskName, taskless.organizationId, taskless.repositories],
          [null, null, workspace, ["acme/api", "acme/web"]],
        );
        assert.ok(Option.isNone(refused), "an account outside the workspace makes nothing there");
        // Note that the two were made in one instant, so their order is their ids', and read as a set.
        assert.deepEqual(
          (yield* listAutomations(owner, { organizationId: workspace }))
            .map((each) => each.id)
            .toSorted(),
          [taskless.id, onTask.id].toSorted(),
        );
        assert.deepEqual(yield* listAutomations(outsider, { organizationId: workspace }), []);
      }),
  );

  it.effect(
    "a new automation takes its plan's workspace and repository, its owner's alone and a new agent each run where the maker names neither",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const taskId = yield* openTask(owner);
        const made = Option.getOrThrow(yield* createAutomation(owner, nightly(taskId)));
        const [taskRow] = yield* Database.use((db) =>
          db.select({ organizationId: task.organizationId }).from(task).where(eq(task.id, taskId)),
        );

        assert.deepEqual(
          [
            made.organizationId,
            made.repositories,
            made.scope,
            made.targetKind,
            made.archiveSuccessful,
          ],
          [
            taskRow?.organizationId,
            ["acme/api"],
            AUTOMATION_SCOPE.PERSONAL,
            AUTOMATION_TARGET.NEW_AGENT,
            false,
          ],
        );
      }),
  );

  it.effect(
    "a plan given another repository or moved to another workspace takes its automations along",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const taskId = yield* openTask(owner);
        const made = Option.getOrThrow(yield* createAutomation(owner, nightly(taskId)));
        const elsewhere = randomUUID();
        const now = yield* DateTime.nowAsDate;
        yield* Database.use((db) =>
          db.insert(organization).values({
            id: elsewhere,
            name: "Elsewhere",
            slug: `elsewhere-${elsewhere}`,
            createdAt: now,
          }),
        );
        yield* Database.use((db) =>
          db.insert(member).values({
            id: randomUUID(),
            organizationId: elsewhere,
            userId: owner,
            role: "owner",
            createdAt: now,
          }),
        );

        yield* updateTask(owner, taskId, { repository: "acme/moved", organizationId: elsewhere });
        const followed = Option.getOrThrow(yield* readAutomation(owner, made.id));

        assert.deepEqual(
          [followed.organizationId, followed.repositories],
          [elsewhere, ["acme/moved"]],
          "the automation follows its plan",
        );
      }),
  );

  it.effect(
    "a workspace automation whose plan moves into a personal workspace becomes personal, as everything there is",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const taskId = yield* openTask(owner);
        const shared = Option.getOrThrow(
          yield* createAutomation(owner, { ...nightly(taskId), scope: AUTOMATION_SCOPE.WORKSPACE }),
        );
        const personal = randomUUID();
        const now = yield* DateTime.nowAsDate;
        yield* Database.use((db) =>
          db.insert(organization).values({
            id: personal,
            name: "Personal",
            slug: `personal-${personal}`,
            createdAt: now,
          }),
        );
        yield* Database.use((db) =>
          db.insert(member).values({
            id: randomUUID(),
            organizationId: personal,
            userId: owner,
            role: "owner",
            createdAt: now,
          }),
        );
        yield* Database.use((db) =>
          db
            .insert(personalWorkspace)
            .values({ userId: owner, organizationId: personal, createdAt: now }),
        );

        yield* updateTask(owner, taskId, { organizationId: personal });

        const moved = Option.getOrThrow(yield* readAutomation(owner, shared.id));
        assert.deepEqual(
          [moved.organizationId, moved.scope],
          [personal, AUTOMATION_SCOPE.PERSONAL],
        );
      }),
  );

  it.effect(
    "an automation is made only on a plan the account reaches, and read, changed, and deleted by its own account alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const taskId = yield* openTask(owner);

        assert.deepEqual(
          yield* createAutomation(other, nightly(taskId)),
          Option.none(),
          "an account outside the plan's workspace makes nothing on it",
        );
        const made = Option.getOrThrow(yield* createAutomation(owner, nightly(taskId)));
        assert.equal(made.enabled, true);
        assert.equal(made.taskName, "Nightly triage");
        assert.deepEqual(made.trigger, nightly(taskId).trigger);

        assert.deepEqual(
          (yield* listAutomations(owner)).map((each) => each.id),
          [made.id],
        );
        assert.deepEqual(yield* listAutomations(other), []);
        assert.deepEqual(yield* readAutomation(other, made.id), Option.none());
        assert.deepEqual(
          yield* updateAutomation(other, made.id, { enabled: false }),
          Option.none(),
        );
        assert.equal(yield* deleteAutomation(other, made.id), false);

        const paused = Option.getOrThrow(
          yield* updateAutomation(owner, made.id, {
            enabled: false,
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
          }),
        );
        assert.equal(paused.enabled, false);
        assert.equal(paused.nextRunAt, null, "a trigger that is no schedule keeps no due instant");
        assert.deepEqual(paused.trigger, { kind: AUTOMATION_TRIGGER.WEBHOOK });
        assert.equal(paused.name, made.name, "a field the change leaves out stands");

        assert.equal(yield* deleteAutomation(owner, made.id), true);
        assert.deepEqual(yield* readAutomation(owner, made.id), Option.none());
      }),
  );

  it.effect(
    "a firing records one run however often it is claimed, settles once, and is read by its own account alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const made = Option.getOrThrow(
          yield* createAutomation(owner, nightly(yield* openTask(owner))),
        );
        const firing = {
          dedupeKey: "2026-10-15T01:00:00.000Z",
          firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: Date.parse("2026-10-15T01:00:00Z") },
          firedAt: new Date("2026-10-15T01:00:20Z"),
        };

        const first = Option.getOrThrow(yield* recordAutomationRun(made, firing));
        const again = yield* recordAutomationRun(made, { ...firing, firedAt: new Date() });
        assert.equal(first.status, AUTOMATION_RUN_STATUS.QUEUED);
        assert.deepEqual(again, Option.none(), "the same firing claimed again records nothing");

        const skipped = yield* settleAutomationRun(first.id, {
          status: AUTOMATION_RUN_STATUS.SKIPPED,
          reason: AUTOMATION_RUN_REASON.CONCURRENCY,
        });
        const failedAfter = yield* settleAutomationRun(first.id, {
          status: AUTOMATION_RUN_STATUS.FAILED,
          reason: AUTOMATION_RUN_REASON.UNAVAILABLE,
        });
        assert.equal(skipped, true);
        assert.equal(failedAfter, false, "a run settles once");

        const history = yield* listAutomationRuns(owner, made.id);
        assert.deepEqual(
          history.map((run) => [run.status, run.reason]),
          [[AUTOMATION_RUN_STATUS.SKIPPED, AUTOMATION_RUN_REASON.CONCURRENCY]],
        );
        assert.deepEqual(yield* listAutomationRuns(other, made.id), []);
        assert.equal(
          (yield* automationRunsSince(made.id, new Date("2026-10-15T00:00:00Z"))).length,
          1,
        );
        assert.equal(
          (yield* automationRunsSince(made.id, new Date("2026-10-15T02:00:00Z"))).length,
          0,
          "a run fired before the instant is not counted",
        );
      }),
  );

  it.effect(
    "an account that leaves the plan's workspace no longer reads, changes, or deletes its automations there, nor their runs",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const made = Option.getOrThrow(
          yield* createAutomation(owner, nightly(yield* openTask(owner))),
        );
        yield* recordAutomationRun(made, {
          dedupeKey: "manual-1",
          firing: { kind: AUTOMATION_FIRING.MANUAL },
          firedAt: new Date(),
        });
        yield* Database.use((db) => db.delete(member).where(eq(member.userId, owner)));

        assert.deepEqual(yield* listAutomations(owner), []);
        assert.deepEqual(yield* readAutomation(owner, made.id), Option.none());
        assert.deepEqual(
          yield* updateAutomation(owner, made.id, { enabled: false }),
          Option.none(),
        );
        assert.equal(yield* deleteAutomation(owner, made.id), false);
        assert.deepEqual(yield* listAutomationRuns(owner, made.id), []);
      }),
  );

  it.effect(
    "the schedules due are claimed once, each moved on to its next instant, one missed by more than the grace is moved on without a run, a webhook's is not claimed, and a leaver's is claimed to fail as its run starts",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const taskId = yield* openTask(owner);
        const now = new Date("2026-10-15T09:05:00Z");
        const next = new Date("2026-10-16T09:00:00Z");
        const make = (nextRunAt: Date) =>
          Effect.map(createAutomation(owner, { ...nightly(taskId), nextRunAt }), Option.getOrThrow);
        const due = yield* make(new Date("2026-10-15T09:00:00Z"));
        const stale = yield* make(new Date("2026-10-15T06:00:00Z"));
        const later = yield* make(new Date("2026-10-15T10:00:00Z"));
        const paused = yield* make(new Date("2026-10-15T09:00:00Z"));
        yield* updateAutomation(owner, paused.id, { enabled: false });
        const hooked = yield* make(new Date("2026-10-15T09:00:00Z"));
        yield* updateAutomation(owner, hooked.id, {
          trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
        });
        yield* Database.use((db) =>
          db
            .update(automation)
            .set({ nextRunAt: new Date("2026-10-15T09:00:00Z") })
            .where(eq(automation.id, hooked.id)),
        );
        const leaver = yield* openAccount;
        const left = Option.getOrThrow(
          yield* createAutomation(leaver, {
            ...nightly(yield* openTask(leaver)),
            nextRunAt: new Date("2026-10-15T09:00:00Z"),
          }),
        );
        yield* Database.use((db) => db.delete(member).where(eq(member.userId, leaver)));
        const claim = {
          now,
          limit: 10,
          graceMs: 60 * 60_000,
          nextAfter: () => next,
        };

        const first = yield* claimDueAutomations(claim);
        const second = yield* claimDueAutomations(claim);

        assert.deepEqual(
          first
            .filter((each) => each.automation.userId === owner)
            .map((each) => [each.automation.id, each.run.firing]),
          [[due.id, { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: due.nextRunAt?.getTime() }]],
        );
        assert.deepEqual(second, [], "a claim after finds nothing left due");
        const nextOf = (id: string) =>
          Effect.map(readAutomation(owner, id), (read) => Option.getOrThrow(read).nextRunAt);
        assert.deepEqual(yield* nextOf(due.id), next);
        assert.deepEqual(yield* nextOf(stale.id), next, "the stale one is moved on");
        assert.deepEqual(yield* listAutomationRuns(owner, stale.id), [], "and runs nothing");
        assert.deepEqual(yield* nextOf(later.id), later.nextRunAt);
        assert.deepEqual(yield* nextOf(paused.id), paused.nextRunAt);
        const [webhookRuns, leaverRuns] = yield* Effect.all([
          listAutomationRuns(owner, hooked.id),
          Database.use((db) =>
            db
              .select({ id: automationRun.id })
              .from(automationRun)
              .where(eq(automationRun.automationId, left.id)),
          ),
        ]);
        assert.deepEqual(webhookRuns, [], "a due instant left on a webhook fires nothing");
        assert.equal(
          leaverRuns.length,
          1,
          "a schedule whose owner left still fires, so its run fails and says why",
        );

        // A second claim that read the row at its old instant records no second run.
        yield* updateAutomation(owner, due.id, { nextRunAt: due.nextRunAt });
        assert.deepEqual(yield* claimDueAutomations(claim), []);
        assert.equal((yield* listAutomationRuns(owner, due.id)).length, 1);
      }),
  );

  it.effect(
    "a repository's event finds the enabled GitHub automations listening for it on its plans, however its name is cased, and no other",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const taskId = yield* openTask(owner);
        const github = {
          kind: AUTOMATION_TRIGGER.GITHUB,
          event: "issue-opened",
          labels: ["bug"],
        } as const;
        const listening = Option.getOrThrow(
          yield* createAutomation(owner, { ...nightly(taskId), trigger: github, nextRunAt: null }),
        );
        const paused = Option.getOrThrow(
          yield* createAutomation(owner, { ...nightly(taskId), trigger: github, nextRunAt: null }),
        );
        yield* updateAutomation(owner, paused.id, { enabled: false });
        yield* createAutomation(owner, nightly(taskId));

        const found = yield* githubAutomationsOn("ACME/api", "issue-opened", 10);
        assert.deepEqual(
          found.filter((each) => each.userId === owner).map((each) => [each.id, each.trigger]),
          [[listening.id, github]],
        );
        assert.deepEqual(
          (yield* githubAutomationsOn("acme/other", "issue-opened", 10)).filter(
            (each) => each.userId === owner,
          ),
          [],
        );
        assert.deepEqual(
          (yield* githubAutomationsOn("acme/api", "push", 10)).filter(
            (each) => each.userId === owner,
          ),
          [],
          "nor an automation listening for another event",
        );
      }),
  );
});

it.layer(getTestDB())("the automation store's failed runs", (it) => {
  it.effect(
    "the newest run of each of the account's own automations that failed to start since the instant asked is read, the latest first, a skipped one passed over, and none of another account's",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const planId = yield* openTask(owner);
        const theirPlan = yield* openTask(other);
        const made = (userId: string, onTask: string, name: string) =>
          Effect.map(
            createAutomation(userId, { ...nightly(onTask), name, nextRunAt: null }),
            Option.getOrThrow,
          );
        const sweep = yield* made(owner, planId, "Nightly flaky-test sweep");
        const digest = yield* made(owner, planId, "Morning digest");
        const theirs = yield* made(other, theirPlan, "Their sweep");
        /** A run of the automation, settled as it came out, a second after the one before. */
        const ran = (
          automation: typeof sweep,
          outcome:
            | {
                readonly status: typeof AUTOMATION_RUN_STATUS.FAILED;
                readonly reason: (typeof AUTOMATION_RUN_REASON)[keyof typeof AUTOMATION_RUN_REASON];
              }
            | {
                readonly status: typeof AUTOMATION_RUN_STATUS.SKIPPED;
                readonly reason: typeof AUTOMATION_RUN_REASON.CONCURRENCY;
              },
        ) =>
          Effect.gen(function* () {
            yield* TestClock.adjust("1 second");
            const run = Option.getOrThrow(
              yield* recordAutomationRun(automation, {
                dedupeKey: randomUUID(),
                firing: { kind: AUTOMATION_FIRING.MANUAL },
                firedAt: yield* DateTime.nowAsDate,
              }),
            );
            yield* settleAutomationRun(run.id, outcome);
            return run.id;
          });
        const failed = (
          reason: (typeof AUTOMATION_RUN_REASON)[keyof typeof AUTOMATION_RUN_REASON],
        ) => ({ status: AUTOMATION_RUN_STATUS.FAILED, reason }) as const;

        yield* ran(sweep, failed(AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE));
        const newest = yield* ran(sweep, failed(AUTOMATION_RUN_REASON.MODEL));
        yield* ran(sweep, {
          status: AUTOMATION_RUN_STATUS.SKIPPED,
          reason: AUTOMATION_RUN_REASON.CONCURRENCY,
        });
        const digested = yield* ran(digest, failed(AUTOMATION_RUN_REASON.UNAVAILABLE));
        const theirRun = yield* ran(theirs, failed(AUTOMATION_RUN_REASON.CREATOR_LEFT));
        const read = (userId: string, sinceSeconds: number) =>
          Effect.map(ownFailedAutomationRuns(userId, new Date(sinceSeconds * 1000)), (runs) =>
            runs.map((run) => [run.id, run.automationName, run.reason]),
          );

        assert.deepEqual(yield* read(owner, 0), [
          [digested, "Morning digest", AUTOMATION_RUN_REASON.UNAVAILABLE],
          [newest, "Nightly flaky-test sweep", AUTOMATION_RUN_REASON.MODEL],
        ]);
        assert.deepEqual(yield* read(owner, 3), [
          [digested, "Morning digest", AUTOMATION_RUN_REASON.UNAVAILABLE],
        ]);
        assert.deepEqual(yield* read(other, 0), [
          [theirRun, "Their sweep", AUTOMATION_RUN_REASON.CREATOR_LEFT],
        ]);
      }),
  );
});
