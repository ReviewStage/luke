import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEFAULT_PLAN_TEMPLATE } from "@sidecar/hosted/plan-document-template";
import { NOTE_KIND, PLAN_FIELD_HEADING, planDocumentOf } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, PLAN_BOUNDS, PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import { eq } from "drizzle-orm";
import { Duration, Effect, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { plan } from "../server/db/plan-schema";
import { db } from "../server/db/query";
import { writePlanTemplate } from "../server/hosted/account-store";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { backfillPlanDocuments, handlePlanBackfill } from "../server/hosted/plan-backfill";
import { saveDeveloperEdit, saveNotes } from "../server/hosted/plan-notes";
import { listRevisions, PLAN_REVISION, readRevision } from "../server/hosted/plan-revisions";
import { createPlan, listPlans, readPlan } from "../server/hosted/plan-store";
import { BULK_IMPORT } from "./support/plan-contents";
import { createFieldsPlan } from "./support/plan-documents";
import { testSqlClient } from "./support/sql-client";

/**
 * The switch to plans as one document: a new plan is a copy of its account's
 * template, and the backfill carries every plan still kept as the fixed
 * template's fields over to one document, its history with it, through the
 * store's own functions over a real dialect. Synthetic accounts and plans
 * throughout.
 */

const RELAY = { name: "Teammate invitations" } as const;

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The plan as the window opens it, failing the test where it does not read. */
const opened = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), (stored) => Option.getOrThrow(stored).plan);

it.layer(testSqlClient)("the switch to plans as one document", (it) => {
  it.effect(
    "a new plan is one document, a copy of the default template while the account keeps none",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;

        const started = yield* createPlan(userId, RELAY);

        assert.deepEqual(started.document, { body: DEFAULT_PLAN_TEMPLATE, assumptions: [] });
        assert.equal(started.fields, undefined);
        assert.equal(started.lastEdit, undefined);
        assert.deepEqual(yield* opened(userId, started.id), started);
      }),
  );

  it.effect(
    "a new plan copies the account's own template, and an edit of the template leaves every plan started from it as it stands",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const other = yield* openUser;
        const template = "## Why\n\n## What\n\n## Risks\n";
        yield* writePlanTemplate(userId, template);

        const started = yield* createPlan(userId, RELAY);
        yield* writePlanTemplate(userId, "## Something else\n");
        const othersPlan = yield* createPlan(other, RELAY);

        assert.equal((yield* opened(userId, started.id)).document.body, template);
        assert.equal(othersPlan.document.body, DEFAULT_PLAN_TEMPLATE);
      }),
  );

  it.effect(
    "the backfill carries a plan of fields over to its text, who wrote each field to its section, its revisions to text, and moves no save",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const started = yield* createFieldsPlan(userId, RELAY);
        yield* saveDeveloperEdit(
          { userId, planId: started.id },
          { field: PLAN_FIELD.APPROACH, base: null, value: "Invites are memberships." },
        );
        yield* TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1));
        yield* saveNotes({ userId, planId: started.id }, [
          { kind: NOTE_KIND.ADD, field: PLAN_FIELD.GOAL, text: "- Members invite by email." },
        ]);
        const before = yield* opened(userId, started.id);
        const fields = before.fields ?? assert.fail("a plan of fields answers its fields");
        const listedBefore = yield* listPlans(userId);

        const pass = yield* backfillPlanDocuments();
        const again = yield* backfillPlanDocuments();
        const after = yield* opened(userId, started.id);
        const firstRevision = Option.getOrThrow(yield* readRevision(userId, started.id, 1));

        assert.deepEqual(pass, { plans: 1, revisions: 2, overBound: 0 });
        assert.deepEqual(again, { plans: 0, revisions: 0, overBound: 0 });
        assert.deepEqual(after.document, {
          body: planDocumentOf({ fields, assumptions: before.document.assumptions }),
          assumptions: [],
        });
        assert.equal(after.fields, undefined);
        assert.deepEqual(
          after.sectionEdits?.map(({ section, actor }) => [section, actor]),
          [
            [PLAN_FIELD_HEADING.approach, PLAN_ACTOR.DEVELOPER],
            [PLAN_FIELD_HEADING.goal, PLAN_ACTOR.NOTETAKER],
          ],
        );
        assert.deepEqual(after.lastEdit, before.lastEdit);
        assert.deepEqual(yield* listPlans(userId), listedBefore);
        assert.equal((yield* listRevisions(userId, started.id)).revisions.length, 2);
        assert.ok(firstRevision.document.body.startsWith("## Context\n\n## Goal\n\n## Approach"));
        assert.ok(firstRevision.document.body.includes("Invites are memberships."));
        assert.deepEqual(firstRevision.document.assumptions, []);
      }),
  );

  it.effect("a plan whose text would pass the bound is left as fields, and counted", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const started = yield* createFieldsPlan(userId, RELAY);
      const long = "a".repeat(PLAN_BOUNDS.MAX_BODY_CHARS);
      yield* db
        .update(plan)
        .set({ fields: { ...BULK_IMPORT.fields, approach: long } })
        .where(eq(plan.id, started.id));

      const pass = yield* backfillPlanDocuments();

      const stillFields = (yield* opened(userId, started.id)).fields;
      // The plan goes, so no other test's pass counts it.
      yield* db.delete(plan).where(eq(plan.id, started.id));

      assert.deepEqual(pass, { plans: 0, revisions: 0, overBound: 1 });
      assert.notEqual(stillFields, undefined);
    }),
  );

  it.effect(
    "the backfill is asked by POST under the deployment's own secret, refused otherwise, and unavailable without one",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        yield* createFieldsPlan(userId, RELAY);
        const secret = Redacted.make("cron-secret-for-this-test");
        const ask = (
          init: { method?: string; bearer?: string },
          cronSecret = Option.some(secret),
        ) =>
          Effect.gen(function* () {
            const response = yield* handlePlanBackfill({
              request: new Request("https://luke.test/api/maintenance/plan-documents", {
                method: init.method ?? "POST",
                headers:
                  init.bearer === undefined ? {} : { authorization: `Bearer ${init.bearer}` },
              }),
              cronSecret: Option.getOrUndefined(cronSecret),
            });
            return { status: response.status, body: yield* Effect.promise(() => response.json()) };
          });

        const wrongMethod = yield* ask({ method: "GET", bearer: "cron-secret-for-this-test" });
        const wrongBearer = yield* ask({ bearer: "not-the-secret" });
        const noSecret = yield* ask({ bearer: "cron-secret-for-this-test" }, Option.none());
        const carried = yield* ask({ bearer: "cron-secret-for-this-test" });

        assert.deepEqual(wrongMethod, {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
        });
        assert.deepEqual(wrongBearer, {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        });
        assert.deepEqual(noSecret, {
          status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          body: { error: HOSTED_API_ERROR.UNAVAILABLE },
        });
        assert.equal(carried.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(carried.body.plans >= 1, true);
      }),
  );
});
