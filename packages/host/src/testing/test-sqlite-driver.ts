/**
 * test-sqlite-driver.ts -- the encrypted SQLite the desktop hands the entity store (`SqliteDriver`), loaded from this workspace's own install, and a driver that cannot load, for the stores a test opens.
 */

import { createRequire } from "node:module";
import type { SqliteDatabase, SqliteDriverSeam } from "../entity-store.js";

/** The driver's constructor, as the store opens a database with it. */
type SqliteConstructor = new (file: string) => SqliteDatabase;

/** `better-sqlite3-multiple-ciphers` as the desktop opens it. */
export function testSqliteDriver(): SqliteDriverSeam {
  // SAFETY: the package's export is the constructor `SqliteDatabase` names part of.
  const Driver = createRequire(import.meta.url)(
    "better-sqlite3-multiple-ciphers",
  ) as SqliteConstructor;
  return { open: (file) => new Driver(file) };
}

/** A driver whose addon did not load, as a build packaged for another architecture's. */
export function unloadableSqliteDriver(): SqliteDriverSeam {
  return {
    open: () => {
      throw Object.assign(new Error("the addon did not load"), { code: "ERR_DLOPEN_FAILED" });
    },
  };
}
