import { drizzleOverSqlClient } from "./drizzle.js";

/**
 * The one Drizzle handle every query module renders its statements through.
 *
 * It is a module constant rather than something a caller builds because
 * there is nothing in it to build: the bridge's handle holds no connection,
 * no client, and no context, and reads the `SqlClient` out of the fiber that
 * yields a statement, so one handle serves every request and every dialect
 * at once and two callers have nothing to contend over. No `schema` config,
 * because nothing reaches Drizzle's relational queries: the tables a
 * statement names are imported from their own `db/*-schema.ts` module, which
 * is the import the store-writer boundary reads.
 */
export const db = drizzleOverSqlClient();
