import type { SqliteDatabase, SqliteModuleLoader } from "./local-sqlite.js";
import { openReadOnlyDatabase } from "./local-sqlite.js";

/**
 * Opens candidate SQLite stores read-only, returns the first rendered
 * transcript, and closes every opened handle even when rendering throws.
 */
export async function withSqliteTranscript(
  sqlite: SqliteModuleLoader,
  databasePaths: readonly string[],
  render: (database: SqliteDatabase) => string | undefined,
): Promise<string | undefined> {
  for (const databasePath of databasePaths) {
    const database = await openReadOnlyDatabase(sqlite, databasePath);
    if (!database) continue;
    try {
      const rendered = render(database);
      if (rendered) return rendered;
    } finally {
      database.close();
    }
  }
  return undefined;
}
