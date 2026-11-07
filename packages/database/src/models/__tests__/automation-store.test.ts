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
} from "@repo/features/automation-wire";
import { SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { eq } from "drizzle-orm";
import { DateTime, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  automationRunsSince,
  automationRunToAct,
  claimAutomationRun,
  createAutomation,
  deleteAutomation,
  githubAutomationsOn,
  integrationAutomationsOn,
  listAutomationRuns,
  listAutomations,
  type NewAutomation,
  ownFailedAutomationRuns,
  readAutomation,
  readWebhookAutomation,
  recordAutomationRun,
  scheduledAutomations,
  settleAutomationRun,
  subjectRunStartedSince,
  updateAutomation,
} from "../automation-store.js";

/**
 * An account's automations and their runs, over a real dialect: made only
 * on a task the account reaches, read and changed by that account alone
 * while it still reaches the task, one run per firing however often it is
 * recorded, and a run settled once.
 *
 * Synthetic accounts, workspaces, and tasks throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** A workspace the account owns, as the organization plugin would leave the rows. */
const openWorkspace = (userId: string) =>
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
    return organizationId;
  });

const nightly = (organizationId: string): NewAutomation => ({
  organizationId,
  repositories: ["acme/api"],
  name: "Nightly flaky-test sweep",
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "Europe/London" },
  action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Find and fix one flaky test." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: new Date("2026-10-15T01:00:00Z"),
  webhookSecretHash: null,
});

it.layer(getTestDB())("the automation store", (it) => {
  it.effect(
    "a webhook automation reads for a call while its owner is a member of its workspace, and its run keeps the body for its delivery alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        // Never due, so no other test's claim finds it.
        const existing = Option.getOrThrow(
          yield* createAutomation(owner, { ...nightly(workspaceId), nextRunAt: null }),
        );
        const workspace = existing.organizationId;
        const hooked = Option.getOrThrow(
          yield* createAutomation(owner, {
            ...nightly(workspaceId),
            organizationId: workspace,
            repositories: ["acme/api"],
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
            nextRunAt: null,
            webhookSecretHash: "ab".repeat(32),
          }),
        );

        const read = yield* readWebhookAutomation(hooked.id);
        const scheduled = yield* readWebhookAutomation(existing.id);
        const key = randomUUID();
        yield* recordAutomationRun(hooked, {
          dedupeKey: key,
          firing: { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 5 },
          payload: "hello",
          firedAt: new Date(),
        });
        const queued = yield* automationRunToAct(hooked.id, key);
        const db = yield* Database;
        yield* db.delete(member).where(eq(member.userId, owner));
        const departed = yield* readWebhookAutomation(hooked.id);

        assert.deepEqual(
          Option.map(read, (row) => row.webhookSecretHash),
          Option.some("ab".repeat(32)),
        );
        assert.ok(Option.isNone(scheduled), "an automation that is no webhook reads as none");
        assert.deepEqual(
          Option.map(queued, (run) => run.payload),
          Option.some("hello"),
        );
        assert.ok(Option.isNone(departed), "a departed owner's webhook reads as none");
      }),
  );

  it.effect(
    "an automation made on a workspace lists under that workspace, and is made by no account outside it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const outsider = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        const existing = Option.getOrThrow(yield* createAutomation(owner, nightly(workspaceId)));
        const workspace = existing.organizationId;
        const made = (by: string) =>
          createAutomation(by, {
            ...nightly(workspaceId),
            organizationId: workspace,
            repositories: ["acme/api", "acme/web"],
          });

        const taskless = Option.getOrThrow(yield* made(owner));
        const refused = yield* made(outsider);

        assert.deepEqual(
          [taskless.organizationId, taskless.repositories],
          [workspace, ["acme/api", "acme/web"]],
        );
        assert.ok(Option.isNone(refused), "an account outside the workspace makes nothing there");
        // Note that the two were made in one instant, so their order is their ids', and read as a set.
        assert.deepEqual(
          (yield* listAutomations(owner, { organizationId: workspace }))
            .map((each) => each.id)
            .toSorted(),
          [taskless.id, existing.id].toSorted(),
        );
        assert.deepEqual(yield* listAutomations(outsider, { organizationId: workspace }), []);
      }),
  );

  it.effect(
    "a new automation takes the workspace and repositories named, its owner's alone and a new agent each run where the maker names neither",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        const made = Option.getOrThrow(yield* createAutomation(owner, nightly(workspaceId)));

        assert.deepEqual(
          [
            made.organizationId,
            made.repositories,
            made.scope,
            made.targetKind,
            made.archiveSuccessful,
          ],
          [
            workspaceId,
            ["acme/api"],
            AUTOMATION_SCOPE.PERSONAL,
            AUTOMATION_TARGET.NEW_AGENT,
            false,
          ],
        );
      }),
  );

  it.effect(
    "an automation is made only on a workspace the account is a member of, and read, changed, and deleted by its own account alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);

        assert.deepEqual(
          yield* createAutomation(other, nightly(workspaceId)),
          Option.none(),
          "an account outside the workspace makes nothing on it",
        );
        const made = Option.getOrThrow(yield* createAutomation(owner, nightly(workspaceId)));
        assert.equal(made.enabled, true);
        assert.deepEqual(made.trigger, nightly(workspaceId).trigger);

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
          yield* createAutomation(owner, nightly(yield* openWorkspace(owner))),
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
    "an account that leaves the workspace no longer reads, changes, or deletes its automations there, nor their runs",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const made = Option.getOrThrow(
          yield* createAutomation(owner, nightly(yield* openWorkspace(owner))),
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
    "the scheduled automations are read from the first page, paused ones among them and no other trigger's, and a page after an id starts past it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        const scheduled = Option.getOrThrow(yield* createAutomation(owner, nightly(workspaceId)));
        const paused = Option.getOrThrow(
          yield* updateAutomation(
            owner,
            Option.getOrThrow(yield* createAutomation(owner, nightly(workspaceId))).id,
            { enabled: false },
          ),
        );
        const hooked = Option.getOrThrow(
          yield* createAutomation(owner, {
            ...nightly(workspaceId),
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
            nextRunAt: null,
            webhookSecretHash: "cd".repeat(32),
          }),
        );

        const read = (yield* scheduledAutomations(null, 1000)).map((row) => row.id);
        const after = (yield* scheduledAutomations(scheduled.id, 1000)).map((row) => row.id);

        assert.ok(read.includes(scheduled.id) && read.includes(paused.id));
        assert.ok(!read.includes(hooked.id), "a webhook automation keeps no schedule");
        assert.ok(!after.includes(scheduled.id), "a page after an id starts past it");
      }),
  );

  it.effect(
    "a repository's event finds the enabled GitHub automations listening for it, however its name is cased, and no other",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        const github = {
          kind: AUTOMATION_TRIGGER.GITHUB,
          event: "issue-opened",
          labels: ["bug"],
        } as const;
        const listening = Option.getOrThrow(
          yield* createAutomation(owner, {
            ...nightly(workspaceId),
            trigger: github,
            nextRunAt: null,
          }),
        );
        const paused = Option.getOrThrow(
          yield* createAutomation(owner, {
            ...nightly(workspaceId),
            trigger: github,
            nextRunAt: null,
          }),
        );
        yield* updateAutomation(owner, paused.id, { enabled: false });
        yield* createAutomation(owner, nightly(workspaceId));

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

  it.effect(
    "a Sentry delivery to one workspace finds that workspace's enabled automations on its event alone, never another's, and none of a departed creator",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const ours = yield* openWorkspace(owner);
        const theirs = yield* openWorkspace(other);
        const alert = {
          kind: AUTOMATION_TRIGGER.INTEGRATION,
          provider: TRIGGER_PROVIDER.SENTRY,
          event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
          filters: { environment: ["production"] },
        } as const;
        const onWorkspace = (organizationId: string): NewAutomation => ({
          ...nightly(""),
          organizationId,
          repositories: ["acme/api"],
          trigger: alert,
          nextRunAt: null,
        });
        const listening = Option.getOrThrow(yield* createAutomation(owner, onWorkspace(ours)));
        yield* createAutomation(owner, {
          ...onWorkspace(ours),
          trigger: { ...alert, event: SENTRY_TRIGGER_EVENT.ISSUE_CREATED },
        });
        const paused = Option.getOrThrow(yield* createAutomation(owner, onWorkspace(ours)));
        yield* updateAutomation(owner, paused.id, { enabled: false });
        const elsewhere = Option.getOrThrow(yield* createAutomation(other, onWorkspace(theirs)));

        const found = yield* integrationAutomationsOn(
          ours,
          TRIGGER_PROVIDER.SENTRY,
          SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
          10,
        );
        const foundThere = yield* integrationAutomationsOn(
          theirs,
          TRIGGER_PROVIDER.SENTRY,
          SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
          10,
        );
        const db = yield* Database;
        yield* db.delete(member).where(eq(member.userId, owner));
        const departed = yield* integrationAutomationsOn(
          ours,
          TRIGGER_PROVIDER.SENTRY,
          SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
          10,
        );

        assert.deepEqual(
          found.map((each) => [each.id, each.trigger]),
          [[listening.id, alert]],
        );
        assert.deepEqual(
          foundThere.map((each) => each.id),
          [elsewhere.id],
        );
        assert.deepEqual(departed, []);
      }),
  );

  it.effect(
    "a run started on a Sentry issue holds its cooldown for that issue alone from when it started, however late after it fired, and a skipped one holds nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        const made = Option.getOrThrow(
          yield* createAutomation(owner, {
            ...nightly(workspaceId),
            trigger: {
              kind: AUTOMATION_TRIGGER.INTEGRATION,
              provider: TRIGGER_PROVIDER.SENTRY,
              event: SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
            },
            nextRunAt: null,
          }),
        );
        const fireOn = (subjectId: string) =>
          Effect.map(
            recordAutomationRun(made, {
              dedupeKey: randomUUID(),
              firing: {
                kind: AUTOMATION_FIRING.INTEGRATION,
                provider: TRIGGER_PROVIDER.SENTRY,
                event: SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
                subject: { id: subjectId, title: "TypeError: x is undefined" },
              },
              firedAt: new Date("2026-10-15T12:00:00Z"),
            }),
            Option.getOrThrow,
          );
        yield* TestClock.setTime(Date.parse("2026-10-15T12:00:00Z"));
        const started = yield* fireOn("4001");
        // The sweep starts it three quarters of an hour after it fired; a claim is a start, its agent still to come.
        yield* TestClock.adjust(Duration.minutes(45));
        yield* claimAutomationRun(started.id);
        const skipped = yield* fireOn("4002");
        yield* settleAutomationRun(skipped.id, {
          status: AUTOMATION_RUN_STATUS.SKIPPED,
          reason: AUTOMATION_RUN_REASON.CONCURRENCY,
        });

        const within = yield* subjectRunStartedSince(
          made.id,
          "4001",
          new Date("2026-10-15T00:00:00Z"),
        );
        const startedAfterFiring = yield* subjectRunStartedSince(
          made.id,
          "4001",
          new Date("2026-10-15T12:30:00Z"),
        );
        const after = yield* subjectRunStartedSince(
          made.id,
          "4001",
          new Date("2026-10-15T12:45:01Z"),
        );
        const skippedIssue = yield* subjectRunStartedSince(
          made.id,
          "4002",
          new Date("2026-10-15T00:00:00Z"),
        );
        const otherIssue = yield* subjectRunStartedSince(
          made.id,
          "4003",
          new Date("2026-10-15T00:00:00Z"),
        );

        assert.equal(within, true);
        assert.equal(
          startedAfterFiring,
          true,
          "a run that fired earlier but started since holds it",
        );
        assert.equal(after, false, "a run started before the instant holds nothing");
        assert.equal(skippedIssue, false);
        assert.equal(otherIssue, false);
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
        const workspaceId = yield* openWorkspace(owner);
        const theirTask = yield* openWorkspace(other);
        const made = (userId: string, existing: string, name: string) =>
          Effect.map(
            createAutomation(userId, { ...nightly(existing), name, nextRunAt: null }),
            Option.getOrThrow,
          );
        const sweep = yield* made(owner, workspaceId, "Nightly flaky-test sweep");
        const digest = yield* made(owner, workspaceId, "Morning digest");
        const theirs = yield* made(other, theirTask, "Their sweep");
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

  it.effect(
    "an automation made under an id the caller names keeps it and reads back under it, and a make run again under that id writes nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        const id = randomUUID();

        const made = Option.getOrThrow(
          yield* createAutomation(owner, { ...nightly(workspaceId), id }),
        );

        // A make run again under the same id writes nothing, and the first stands.
        const again = yield* createAutomation(owner, {
          ...nightly(workspaceId),
          id,
          name: "Again",
        });

        assert.equal(made.id, id);
        assert.ok(Option.isNone(again));
        assert.deepEqual(
          Option.map(yield* readAutomation(owner, id), (read) => read.name),
          Option.some("Nightly flaky-test sweep"),
        );
      }),
  );
});
