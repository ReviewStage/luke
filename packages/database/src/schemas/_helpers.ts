import { customType, timestamp } from "drizzle-orm/pg-core";

/**
 * An instant column: `timestamp with time zone`, so the value stored is a
 * point on the timeline and a comparison against now cannot drift with the
 * session's zone. Migration 0026 made every instant in the database one, so
 * this is the only spelling a column of one takes: Drizzle reads a column
 * declared without the flag by appending a UTC offset to the driver's text,
 * which on a `timestamptz` value would stand on the date parser discarding
 * the second offset rather than on the declared type. `auth.ts`, which
 * Better Auth owns, keeps its own copy of this helper rather than importing
 * one.
 */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();

/**
 * Note that there is no `$onUpdate` here, unlike lobehub's: it would stamp
 * the row from the real clock behind the caller's back, and every writer here
 * sets `updatedAt` itself from the instant its own clock read.
 */
export const updatedAt = () => timestamptz("updated_at").notNull().defaultNow();

/**
 * A column of raw bytes, `bytea`, read and written as a `Uint8Array`: a
 * picture kept beside the row it belongs to, since this deployment keeps no
 * blob store.
 */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});
