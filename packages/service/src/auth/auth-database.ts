import { type DB, drizzleAdapter } from "@better-auth/drizzle-adapter";
import * as schema from "@repo/database/schemas/auth";
import { drizzle, type NodePgClient } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { getPool } from "../db/index.js";

export function authDatabaseAdapter(database: DB) {
  return drizzleAdapter(database, { provider: "pg", schema });
}

class LazyPool {
  query(...args: Parameters<Pool["query"]>): ReturnType<Pool["query"]> {
    return getPool().query(...args);
  }

  connect(): Promise<PoolClient> {
    return getPool().connect();
  }
}

const lazyPool = new LazyPool() as NodePgClient;

export const authDatabase = drizzle({ client: lazyPool });
