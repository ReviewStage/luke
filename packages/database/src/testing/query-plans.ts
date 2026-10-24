import { Effect } from "effect";
import { SqlClient, type SqlError, Statement } from "effect/sql";

/**
 * query-plans.ts -- the plans Postgres makes for the statements a store call runs.
 *
 * A test that holds a read to its index runs the store's own call, captures
 * each statement as it was compiled to run, and explains it afterwards, so
 * what is planned is the statement the call sends rather than a copy of it
 * the test keeps beside it. Note that the scan of a whole table is refused
 * while explaining, so a table a test wrote a handful of rows to still plans
 * as one of millions would, and that the plan is generic, as a statement
 * prepared once and run again is planned, so an index a read could use only
 * for one bound value does not pass for one it uses.
 */

/** The name a statement is prepared under while it is explained. */
const PLANNED = "planned_statement";

/** One statement a call ran, as Postgres was handed it, and the plan Postgres makes for it. */
export interface PlannedStatement {
  readonly sql: string;
  readonly plan: string;
}

/** The generic plan of one statement, as `explain` writes it, its lines joined. */
export function planOf(
  statement: string,
): Effect.Effect<string, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client.unsafe("set local enable_seqscan = off");
        yield* client.unsafe("set local plan_cache_mode = force_generic_plan");
        // Note that the statement is prepared under a name rather than explained as it stands,
        // because its placeholders would be read as the explain's own, and that each is handed a
        // null, which a generic plan never looks at.
        yield* client.unsafe(`prepare ${PLANNED} as ${statement}`);
        const [prepared] = yield* client.unsafe<{ readonly parameters: number }>(
          "select cardinality(parameter_types) as parameters from pg_prepared_statements where name = $1",
          [PLANNED],
        );
        const nulls = Array.from({ length: prepared?.parameters ?? 0 }, () => "null").join(", ");
        const rows = yield* client.unsafe<{ readonly "QUERY PLAN": string }>(
          nulls.length === 0
            ? `explain execute ${PLANNED}`
            : `explain execute ${PLANNED}(${nulls})`,
        );
        return rows.map((row) => row["QUERY PLAN"]).join("\n");
      }).pipe(Effect.ensuring(Effect.ignore(client.unsafe(`deallocate ${PLANNED}`)))),
    ),
  );
}

/**
 * Runs the call, then answers every statement it ran with its plan, in the
 * order they ran.
 */
export function plansOf<A, E, R>(
  call: Effect.Effect<A, E, R>,
): Effect.Effect<readonly PlannedStatement[], E | SqlError.SqlError, R | SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const ran: string[] = [];
    yield* Effect.provideService(call, Statement.CurrentTransformer, (statement) =>
      Effect.sync(() => {
        ran.push(statement.compile()[0]);
        return statement;
      }),
    );
    const planned: PlannedStatement[] = [];
    for (const sql of ran) planned.push({ sql, plan: yield* planOf(sql) });
    return planned;
  });
}
