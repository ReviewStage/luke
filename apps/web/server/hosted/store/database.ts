import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../../db/schema.js";
import { openPayload, type PayloadKeyRing, sealPayload } from "../encryption.js";

/**
 * What every table module here runs over: a Drizzle database on the hosted
 * schema, whichever driver stands behind it — `pg` on Neon in a function,
 * PGlite in a test — or a transaction on one, since a transaction is a
 * database with the same query surface. The modules never name a driver,
 * so the one store runs against both.
 */
type HostedSchema = typeof schema;

export type HostedStoreDatabase = PgDatabase<PgQueryResultHKT, HostedSchema>;

export interface HostedStoreContext {
  readonly db: HostedStoreDatabase;
  readonly keys: PayloadKeyRing;
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
