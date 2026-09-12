import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Schema } from "effect";
import { test } from "vitest";
import { testSqlClient } from "./support/sql-client";

/**
 * One convention for every stored instant: `timestamp with time zone`, which
 * carries the point on the timeline whatever zone the writing host or the
 * reading session sits in, or a `bigint` epoch where a table already kept
 * one. A `timestamp without time zone` column keeps a wall clock instead, so
 * a `Date` written on one host reads back shifted by the offset on another
 * (LUKE-198). The first test is the standing guard over the migrated schema
 * on both dialects; the second holds migration 0026 to keeping every instant
 * the naive columns already carried, whatever zone the migrating session
 * happens to sit in.
 */

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
const INSTANTS_MIGRATION = "0026_instants_timestamptz";
const SESSION_ZONE = "Asia/Tokyo";
const COLUMN_TYPE = {
  INSTANT: "timestamp with time zone",
  WALL_CLOCK: "timestamp without time zone",
} as const;

const ColumnRowSchema = Schema.Struct({
  table_name: Schema.String,
  column_name: Schema.String,
});

it.layer(testSqlClient)("the migrated schema's instant columns", (it) => {
  it.effect("holds no timestamp without time zone column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type = ${COLUMN_TYPE.WALL_CLOCK}
        order by table_name, ordinal_position
      `;
      assert.deepEqual(
        rows.map((row) => Schema.decodeUnknownSync(ColumnRowSchema)(row)),
        [],
      );
    }),
  );
});

const Journal = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ idx: Schema.Int, tag: Schema.String })),
});
type JournalEntry = Schema.Schema.Type<typeof Journal>["entries"][number];

const decodeJournal = Schema.decodeUnknownSync(Schema.parseJson(Journal));

async function journal(): Promise<readonly JournalEntry[]> {
  return decodeJournal(await readFile(`${MIGRATIONS}/meta/_journal.json`, "utf8")).entries;
}

async function apply(client: PGlite, entry: JournalEntry): Promise<void> {
  await client.exec(await readFile(`${MIGRATIONS}/${entry.tag}.sql`, "utf8"));
}

/** What a UTC process wrote into a naive column for the instant: its UTC wall clock, offset dropped. */
function wallClockOf(instantMs: number): string {
  return new Date(instantMs).toISOString().slice(0, 19).replace("T", " ");
}

/** The instants a UTC process wrote into the naive columns, as the points on the timeline it meant. */
const RECORDED_AT = {
  USER_CREATED: Date.UTC(2026, 7, 17, 9, 15, 0),
  SESSION_EXPIRES: Date.UTC(2026, 8, 19, 6, 35, 31),
  PREFERENCE_UPDATED: Date.UTC(2026, 8, 12, 7, 0, 0),
  TOKEN_CREATED: Date.UTC(2026, 8, 12, 6, 35, 31),
  TOKEN_EXPIRES: Date.UTC(2026, 8, 12, 7, 35, 31),
} as const;

const NAIVE_COLUMNS_BEFORE = 32;

const ColumnTypeRowSchema = Schema.Struct({
  table_name: Schema.String,
  column_name: Schema.String,
  data_type: Schema.String,
  column_default: Schema.NullOr(Schema.String),
});

/** Every timestamp column of the public schema with its type and default, in table and column order. */
async function timestampColumns(client: PGlite) {
  const result = await client.query(
    `select table_name, column_name, data_type, column_default from information_schema.columns
     where table_schema = 'public' and data_type in ($1, $2)
     order by table_name, ordinal_position`,
    [COLUMN_TYPE.INSTANT, COLUMN_TYPE.WALL_CLOCK],
  );
  return result.rows.map((row) => Schema.decodeUnknownSync(ColumnTypeRowSchema)(row));
}

const EpochRowSchema = Schema.Struct({
  user_created: Schema.Number,
  session_expires: Schema.Number,
  preference_updated: Schema.Number,
  token_created: Schema.Number,
  token_expires: Schema.Number,
  token_revoked: Schema.Null,
});

test("migration 0026 keeps every recorded instant whatever zone the migrating session sits in, keeps each default, and leaves no naive column", async () => {
  const client = new PGlite();
  const entries = await journal();
  const migration = entries.find((entry) => entry.tag === INSTANTS_MIGRATION);
  assert.ok(migration);
  for (const entry of entries.filter((entry) => entry.idx < migration.idx)) {
    await apply(client, entry);
  }
  const before = await timestampColumns(client);
  const naiveBefore = before.filter((column) => column.data_type === COLUMN_TYPE.WALL_CLOCK);
  assert.equal(naiveBefore.length, NAIVE_COLUMNS_BEFORE);

  await client.exec(`set time zone '${SESSION_ZONE}'`);
  await client.query(
    `insert into "user" (id, name, email, created_at, updated_at) values ($1, $2, $3, $4, $4)`,
    ["user-a", "A", "a@luke.test", wallClockOf(RECORDED_AT.USER_CREATED)],
  );
  await client.query(
    `insert into session (id, token, user_id, expires_at, updated_at) values ($1, $2, $3, $4, $4)`,
    ["session-a", "token-a", "user-a", wallClockOf(RECORDED_AT.SESSION_EXPIRES)],
  );
  await client.query(`insert into account_preference (user_id, updated_at) values ($1, $2)`, [
    "user-a",
    wallClockOf(RECORDED_AT.PREFERENCE_UPDATED),
  ]);
  await client.query(
    `insert into oauth_client (id, client_id, redirect_uris) values ($1, $1, $2)`,
    ["client-a", ["http://127.0.0.1/callback"]],
  );
  await client.query(
    `insert into oauth_refresh_token (id, token, client_id, user_id, scopes, created_at, expires_at, revoked)
     values ($1, $2, $3, $4, $5, $6, $7, null)`,
    [
      "refresh-a",
      "refresh-token-a",
      "client-a",
      "user-a",
      ["openid"],
      wallClockOf(RECORDED_AT.TOKEN_CREATED),
      wallClockOf(RECORDED_AT.TOKEN_EXPIRES),
    ],
  );

  await apply(client, migration);

  const after = await timestampColumns(client);
  assert.deepEqual(
    after.filter((column) => column.data_type === COLUMN_TYPE.WALL_CLOCK),
    [],
  );
  assert.deepEqual(
    after.map((column) => [column.table_name, column.column_name, column.column_default]),
    before.map((column) => [column.table_name, column.column_name, column.column_default]),
  );

  const migrated = await client.query(
    `select
       extract(epoch from "user".created_at)::float8 * 1000 as user_created,
       extract(epoch from session.expires_at)::float8 * 1000 as session_expires,
       extract(epoch from account_preference.updated_at)::float8 * 1000 as preference_updated,
       extract(epoch from oauth_refresh_token.created_at)::float8 * 1000 as token_created,
       extract(epoch from oauth_refresh_token.expires_at)::float8 * 1000 as token_expires,
       oauth_refresh_token.revoked as token_revoked
     from "user"
     inner join session on session.user_id = "user".id
     inner join account_preference on account_preference.user_id = "user".id
     inner join oauth_refresh_token on oauth_refresh_token.user_id = "user".id
     where "user".id = $1`,
    ["user-a"],
  );
  assert.deepEqual(
    migrated.rows.map((row) => Schema.decodeUnknownSync(EpochRowSchema)(row)),
    [
      {
        user_created: RECORDED_AT.USER_CREATED,
        session_expires: RECORDED_AT.SESSION_EXPIRES,
        preference_updated: RECORDED_AT.PREFERENCE_UPDATED,
        token_created: RECORDED_AT.TOKEN_CREATED,
        token_expires: RECORDED_AT.TOKEN_EXPIRES,
        token_revoked: null,
      },
    ],
  );
  await client.close();
});
