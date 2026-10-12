import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { Client } from "pg";
import { migrateThroughEndpointLimit, withMigrationLock } from "../server/db/migrate.js";

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

/** A connection whose connect is refused with `refusal` for the first `refused` connections opened. */
function refusingConnections(refusal: string, refused: number, events: string[]) {
  let opened = 0;
  return (): MigrationConnection => {
    opened += 1;
    const connection = migrationConnection(events);
    if (opened > refused) return connection;
    // SAFETY: Test double implements only the connect/query/end surface withMigrationLock uses.
    return {
      ...connection,
      async connect() {
        events.push("refused");
        throw new Error(refusal);
      },
    } as MigrationConnection;
  };
}

const NEON_ENDPOINT_LIMIT =
  "You have exceeded the limit of concurrently active endpoints. Please suspend some endpoints and try again.";

it.effect(
  "a migration Neon refuses for its endpoint limit waits for a compute and then runs once",
  () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const open = refusingConnections(NEON_ENDPOINT_LIMIT, 2, events);
      const fiber = yield* Effect.forkChild(
        migrateThroughEndpointLimit(
          Effect.suspend(() =>
            withMigrationLock(
              open(),
              Effect.sync(() => events.push("migrate")),
            ),
          ),
        ),
      );
      yield* TestClock.adjust("1 minute");
      yield* Fiber.join(fiber);

      assert.deepEqual(events, [
        "refused",
        "refused",
        "connect",
        "lock",
        "migrate",
        "unlock",
        "end",
      ]);
    }),
);

it.effect("a migration refused for any other reason fails without waiting", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const open = refusingConnections("password authentication failed", 1, events);
    const exit = yield* Effect.exit(
      migrateThroughEndpointLimit(
        Effect.suspend(() =>
          withMigrationLock(
            open(),
            Effect.sync(() => events.push("migrate")),
          ),
        ),
      ),
    );

    assert.equal(Exit.isFailure(exit), true);
    assert.deepEqual(events, ["refused"]);
  }),
);
