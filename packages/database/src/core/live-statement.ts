import { Column, is, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { Option, Schema } from "effect";

type LiveParameter = string | number | boolean | null;

export interface LiveSelect {
  readonly _: { readonly result: readonly unknown[] };
  toSQL(): { readonly sql: string; readonly params: readonly unknown[] };
}

export interface LiveStatement {
  readonly sql: string;
  readonly params: readonly LiveParameter[];
}

function epochMillis(column: SQLWrapper): SQL<number> {
  return sql<number>`floor(extract(epoch from (${column} at time zone 'UTC')) * 1000)::float8`;
}

export function liveSelection<
  const Columns extends Readonly<Record<string, SQLWrapper>>,
  const Instants extends Readonly<Record<string, SQLWrapper>> = Readonly<Record<never, SQLWrapper>>,
>(columns: Columns, instants?: Instants): Record<keyof Columns | keyof Instants, SQL.Aliased> {
  const aliased = [
    ...Object.entries(columns).map(([key, column]) => [key, sql`${column}`.as(key)] as const),
    ...Object.entries(instants ?? {}).map(
      ([key, column]) => [key, epochMillis(column).as(key)] as const,
    ),
  ];
  return Object.fromEntries(aliased) as Record<keyof Columns | keyof Instants, SQL.Aliased>;
}

export const LIVE_COUNT: SQL<number> = sql<number>`count(*)::int`;

export function liveLatest(column: SQLWrapper): SQL<number> {
  return epochMillis(sql`max(${column})`);
}

export function liveKeysIn(expression: SQLWrapper, keys: readonly string[]): SQL {
  if (keys.length === 0) return sql`false`;
  const type = is(expression, Column) ? expression.getSQLType() : "text";
  return sql`${expression} in (select jsonb_array_elements_text(${JSON.stringify([...new Set(keys)])}::jsonb)::${sql.raw(type)})`;
}

const LiveValuesSchema = Schema.Array(
  Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null, Schema.Date]),
);

export function liveStatementOf(statement: LiveSelect): Option.Option<LiveStatement> {
  const { sql: text, params } = statement.toSQL();
  return Option.map(Schema.decodeUnknownOption(LiveValuesSchema)(params), (values) => ({
    sql: text,
    params: values.map((value) => (value instanceof Date ? value.toISOString() : value)),
  }));
}
