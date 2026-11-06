import { Effect } from "effect";
import { SqlClient, type SqlError, Statement } from "effect/sql";

const PLANNED = "planned_statement";

export interface PlannedStatement {
  readonly sql: string;
  readonly plan: string;
}

export function planOf(
  statement: string,
): Effect.Effect<string, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client.unsafe("set local enable_seqscan = off");
        yield* client.unsafe("set local plan_cache_mode = force_generic_plan");
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
