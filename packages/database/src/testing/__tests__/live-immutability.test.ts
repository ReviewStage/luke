import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { type LiveSelect, liveSelection, liveStatementOf } from "../../core/live-statement.js";
import { queryBuilder } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { mutableFunctionsOf } from "../live-immutability.js";
import { getTestDB } from "../sql-client.js";

/**
 * The probe reads what a statement calls as Postgres records it, so a
 * statement Realtime would refuse is named by every function that is not
 * immutable, an aggregate's and an operator's among them, and one it would
 * take by none.
 */

/** The live statement a select renders to, which every probe here can carry. */
function statementOf(select: LiveSelect) {
  return Option.getOrThrow(liveStatementOf(select));
}

it.layer(getTestDB())("a live statement's immutability", (it) => {
  it.effect(
    "a statement of columns, instants read at UTC, and a scalar read calls nothing mutable",
    () =>
      Effect.gen(function* () {
        const statement = statementOf(
          queryBuilder
            .select(
              liveSelection(
                {
                  id: user.id,
                  named: sql<boolean>`${user.name} <> ${"nobody"}`,
                  others: sql<number>`(select count(*)::int from ${user} as other where other.id <> ${user.id})`,
                },
                { createdAt: user.createdAt },
              ),
            )
            .from(user)
            .where(and(eq(user.id, "user-1"), eq(user.emailVerified, true))),
        );
        assert.deepEqual(yield* mutableFunctionsOf(statement), []);
      }),
  );

  it.effect(
    "a statement building JSON, extracting from a timestamptz, or adding to one is named by each call",
    () =>
      Effect.gen(function* () {
        const statement = statementOf(
          queryBuilder
            .select({
              files:
                sql`(select coalesce(jsonb_agg(jsonb_build_object('id', other.id)), '[]'::jsonb) from ${user} as other)`.as(
                  "files",
                ),
              at: sql`floor(extract(epoch from ${user.createdAt}) * 1000)::float8`.as("at"),
              later: sql`${user.updatedAt} > ${user.createdAt} + interval '1 day'`.as("later"),
            })
            .from(user)
            .where(eq(user.id, "user-1")),
        );
        assert.deepEqual(yield* mutableFunctionsOf(statement), [
          '"extract"(text,timestamp with time zone) s',
          "jsonb_agg(anyelement) s",
          'jsonb_build_object("any") s',
          "timestamptz_pl_interval(timestamp with time zone,interval) s",
        ]);
      }),
  );
});
