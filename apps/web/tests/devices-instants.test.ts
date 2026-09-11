import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { gt, gte, sql } from "drizzle-orm";
import { test } from "vitest";
import { z } from "zod";
import { devices } from "../server/db/devices-schema";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The `devices` instants this rework writes (`last_seen_at`, `active_until`,
 * `quiet_until`) are points on the timeline compared against now: a meeting
 * hold that ends, a presence that lapses, an account seen recently enough to
 * observe. What these tests hold to is that the migration to `timestamptz`
 * keeps every instant an existing row already carried, whatever zone the
 * session that runs it happens to sit in, and that a comparison against now
 * answers by the instant afterwards rather than by a wall clock.
 */

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
const DEVICES_INSTANTS_MIGRATION = "0020_e6b_devices_timestamptz";
const SESSION_ZONE = "Asia/Tokyo";
const COLUMN_TYPE = {
  INSTANT: "timestamp with time zone",
  WALL_CLOCK: "timestamp without time zone",
} as const;
/** The instants a UTC process wrote into the naive columns, as the points on the timeline it meant. */
const RECORDED_AT = {
  LAST_SEEN: Date.UTC(2026, 2, 1, 12, 34, 56),
  ACTIVE_UNTIL: Date.UTC(2026, 2, 1, 13, 0, 0),
  QUIET_UNTIL: Date.UTC(2026, 2, 1, 14, 30, 0),
} as const;

const Journal = z.object({ entries: z.array(z.object({ idx: z.number(), tag: z.string() })) });
type JournalEntry = z.infer<typeof Journal>["entries"][number];

async function journal(): Promise<readonly JournalEntry[]> {
  return Journal.parse(JSON.parse(await readFile(`${MIGRATIONS}/meta/_journal.json`, "utf8")))
    .entries;
}

async function apply(client: PGlite, entry: JournalEntry): Promise<void> {
  await client.exec(await readFile(`${MIGRATIONS}/${entry.tag}.sql`, "utf8"));
}

/** What a UTC process wrote into a naive column for the instant: its UTC wall clock, offset dropped. */
function wallClockOf(instantMs: number): string {
  return new Date(instantMs).toISOString().slice(0, 19).replace("T", " ");
}

/** Each timeline column of `devices` with its type, in column order. */
async function columnTypes(client: PGlite): Promise<readonly (readonly [string, string])[]> {
  const result = await client.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
     where table_name = 'devices' and column_name in
       ('last_seen_at', 'active_until', 'quiet_until', 'created_at', 'updated_at')
     order by ordinal_position`,
  );
  return result.rows.map((row) => [row.column_name, row.data_type]);
}

test("the migration keeps every recorded instant, whatever zone the migrating session sits in, and leaves v1's own columns as they were", async () => {
  const client = new PGlite();
  const entries = await journal();
  const migration = entries.find((entry) => entry.tag === DEVICES_INSTANTS_MIGRATION);
  assert.ok(migration);
  for (const entry of entries.filter((entry) => entry.idx < migration.idx)) {
    await apply(client, entry);
  }
  assert.deepEqual(await columnTypes(client), [
    ["last_seen_at", COLUMN_TYPE.WALL_CLOCK],
    ["active_until", COLUMN_TYPE.WALL_CLOCK],
    ["created_at", COLUMN_TYPE.WALL_CLOCK],
    ["updated_at", COLUMN_TYPE.WALL_CLOCK],
    ["quiet_until", COLUMN_TYPE.WALL_CLOCK],
  ]);

  await client.exec(`set time zone '${SESSION_ZONE}'`);
  await client.query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [
    "user-a",
    "A",
    "a@luke.test",
  ]);
  await client.query(
    `insert into devices (id, user_id, installation_id, platform, last_seen_at, active_until, quiet_until)
     values ($1, $2, $3, $4, $5, $6, $7), ($8, $2, $9, $4, $5, null, null)`,
    [
      "device-holding",
      "user-a",
      "install-holding",
      "macos",
      wallClockOf(RECORDED_AT.LAST_SEEN),
      wallClockOf(RECORDED_AT.ACTIVE_UNTIL),
      wallClockOf(RECORDED_AT.QUIET_UNTIL),
      "device-silent",
      "install-silent",
    ],
  );

  await apply(client, migration);

  assert.deepEqual(await columnTypes(client), [
    ["last_seen_at", COLUMN_TYPE.INSTANT],
    ["active_until", COLUMN_TYPE.INSTANT],
    ["created_at", COLUMN_TYPE.WALL_CLOCK],
    ["updated_at", COLUMN_TYPE.WALL_CLOCK],
    ["quiet_until", COLUMN_TYPE.INSTANT],
  ]);
  const migrated = await client.query<{
    id: string;
    last_seen: number;
    active_until: number | null;
    quiet_until: number | null;
  }>(
    `select id,
       extract(epoch from last_seen_at)::float8 * 1000 as last_seen,
       extract(epoch from active_until)::float8 * 1000 as active_until,
       extract(epoch from quiet_until)::float8 * 1000 as quiet_until
     from devices order by id`,
  );
  assert.deepEqual(migrated.rows, [
    {
      id: "device-holding",
      last_seen: RECORDED_AT.LAST_SEEN,
      active_until: RECORDED_AT.ACTIVE_UNTIL,
      quiet_until: RECORDED_AT.QUIET_UNTIL,
    },
    {
      id: "device-silent",
      last_seen: RECORDED_AT.LAST_SEEN,
      active_until: null,
      quiet_until: null,
    },
  ]);
  await client.close();
});

test("a device's instants round-trip through the schema as points on the timeline, and a hold or an eligibility is compared against now by the instant under any session zone", async () => {
  const database = await openHostedStoreTestDatabase();
  await database.db.execute(sql.raw(`set time zone '${SESSION_ZONE}'`));
  const userId = await database.createUser();
  const holdingId = `device-${randomUUID()}`;
  const releasedId = `device-${randomUUID()}`;

  const now = new Date("2026-03-01T12:00:00.000Z");
  const holding = new Date(now.getTime() + 30 * 60_000);
  const released = new Date(now.getTime() - 30 * 60_000);
  await database.db.insert(devices).values([
    {
      id: holdingId,
      userId,
      installationId: `install-${holdingId}`,
      platform: "macos",
      lastSeenAt: now,
      activeUntil: holding,
      quietUntil: holding,
    },
    {
      id: releasedId,
      userId,
      installationId: `install-${releasedId}`,
      platform: "macos",
      lastSeenAt: released,
      activeUntil: null,
      quietUntil: released,
    },
  ]);

  const mine = sql`${devices.userId} = ${userId}`;
  const rows = await database.db
    .select({
      id: devices.id,
      lastSeenAt: devices.lastSeenAt,
      activeUntil: devices.activeUntil,
      quietUntil: devices.quietUntil,
    })
    .from(devices)
    .where(mine)
    .orderBy(devices.lastSeenAt);
  assert.deepEqual(
    rows.map((row) => [
      row.id,
      row.lastSeenAt.getTime(),
      row.activeUntil?.getTime() ?? null,
      row.quietUntil?.getTime() ?? null,
    ]),
    [
      [releasedId, released.getTime(), null, released.getTime()],
      [holdingId, now.getTime(), holding.getTime(), holding.getTime()],
    ],
  );

  const stillHolding = await database.db
    .select({ id: devices.id })
    .from(devices)
    .where(sql`${mine} and ${gt(devices.quietUntil, now)}`);
  assert.deepEqual(
    stillHolding.map((row) => row.id),
    [holdingId],
  );
  const eligible = await database.db
    .select({ id: devices.id })
    .from(devices)
    .where(sql`${mine} and ${gte(devices.lastSeenAt, now)}`);
  assert.deepEqual(
    eligible.map((row) => row.id),
    [holdingId],
  );
  await database.close();
});
