import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { Option, Schema } from "effect";

/**
 * live-statement.ts -- a read written for Neon Realtime: its columns named as the wire names them, and the statement as SQL text and values.
 *
 * A live read is subscribed to by its rows rather than run by the store, so
 * nothing on the way maps a column back to the key a statement selected it
 * under: Realtime names each column of a row as the SQL does. A live read
 * selects every column under its wire key (`liveSelection`), and an instant
 * as the epoch milliseconds the wire carries, so a row as Realtime delivers
 * it decodes under the same schema the held read answers with. Realtime takes
 * the Drizzle select itself through its Drizzle adapter, which renders it to
 * SQL with `$n` placeholders and its values beside it and refuses one whose
 * selected key is not the name Postgres answers the column under
 * (`liveStatementOf`).
 *
 * Note that a live read is deterministic, as Realtime requires: no `now()`,
 * no window measured from the clock. A read that needs one bounds it on the
 * reader's side instead.
 */

/** One value of a live statement, as Realtime takes it: Postgres infers its type from where it stands. */
type LiveParameter = string | number | boolean | null;

/**
 * A Drizzle select as Realtime's Drizzle adapter seals it: the rows it is
 * typed to answer, and the SQL and values it renders to.
 */
export interface LiveSelect {
  readonly _: { readonly result: readonly unknown[] };
  toSQL(): { readonly sql: string; readonly params: readonly unknown[] };
}

/**
 * A live statement: its SQL and the values its placeholders name, in order,
 * and the Drizzle select it was rendered from, which is what is sealed
 * (`drizzleAdapter()`); a statement written as text alone, as a test's
 * stand-in is, carries none and is sealed as that text.
 */
export interface LiveStatement {
  readonly sql: string;
  readonly params: readonly LiveParameter[];
  readonly query?: LiveSelect;
}

/**
 * An instant as the wire carries one: whole epoch milliseconds, as a number
 * rather than Postgres's text. Note that the instant is read at UTC first:
 * `extract` from a `timestamptz` is only stable, since it reads the session's
 * time zone, and Realtime refuses a statement with any function that is not
 * immutable ("scalar expression uses a mutable function"). From a `timestamp`
 * read at UTC it is immutable, and the epoch is the same.
 */
function epochMillis(column: SQLWrapper): SQL<number> {
  return sql<number>`floor(extract(epoch from (${column} at time zone 'UTC')) * 1000)::float8`;
}

/**
 * The columns of a live read, each under its own key, and the `instants`
 * as epoch milliseconds under theirs, so Realtime names each column of a row
 * by the key the wire reads it under.
 */
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
  // SAFETY: every key of `columns` and of `instants` is written above, and no other.
  return Object.fromEntries(aliased) as Record<keyof Columns | keyof Instants, SQL.Aliased>;
}

/** How many rows a group holds, as a number rather than the `bigint` Realtime would carry as text. */
export const LIVE_COUNT: SQL<number> = sql<number>`count(*)::int`;

/** When a group's latest row changed, as epoch milliseconds, read at UTC as `epochMillis` reads one. */
export function liveLatest(column: SQLWrapper): SQL<number> {
  return epochMillis(sql`max(${column})`);
}

/** The values Realtime carries as they are, and an instant, which it carries as the text Postgres reads one from. */
const LiveValuesSchema = Schema.Array(
  Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null, Schema.Date]),
);

/**
 * The statement as Realtime takes it; none where it names a value Realtime
 * cannot carry, which a caller answers as the read not being live.
 */
export function liveStatementOf(statement: LiveSelect): Option.Option<LiveStatement> {
  const { sql: text, params } = statement.toSQL();
  return Option.map(Schema.decodeUnknownOption(LiveValuesSchema)(params), (values) => ({
    sql: text,
    params: values.map((value) => (value instanceof Date ? value.toISOString() : value)),
    // Note that a select binding an instant is sealed as its text, because the adapter encodes no `Date`.
    ...(values.some((value) => value instanceof Date) ? undefined : { query: statement }),
  }));
}
