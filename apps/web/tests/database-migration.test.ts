import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import type { Client } from "pg";
import { withMigrationLock } from "../server/db/migrate.js";

type MigrationConnection = Pick<Client, "connect" | "query" | "end">;

function migrationConnection(events: string[]): MigrationConnection {
  // SAFETY: Test double implements only the connect/query/end surface withMigrationLock uses.
  return {
    async connect() {
      events.push("connect");
      // SAFETY: withMigrationLock awaits connect but never reads the return value.
      return {} as Client;
    },
    async query(query: string) {
      events.push(query.includes("unlock") ? "unlock" : "lock");
      return {};
    },
    async end() {
      events.push("end");
    },
  } as MigrationConnection;
}

it.effect("database migrations hold one session advisory lock", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    yield* withMigrationLock(
      migrationConnection(events),
      Effect.sync(() => events.push("migrate")),
    );

    assert.deepEqual(events, ["connect", "lock", "migrate", "unlock", "end"]);
  }),
);

it.effect("a failed migration still releases its lock and connection", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const exit = yield* Effect.exit(
      withMigrationLock(
        migrationConnection(events),
        Effect.suspend(() => {
          events.push("migrate");
          return Effect.fail("migration failed");
        }),
      ),
    );

    // The traced span annotates the failure with its stack, so the failure value is what is compared.
    assert.equal(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined, "migration failed");
    assert.deepEqual(events, ["connect", "lock", "migrate", "unlock", "end"]);
  }),
);

it.effect("an unlock failure still closes the database connection", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const connection = migrationConnection(events);
    const query = connection.query.bind(connection);
    // SAFETY: Overrides the test double's query while preserving withMigrationLock's call shape.
    connection.query = (async (text: string, values?: unknown[]) => {
      const result = await query(text, values);
      if (text.includes("unlock")) throw new Error("unlock failed");
      return result;
    }) as MigrationConnection["query"];

    const exit = yield* Effect.exit(withMigrationLock(connection, Effect.void));

    // The unlock is tolerated: the lock is the session's and goes with the
    // connection, so the migration still succeeds and the connection still closes.
    assert.equal(Exit.isSuccess(exit), true);
    assert.deepEqual(events, ["connect", "lock", "unlock", "end"]);
  }),
);
