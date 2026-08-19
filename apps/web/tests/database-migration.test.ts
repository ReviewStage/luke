import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { migrateWithLock } from "../server/db/migrate";

type MigrationConnection = Pick<Client, "connect" | "query" | "end">;

function migrationConnection(events: string[]): MigrationConnection {
  // SAFETY: Test double implements only the connect/query/end surface migrateWithLock uses.
  return {
    async connect() {
      events.push("connect");
      // SAFETY: migrateWithLock awaits connect but never reads the return value.
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

test("database migrations hold one session advisory lock", async () => {
  const events: string[] = [];
  await migrateWithLock(migrationConnection(events), async () => {
    events.push("migrate");
  });

  assert.deepEqual(events, ["connect", "lock", "migrate", "unlock", "end"]);
});

test("a failed migration still releases its lock and connection", async () => {
  const events: string[] = [];
  await assert.rejects(
    migrateWithLock(migrationConnection(events), async () => {
      events.push("migrate");
      throw new Error("migration failed");
    }),
    /migration failed/,
  );

  assert.deepEqual(events, ["connect", "lock", "migrate", "unlock", "end"]);
});

test("an unlock failure still closes the database connection", async () => {
  const events: string[] = [];
  const connection = migrationConnection(events);
  const query = connection.query.bind(connection);
  // SAFETY: Overrides the test double's query while preserving migrateWithLock's call shape.
  connection.query = (async (text: string, values?: unknown[]) => {
    const result = await query(text, values);
    if (text.includes("unlock")) throw new Error("unlock failed");
    return result;
  }) as MigrationConnection["query"];

  await assert.rejects(
    migrateWithLock(connection, async () => undefined),
    /unlock failed/,
  );
  assert.deepEqual(events, ["connect", "lock", "unlock", "end"]);
});
