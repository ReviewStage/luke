import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

/**
 * No code path writes a message, a turn, or an event except the store writer:
 * the invariant the writer establishes, stated over the server's own sources.
 * A module that could write one of the three tables has to name it — as a
 * Drizzle table imported from the schema, or in the text of a statement the
 * `SqlClient` runs — so the modules that name one are the modules that could
 * write one, and that set is the writer and the two readers that select from
 * the same tables. Neither a Drizzle import nor a statement's `from` clause
 * tells a select from an insert, so each reader stands in the list by name,
 * in the open, and the modules that write are read from the writes
 * themselves, which is the writer alone. The
 * aggregate schema module re-exports the tables for the query builder and
 * imports nothing, and another reader that lands later joins this list the
 * same way.
 */

const SERVER_ROOTS = ["server", "api"].map((root) =>
  fileURLToPath(new URL(`../${root}/`, import.meta.url)),
);

const WRITTEN_TABLES: ReadonlySet<string> = new Set(["messages", "turns", "events"]);

const WRITER = "server/hosted/store/writer.ts";

/** The read module: the cursor reads and the rating's authorship and latest-rating reads select from the three tables and insert into none. */
const READER = "server/hosted/store/message-reads.ts";

/** The speech module: folds a briefing's standing from the events on its message and writes every transition through the writer. */
const SPEECH_READER = "server/hosted/store/speech.ts";

/** The tables each module names at all, whichever half of the store's migration it is on. */
const TABLES_NAMED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [WRITER, WRITTEN_TABLES],
  [READER, WRITTEN_TABLES],
  [SPEECH_READER, new Set(["messages", "events"])],
]);

/** The modules that may write one of the three tables, which is the writer and nothing else. */
const TABLE_WRITERS: ReadonlySet<string> = new Set([WRITER]);

/** A Drizzle write over one of the three tables. */
const DRIZZLE_WRITE = /\.(insert|update|delete)\(\s*(messages|turns|events)\s*\)/;

/** A statement's write over one of the three tables, and the clauses that merely name one. */
const STATEMENT_WRITE = /\b(?:insert\s+into|update|delete\s+from)\s+(messages|turns|events)\b/g;

const STATEMENT_TABLE = /\b(?:from|join|into|update)\s+(messages|turns|events)\b/g;

/**
 * The modules that import the whole schema as a namespace, which reaches
 * every table at once: the two that hand it to the query builder. A third
 * joins this list by name or fails here.
 */
const SCHEMA_NAMESPACE_IMPORTERS: ReadonlySet<string> = new Set([
  "server/auth.ts",
  "server/db/index.ts",
]);

const SCHEMA_MODULE = /(?:^|\/)(?:storage-)?schema\.js$/;

const IMPORT_STATEMENT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g;

const NAMESPACE_IMPORT_STATEMENT = /import\s+(type\s+)?\*\s+as\s+\w+\s+from\s*"([^"]+)"/g;

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => path.join(directory, entry));
}

/** Whether a module imports a schema module whole, as a namespace, type imports aside. */
function importsSchemaNamespace(source: string): boolean {
  for (const match of source.matchAll(NAMESPACE_IMPORT_STATEMENT)) {
    const [, typeOnly, specifier] = match;
    if (typeOnly === undefined && specifier !== undefined && SCHEMA_MODULE.test(specifier)) {
      return true;
    }
  }
  return false;
}

/** The written tables a module imports from the schema by name, type imports aside. */
function importedTables(source: string): readonly string[] {
  const tables: string[] = [];
  for (const match of source.matchAll(IMPORT_STATEMENT)) {
    const [, typeOnly, names, specifier] = match;
    if (typeOnly !== undefined || specifier === undefined || !SCHEMA_MODULE.test(specifier))
      continue;
    for (const name of (names ?? "").split(",")) {
      const imported = name.trim().replace(/\s+as\s+\w+$/, "");
      if (imported.startsWith("type ")) continue;
      if (WRITTEN_TABLES.has(imported)) tables.push(imported);
    }
  }
  return tables;
}

/** The written tables a pattern finds in a module's statements. */
function matchedTables(source: string, pattern: RegExp): readonly string[] {
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

test("the writer and the two readers are the server modules that name the messages, turns, or events table, only the writer writes one, and the schema is imported whole by the two that build queries over it", async () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const named = new Map<string, ReadonlySet<string>>();
  const writers = new Set<string>();
  const namespaceImporters = new Set<string>();
  for (const root of SERVER_ROOTS) {
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, "utf8");
      const relative = path.relative(repositoryRoot, file);
      const tables = [...importedTables(source), ...matchedTables(source, STATEMENT_TABLE)];
      if (tables.length > 0) named.set(relative, new Set(tables));
      if (DRIZZLE_WRITE.test(source) || matchedTables(source, STATEMENT_WRITE).length > 0) {
        writers.add(relative);
      }
      if (importsSchemaNamespace(source)) namespaceImporters.add(relative);
    }
  }
  assert.deepEqual(named, TABLES_NAMED);
  assert.deepEqual(writers, TABLE_WRITERS);
  assert.deepEqual(
    new Set(
      matchedTables(await readFile(path.join(repositoryRoot, WRITER), "utf8"), STATEMENT_WRITE),
    ),
    WRITTEN_TABLES,
  );
  assert.deepEqual(namespaceImporters, SCHEMA_NAMESPACE_IMPORTERS);
});
