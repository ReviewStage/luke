import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { CLOUD_AGENT_PROVIDER_ID } from "../server/core";
import { testSqlClient } from "./support/sql-client";

/**
 * The two queries `observation-app.ts` still owns directly, over the ambient
 * `SqlClient`: the events endpoint's PostHog person read, and the tick's
 * eligible-account listing across `provider_key`, `devices`, and
 * `observation_pass`. Every other query the group's handlers touched already
 * reads through a converted module (`vault-key-store.ts`,
 * `roster-snapshot.ts`) and is covered by that module's own tests.
 *
 * `server/observation-app.ts` imports `../auth.js`, which builds Better
 * Auth's instance at module load, so `DATABASE_URL` has to stand before that
 * import runs, as in `observation-app.test.ts`.
 *
 * Synthetic fixtures throughout: no real user, provider, or device anywhere.
 */

process.env.DATABASE_URL ??= "postgresql://runtime:edge@127.0.0.1:5432/luke";

const { listEligibleAccounts, readPerson } = await import("../server/observation-app");

const PROVIDER_ID = CLOUD_AGENT_PROVIDER_ID.CONDUCTOR;
const NOW = new Date("2026-09-09T12:00:00.000Z");

const openUser = (name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const userId = `user-${randomUUID()}`;
    yield* sql`
      insert into "user" (id, name, email)
      values (${userId}, ${name}, ${`${userId}@luke.test`})
    `;
    return userId;
  });

const insertProviderKey = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      insert into provider_key (user_id, provider_id, ciphertext)
      values (${userId}, ${PROVIDER_ID}, ${"ciphertext"})
    `;
  });

const insertDevice = (userId: string, lastSeenAt: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      insert into devices (id, user_id, installation_id, platform, last_seen_at)
      values (${`device-${randomUUID()}`}, ${userId}, ${`install-${randomUUID()}`}, ${"mac"}, ${lastSeenAt})
    `;
  });

const insertObservationPass = (userId: string, attemptedAt: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      insert into observation_pass (user_id, attempted_at)
      values (${userId}, ${attemptedAt.getTime()})
    `;
  });

it.layer(testSqlClient)("observation-app's own queries over @effect/sql", (it) => {
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

  it.effect("lists an account with a cloud key seen since the bound", () =>
    Effect.gen(function* () {
      const userId = yield* openUser("Grace Hopper");
      yield* insertProviderKey(userId);
      yield* insertDevice(userId, NOW);

      const accounts = yield* listEligibleAccounts(10, NOW.getTime() - 1000);
      assert.deepEqual(
        accounts.filter((account) => account.userId === userId),
        [{ userId }],
      );
    }),
  );

  it.effect("excludes an account with no cloud key", () =>
    Effect.gen(function* () {
      const userId = yield* openUser("No Key");
      yield* insertDevice(userId, NOW);

      const accounts = yield* listEligibleAccounts(10, NOW.getTime() - 1000);
      assert.deepEqual(
        accounts.filter((account) => account.userId === userId),
        [],
      );
    }),
  );

  it.effect("excludes an account not seen since the bound", () =>
    Effect.gen(function* () {
      const userId = yield* openUser("Seen Long Ago");
      yield* insertProviderKey(userId);
      yield* insertDevice(userId, new Date(NOW.getTime() - 10_000));

      const accounts = yield* listEligibleAccounts(10, NOW.getTime() - 1000);
      assert.deepEqual(
        accounts.filter((account) => account.userId === userId),
        [],
      );
    }),
  );

  it.effect("orders the least recently attempted first, never attempted first of all", () =>
    Effect.gen(function* () {
      const attempted = yield* openUser("Attempted Before");
      yield* insertProviderKey(attempted);
      yield* insertDevice(attempted, NOW);
      yield* insertObservationPass(attempted, NOW);

      const neverAttempted = yield* openUser("Never Attempted");
      yield* insertProviderKey(neverAttempted);
      yield* insertDevice(neverAttempted, NOW);

      const accounts = yield* listEligibleAccounts(10, NOW.getTime() - 1000);
      const order = accounts.map((account) => account.userId);
      assert.ok(order.indexOf(neverAttempted) < order.indexOf(attempted));
    }),
  );

  it.effect("bounds the listing to the requested limit", () =>
    Effect.gen(function* () {
      const first = yield* openUser("First");
      yield* insertProviderKey(first);
      yield* insertDevice(first, NOW);
      const second = yield* openUser("Second");
      yield* insertProviderKey(second);
      yield* insertDevice(second, NOW);

      const accounts = yield* listEligibleAccounts(1, NOW.getTime() - 1000);
      assert.equal(accounts.length, 1);
    }),
  );
});
