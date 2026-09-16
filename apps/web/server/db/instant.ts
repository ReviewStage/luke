import { timestamp } from "drizzle-orm/pg-core";

/**
 * An instant column: `timestamp with time zone`, so the value stored is a
 * point on the timeline and a comparison against now cannot drift with the
 * session's zone. Migration 0026 made every instant in the database one, so
 * this is the only spelling a column of one takes: Drizzle reads a column
 * declared without the flag by appending a UTC offset to the driver's text,
 * which on a `timestamptz` value would stand on the date parser discarding
 * the second offset rather than on the declared type. `auth-schema.ts`,
 * which Better Auth owns, keeps its own copy of this helper rather than
 * importing one.
 */
export const instant = (name: string) => timestamp(name, { withTimezone: true });
