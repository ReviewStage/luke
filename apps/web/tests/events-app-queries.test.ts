import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { testSqlClient } from "./support/sql-client";

/**
 * The one query `events-app.ts` owns directly, over the ambient `SqlClient`:
 * the events endpoint's PostHog person read.
 *
 * `server/events-app.ts` imports `../auth.js`, which builds Better Auth's
 * instance at module load, so `DATABASE_URL` has to stand before that import
 * runs, as in `events-maintenance-app.test.ts`.
 *
 * Synthetic fixtures throughout: no real user anywhere.
 */

process.env.DATABASE_URL ??= "postgresql://runtime:edge@127.0.0.1:5432/luke";

const { readPerson } = await import("../server/events-app");

const openUser = (name: string) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name, email: `${userId}@luke.test` });
    return userId;
  });

it.layer(testSqlClient)("events-app's own query over effect/unstable/sql", (it) => {
  it.effect("reads the signed-in user's own name and email", () =>
    Effect.gen(function* () {
      const userId = yield* openUser("Ada Lovelace");
      const person = yield* readPerson(userId);
      assert.deepEqual(person, { name: "Ada Lovelace", email: `${userId}@luke.test` });
    }),
  );

  it.effect("answers undefined for a user the table holds no row for", () =>
    Effect.gen(function* () {
      const person = yield* readPerson(`user-${randomUUID()}`);
      assert.equal(person, undefined);
    }),
  );
});
