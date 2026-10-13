import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { writePlanTemplate } from "@sidecar/database/models/account-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { DEFAULT_PLAN_TEMPLATE } from "@sidecar/hosted/plan-document-template";
import { Effect, Option } from "effect";
import { createPlan, readPlan } from "../server/hosted/plan-store";

/**
 * A plan as one document: a new plan is a copy of its account's template,
 * through the store's own functions over a real dialect. Synthetic accounts
 * and plans throughout.
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

it.layer(getTestDB())("a new plan as one document", (it) => {
  it.effect(
    "a new plan is one document, a copy of the default template while the account keeps none",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;

        const started = yield* createPlan(userId, RELAY);

        assert.deepEqual(started.document, { body: DEFAULT_PLAN_TEMPLATE, assumptions: [] });
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
});
