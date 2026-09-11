import type { SqlClient } from "@effect/sql";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { type Effect, Schema } from "effect";
import type * as schema from "../../db/schema.js";
import { openPayload, type PayloadKeyRing, sealPayload } from "../encryption.js";

/**
 * What a table module here still on Drizzle runs over: a Drizzle database on
 * the hosted schema, whichever driver stands behind it — `pg` on Neon in a
 * function, PGlite in a test — or a transaction on one, since a transaction
 * is a database with the same query surface. The modules never name a driver,
 * so the one store runs against both. A module moved onto `@effect/sql` names
 * no database at all: it reads the ambient `SqlClient` and is answered through
 * `HostedStoreRun` below.
 */
type HostedSchema = typeof schema;

export type HostedStoreDatabase = PgDatabase<PgQueryResultHKT, HostedSchema>;

/**
 * How a store method built on `@effect/sql` is answered to a caller still
 * holding a promise. The implementation is the edge's own runner — `runWeb`
 * in a function, the test harness's runtime over the database its Drizzle
 * handle stands on — so nothing here builds a runtime of its own; the door
 * exists because the `HostedStore` methods answer promises while the modules
 * beneath them are converted one at a time.
 *
 * The writers and the speech module are handed the same runner directly
 * rather than through a store context, because a route composes them apart
 * from the store: the door is one shim either way.
 *
 * @deprecated A strangler shim. P10-14 deletes it with the Drizzle half, once
 * every module here is an effect and the routes above take one.
 */
export type HostedStoreRun = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>;

export interface HostedStoreContext {
  readonly db: HostedStoreDatabase;
  readonly keys: PayloadKeyRing;
  readonly run: HostedStoreRun;
}

/**
 * The seal and open for one user's rows, each envelope bound to that user's
 * id, so a sealed column copied under another user does not open there.
 */
export interface UserSeal {
  readonly seal: (plaintext: string) => string;
  readonly open: (sealed: string) => string;
}

export function userSeal(keys: PayloadKeyRing, userId: string): UserSeal {
  return {
    seal: (plaintext) => sealPayload(plaintext, keys, userId),
    open: (sealed) => openPayload(sealed, keys, userId),
  };
}

/** An optional field as its nullable column takes it. */
export function nullable<Value>(value: Value | undefined): Value | null {
  return value === undefined ? null : value;
}

/** A nullable column as an optional field: present with its value, or absent. */
export function optionalField<Value>(name: string, value: Value | null): Record<string, Value> {
  return value === null ? {} : { [name]: value };
}

/**
 * A `bigint` epoch-millis column as the two drivers hand it back: `pg` reads
 * `int8` as a string, because a 64-bit value need not fit a JS number, while
 * PGlite parses it to one. Every instant in these columns is a millisecond
 * since the epoch, well inside the safe integer range, so both readings
 * decode to the same number and neither dialect's rows read differently.
 */
export const EpochMillisColumnSchema = Schema.Union(Schema.Number, Schema.NumberFromString);
