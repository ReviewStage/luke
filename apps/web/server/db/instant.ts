import { timestamp } from "drizzle-orm/pg-core";

/**
 * An instant column: `timestamp with time zone`, so the value stored is a
 * point on the timeline and a comparison against now cannot drift with the
 * session's zone. Every instant this rework writes is declared through this
 * one spelling; the tables that predate it keep their own `created_at` and
 * `updated_at` spellings.
 */
export const instant = (name: string) => timestamp(name, { withTimezone: true });
