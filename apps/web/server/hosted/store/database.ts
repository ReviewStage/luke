import { Schema, SchemaTransformation } from "effect";
import { openPayload, type PayloadKeyRing, sealPayload } from "../encryption.js";

export interface HostedStoreContext {
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

/**
 * A `bigint` column's value as a number, whichever of the three readings the
 * driver gave it: `@effect/sql-pg`'s own binary codec answers a JS `bigint`,
 * the `pg` driver it replaced answered a string, and PGlite parses the column
 * to a number. Only the read differs — a number bound to an `int8` parameter
 * is taken by every one of them.
 */
export const NumberFromBigIntColumn = Schema.BigInt.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transform({ decode: Number, encode: BigInt }),
  ),
);

/**
 * A `bigint` epoch-millis column as the three drivers hand it back:
 * `@effect/sql-pg` reads `int8` as a JS `bigint` and the `pg` driver before it
 * read one as a string, each because a 64-bit value need not fit a JS number,
 * while PGlite parses it to one. Every instant in these columns is a
 * millisecond since the epoch, well inside the safe integer range, so all
 * three readings decode to the same number and no dialect's rows read
 * differently.
 */
export const EpochMillisColumnSchema = Schema.Union([
  Schema.Number,
  Schema.NumberFromString,
  NumberFromBigIntColumn,
]);

/**
 * A `timestamptz` column as the two drivers hand it back: `@effect/sql-pg`'s
 * own binary codec answers epoch milliseconds, while PGlite parses the column
 * to a `Date`. Both readings are the same instant, so neither dialect's rows
 * read differently. A timestamp *parameter* is a `Date` on both — a number
 * bound to one fails the query — which is why a write's own field stays
 * `Schema.Date`.
 */
export const InstantColumnSchema = Schema.Union([Schema.DateFromMillis, Schema.Date]);
