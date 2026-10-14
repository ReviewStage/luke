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
} from "@sidecar/hosted/automation-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { automation, automationRun } from "../../schemas/automation.js";
import { plan } from "../../schemas/plan.js";
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
  readAutomation,
  recordAutomationRun,
  settleAutomationRun,
  updateAutomation,
} from "../automation-store.js";
import { createPlan } from "../plan-store.js";

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
const openPlan = (userId: string) =>
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
    const made = yield* createPlan(userId, {
      organizationId,
      name: "Nightly triage",
      repository: "acme/api",
    });
    return made.id;
  });

const nightly = (planId: string): NewAutomation => ({
  planId,
  name: "Nightly flaky-test sweep",
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "Europe/London" },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Find and fix one flaky test." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: new Date("2026-10-15T01:00:00Z"),
  webhookSecretHash: null,
});

it.layer(getTestDB())("the automation store", (it) => {
  it.effect(
    "a new automation takes its plan's workspace and repository, its owner's alone and a new agent each run where the maker names neither",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const planId = yield* openPlan(owner);
        const made = Option.getOrThrow(yield* createAutomation(owner, nightly(planId)));
        const [planRow] = yield* Database.use((db) =>
          db.select({ organizationId: plan.organizationId }).from(plan).where(eq(plan.id, planId)),
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
            planRow?.organizationId,
            ["acme/api"],
            AUTOMATION_SCOPE.PERSONAL,
            AUTOMATION_TARGET.NEW_AGENT,
            false,
          ],
        );
      }),
  );

  it.effect(
    "an automation is made only on a plan the account reaches, and read, changed, and deleted by its own account alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const planId = yield* openPlan(owner);

        assert.deepEqual(
          yield* createAutomation(other, nightly(planId)),
          Option.none(),
          "an account outside the plan's workspace makes nothing on it",
        );
        const made = Option.getOrThrow(yield* createAutomation(owner, nightly(planId)));
        assert.equal(made.enabled, true);
        assert.equal(made.planName, "Nightly triage");
        assert.deepEqual(made.trigger, nightly(planId).trigger);

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
          yield* createAutomation(owner, nightly(yield* openPlan(owner))),
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
          yield* createAutomation(owner, nightly(yield* openPlan(owner))),
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
    "the schedules due are claimed once, each moved on to its next instant, one missed by more than the grace is moved on without a run, and neither a webhook nor a leaver's schedule is claimed",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const planId = yield* openPlan(owner);
        const now = new Date("2026-10-15T09:05:00Z");
        const next = new Date("2026-10-16T09:00:00Z");
        const make = (nextRunAt: Date) =>
          Effect.map(createAutomation(owner, { ...nightly(planId), nextRunAt }), Option.getOrThrow);
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
            ...nightly(yield* openPlan(leaver)),
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
          first.map((each) => [each.automation.id, each.run.firing]),
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
        assert.deepEqual(
          leaverRuns,
          [],
          "nor does a schedule whose owner left the plan's workspace",
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
        const planId = yield* openPlan(owner);
        const github = {
          kind: AUTOMATION_TRIGGER.GITHUB,
          event: "issue-opened",
          labels: ["bug"],
        } as const;
        const listening = Option.getOrThrow(
          yield* createAutomation(owner, { ...nightly(planId), trigger: github, nextRunAt: null }),
        );
        const paused = Option.getOrThrow(
          yield* createAutomation(owner, { ...nightly(planId), trigger: github, nextRunAt: null }),
        );
        yield* updateAutomation(owner, paused.id, { enabled: false });
        yield* createAutomation(owner, nightly(planId));

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
