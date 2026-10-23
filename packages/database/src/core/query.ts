import type { PgClient } from "@effect/sql-pg";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import type { EffectPgQueryEffectHKT, EffectPgQueryResultHKT } from "drizzle-orm/effect-postgres";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { QueryBuilder } from "drizzle-orm/pg-core";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect";
import { Context, Layer, type Schema } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

/**
 * The Drizzle database every query module renders its statements through,
 * Drizzle's own Effect driver over the `PgClient` the runtime already holds.
 *
 * A statement is an Effect that runs on that client, so it lands inside an
 * enclosing `sql.withTransaction` on the same client: the driver reads the
 * transaction's connection out of the running fiber exactly as a raw `sql`
 * statement does. No `relations` config, because nothing reaches Drizzle's
 * relational queries: the tables a statement names are imported from their
 * own `schemas/*.ts` module, which is the import the store-writer boundary
 * reads.
 */
export type DatabaseShape = PgEffectDatabase<EffectPgQueryEffectHKT, EffectPgQueryResultHKT>;

export class Database extends Context.Service<Database, DatabaseShape>()(
  "@luke/database/Database",
) {}

/** The database over the runtime's `PgClient`, without logging or caching (connect-effect-postgres step 3). */
export const databaseOverPgClient: Layer.Layer<Database, never, PgClient.PgClient> = Layer.effect(
  Database,
  PgDrizzle.makeWithDefaults(),
);

/**
 * The builder a subquery or a `with` clause is rendered with where no
 * statement is running: it holds no session, so it is a module constant, and
 * it reads columns with the same codecs the driver's own dialect does, so a
 * subquery's columns come back as the statement around it expects them.
 */
export const queryBuilder = new QueryBuilder({ codecs: PgDrizzle.effectPgCodecs });

/** What a query module's effects ask for: the client its raw statements run on and the Drizzle database over it. */
export type DatabaseServices = Database | SqlClient.SqlClient;

/**
 * How a statement fails: a raw `sql` statement with the `SqlError` itself, a
 * Drizzle statement with the driver's `EffectDrizzleQueryError` around it.
 */
export type QueryError = SqlError | EffectDrizzleQueryError;

/** How a store's read or write fails: its statement, or a row its schema does not decode. */
export type StoreFailure = QueryError | Schema.SchemaError;
