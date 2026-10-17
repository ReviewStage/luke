import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writePlanTemplate } from "@luke/database/models/account-store";
import { readTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { DEFAULT_PLAN_TEMPLATE } from "@luke/features/plan-document-template";
import { Effect, Option } from "effect";

/**
 * A task as one document: a new task is a copy of its account's template,
 * through the store's own functions over a real dialect. Synthetic accounts
 * and tasks throughout.
 */

const RELAY = { name: "Teammate invitations" } as const;

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The task as the window opens it, failing the test where it does not read. */
const opened = (userId: string, taskId: string) =>
  Effect.map(readTask(userId, taskId), (stored) => Option.getOrThrow(stored).task);

it.layer(getTestDB())("a new plan as one document", (it) => {
  it.effect(
    "a new plan copies the account's own template, and an edit of the template leaves every plan started from it as it stands",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const other = yield* openUser;
        const template = "## Why\n\n## What\n\n## Risks\n";
        yield* writePlanTemplate(userId, template);

        const started = yield* startTask(userId, RELAY);
        yield* writePlanTemplate(userId, "## Something else\n");
        const othersTask = yield* startTask(other, RELAY);

        assert.equal((yield* opened(userId, started.id)).document.body, template);
        assert.equal(othersTask.document.body, DEFAULT_PLAN_TEMPLATE);
      }),
  );
});
