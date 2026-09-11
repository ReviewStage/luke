import { timestamp } from "drizzle-orm/pg-core";

/**
 * An instant column: `timestamp with time zone`, so the value stored is a
 * point on the timeline and a comparison against now cannot drift with the
 * session's zone. Every instant this rework writes is declared through this
 * one spelling; v1's own `created_at` and `updated_at` columns keep theirs.
 */
export const instant = (name: string) => timestamp(name, { withTimezone: true });
