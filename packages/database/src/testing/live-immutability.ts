import { Effect, Predicate } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";

/**
 * live-immutability.ts -- the functions a live statement calls that Postgres does not mark immutable, which Neon Realtime refuses.
 *
 * Realtime refuses a statement that calls any function, operator, or
 * aggregate whose `provolatile` is not `i` ("unsupported query: scalar
 * expression uses a mutable function"), while plain Postgres and PGlite run
 * the same statement without a word. So the statement is made a view, its
 * placeholders written as literals, and what the view's rule calls is read
 * from the rule's own tree in `pg_rewrite`: every function, aggregate, and
 * window function it names, and the function behind every operator, each
 * with its volatility, its subqueries included. Note that `pg_depend` would
 * not do, since Postgres records no dependency on a built-in, which every
 * function Realtime could refuse is.
 *
 * A cast through a type's text form (`CoerceViaIO`) names no function in the
 * tree, so an input or output function a cast calls is not read here; a
 * literal cast (`'-infinity'::timestamptz`) is folded to a constant first and
 * calls nothing.
 */

/** A statement as Realtime takes it: SQL with `$n` placeholders, and their values in order. */
export interface ImmutabilityProbe {
  readonly sql: string;
  readonly params: readonly (string | number | boolean | null)[];
}

/** The view a probe is made, for as long as it is read. */
const PROBE_VIEW = "luke_live_immutability_probe";

/** A value written as the literal it stands for: text left untyped, so Postgres types it from where it stands, as it types a placeholder. */
function literalOf(value: string | number | boolean | null): string {
  return Predicate.isString(value) ? `'${value.replaceAll("'", "''")}'` : String(value);
}

/** The statement with each placeholder written as its value; one naming no value is left for Postgres to refuse. */
function inlined(probe: ImmutabilityProbe): string {
  return probe.sql.replace(/\$(\d+)\b/g, (placeholder, position: string) => {
    const value = probe.params[Number(position) - 1];
    return value === undefined ? placeholder : literalOf(value);
  });
}

/**
 * Every function, aggregate, and operator's function the statement calls
 * that is not immutable, as `name(arguments) volatility`, sorted; empty
 * where Realtime would take the statement.
 */
export function mutableFunctionsOf(
  probe: ImmutabilityProbe,
): Effect.Effect<readonly string[], SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`create or replace temporary view ${PROBE_VIEW} as ${inlined(probe)}`);
    const rows = yield* sql.unsafe<{ readonly called: string }>(
      `with rule as (
         select ev_action::text as tree from pg_rewrite where ev_class = '${PROBE_VIEW}'::regclass
       ), called as (
         select called[2]::oid as proc
           from rule, regexp_matches(tree, ':(funcid|aggfnoid|winfnoid) (\\d+)', 'g') as called
         union
         select operator.oprcode::oid
           from rule, regexp_matches(tree, ':opno (\\d+)', 'g') as called
           join pg_operator as operator on operator.oid = called[1]::oid
       )
       select distinct p.oid::regprocedure::text || ' ' || p.provolatile::text as called
         from called join pg_proc as p on p.oid = called.proc
        where p.provolatile <> 'i'
        order by 1`,
    );
    yield* sql.unsafe(`drop view ${PROBE_VIEW}`);
    return rows.map((row) => row.called);
  });
}
