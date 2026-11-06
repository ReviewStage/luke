import type { PgClient } from "@effect/sql-pg";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import type { EffectPgQueryEffectHKT, EffectPgQueryResultHKT } from "drizzle-orm/effect-postgres";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { QueryBuilder } from "drizzle-orm/pg-core";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect";
import { Context, Effect, Layer, Option, type Schema } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

export type DatabaseShape = PgEffectDatabase<EffectPgQueryEffectHKT, EffectPgQueryResultHKT>;

export class Database extends Context.Service<Database, DatabaseShape>()(
  "@repo/database/Database",
) {}

export const READ_CONCURRENCY = 3;

export const readConcurrency: Effect.Effect<number, never, SqlClient.SqlClient> = Effect.flatMap(
  SqlClient.SqlClient,
  (client) =>
    Effect.map(Effect.serviceOption(client.transactionService), (transaction) =>
      Option.isSome(transaction) ? 1 : READ_CONCURRENCY,
    ),
);

export const databaseOverPgClient: Layer.Layer<Database, never, PgClient.PgClient> = Layer.effect(
  Database,
  PgDrizzle.makeWithDefaults(),
);

export const queryBuilder = new QueryBuilder({ codecs: PgDrizzle.effectPgCodecs });

export type DatabaseServices = Database | SqlClient.SqlClient;

export type QueryError = SqlError | EffectDrizzleQueryError;

export type StoreFailure = QueryError | Schema.SchemaError;
