import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { macCommand } from "@luke/database/schemas/mac-command";
import { getTestDB } from "@luke/database/testing";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { migrateDeploymentDatabase } from "./preview-database.js";

/**
 * A deployment build's database step over a real dialect: every build
 * migrates, and only a Preview's build, as `VERCEL_ENV` names it, switches off
 * the work its copy of production holds. A command queued for a Mac stands
 * for that work here; what the switch-off does to each kind is
 * `preview-copy.test.ts`'s.
 *
 * Synthetic accounts throughout.
 */

/** A command queued for a new account's Mac, as production would hold one; answers its id. */
const queueMacCommand = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  const id = randomUUID();
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  yield* db
    .insert(macCommand)
    .values({ id, userId, command: "git status", timeoutSeconds: 60, queuedAt: new Date() });
  return id;
});

/** Whether the queued command still stands. */
const stands = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({ id: macCommand.id })
      .from(macCommand)
      .where(eq(macCommand.id, id));
    return rows.length > 0;
  });

it.layer(getTestDB())("a deployment build's database step", (it) => {
  it.effect("leaves the work in flight as it stands on any build but a Preview's", () =>
    Effect.gen(function* () {
      const queued = yield* queueMacCommand;
      for (const environment of ["production", "development", undefined, " "]) {
        yield* migrateDeploymentDatabase({ VERCEL_ENV: environment });
        assert.ok(yield* stands(queued), `a build with VERCEL_ENV=${String(environment)}`);
      }
    }),
  );

  it.effect("switches off the work in flight on a Preview's build", () =>
    Effect.gen(function* () {
      const queued = yield* queueMacCommand;
      yield* migrateDeploymentDatabase({ VERCEL_ENV: "preview" });
      assert.equal(yield* stands(queued), false);
    }),
  );
});
