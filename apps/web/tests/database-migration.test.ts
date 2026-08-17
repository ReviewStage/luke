import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { migrateWithLock } from "../server/db/migrate";

function migrationConnection(events: string[]) {
  return {
    async connect() {
      events.push("connect");
    },
    async query(query: string) {
      events.push(query.includes("unlock") ? "unlock" : "lock");
      return {};
    },
    async end() {
      events.push("end");
    },
  } as unknown as Pick<Client, "connect" | "query" | "end">;
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
  connection.query = (async (text: string, values?: unknown[]) => {
    const result = await query(text, values);
    if (text.includes("unlock")) throw new Error("unlock failed");
    return result;
  }) as typeof connection.query;

  await assert.rejects(
    migrateWithLock(connection, async () => undefined),
    /unlock failed/,
  );
  assert.deepEqual(events, ["connect", "lock", "unlock", "end"]);
});
