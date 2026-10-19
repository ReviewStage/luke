import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgTable, timestamp } from "drizzle-orm/pg-core";
import { type TestContext, test } from "vitest";
import { liveLatest, liveSelection } from "../live-statement.js";
import { queryBuilder } from "../query.js";

/**
 * Neon Realtime refuses a statement that calls any function Postgres does not
 * mark immutable ("scalar expression uses a mutable function"), and plain
 * Postgres runs the same statement without a word. An index expression is
 * held to the same rule, so each instant a live read renders is indexed here:
 * Postgres refuses the index exactly where Realtime would refuse the read.
 */

const probe = pgTable("probe", { at: timestamp("at", { withTimezone: true }).notNull() });

/** A PGlite with the probe table, closed when the test ends. */
async function opened(t: TestContext): Promise<PGlite> {
  const client = new PGlite();
  t.onTestFinished(() => client.close());
  await client.exec("create table probe (at timestamptz not null)");
  return client;
}

/** The one column a select renders, without its alias. */
function rendered(statement: { toSQL(): { readonly sql: string } }, alias: string): string {
  const match = new RegExp(`^select (.*) as "${alias}" from "probe"$`).exec(statement.toSQL().sql);
  assert.ok(match?.[1], statement.toSQL().sql);
  return match[1];
}

test("an instant a live read selects is immutable, as Realtime requires", async (t) => {
  const client = await opened(t);
  const expression = rendered(queryBuilder.select(liveSelection({}, { at: probe.at })).from(probe), "at");
  await client.exec(`create index probe_at_millis on probe ((${expression}))`);
  await client.exec("insert into probe values ('2026-10-19T23:44:23.347Z')");
  const { rows } = await client.query<{ at: number }>(`select ${expression} as at from probe`);
  assert.deepEqual(rows, [{ at: Date.parse("2026-10-19T23:44:23.347Z") }]);
});

test("a group's latest instant is immutable around its max, as Realtime requires", async (t) => {
  const client = await opened(t);
  const latest = rendered(
    queryBuilder.select({ latest: liveLatest(probe.at).as("latest") }).from(probe),
    "latest",
  );
  // Note that we read the max as its one row, because an index takes no aggregate: what wraps it is what Realtime checks.
  const wrapping = latest.replace('max("probe"."at")', '"probe"."at"');
  assert.notEqual(wrapping, latest);
  await client.exec(`create index probe_latest_millis on probe ((${wrapping}))`);
});
