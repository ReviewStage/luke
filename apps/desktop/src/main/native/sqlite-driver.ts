import { createRequire } from "node:module";
import type { SqliteDatabase, SqliteDriverSeam } from "@repo/host/effect";
import { nativeHelperPath } from "./native-helper";

/**
 * sqlite-driver.ts -- the encrypted SQLite the host's entity store keeps the account's lists in (`@repo/host/effect`'s `SqliteDriver`): `better-sqlite3-multiple-ciphers`, opened over the file the store names.
 *
 * The package's folder (`scripts/package-layout.mjs`'s `SQLITE_DRIVER`) is
 * loaded from beside the helpers rather than bundled, since its JavaScript
 * finds its N-API addon from its own folder. It is loaded at the first open
 * rather than at launch, so a build whose addon will not load fails that
 * open, which the store reports by its kind and answers by keeping the lists
 * in memory, and the launch goes on.
 */

/** The package's folder beside the helpers. */
const SQLITE_DRIVER_FOLDER = "better-sqlite3-multiple-ciphers";

/** The driver's constructor, as the store opens a database with it. */
type SqliteConstructor = new (file: string) => SqliteDatabase;

let driver: SqliteConstructor | undefined;

/** This Mac's SQLite, loaded once at its first open; an open throws where it cannot load. */
export const sqliteDriver: SqliteDriverSeam = {
  open: (file) => {
    // SAFETY: the folder is `better-sqlite3-multiple-ciphers`, whose export is the constructor `SqliteDatabase` names part of.
    driver ??= createRequire(__filename)(
      nativeHelperPath(SQLITE_DRIVER_FOLDER),
    ) as SqliteConstructor;
    return new driver(file);
  },
};
