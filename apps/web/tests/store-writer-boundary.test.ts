import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

/**
 * No code path writes a message, a turn, or an event except the store writer:
 * the invariant the writer establishes, stated over the server's import graph.
 * A module that could write one of the three tables has to import it from the
 * schema by name, so the set of server modules that do is the set that could
 * write, and that set is the writer and the one reader that selects from
 * the same three tables. The import graph cannot tell a select from an
 * insert, so the reader stands in the list by name, in the open, beside the
 * statement that it writes none of them. The aggregate schema module
 * re-exports them for the query builder and imports nothing, and another
 * reader that lands later joins this list the same way.
 */

const SERVER_ROOTS = ["server", "api"].map((root) =>
  fileURLToPath(new URL(`../${root}/`, import.meta.url)),
);

const WRITTEN_TABLES: ReadonlySet<string> = new Set(["messages", "turns", "events"]);

const WRITER = "server/hosted/store/writer.ts";

/** The read module: the cursor reads and the rating's authorship and latest-rating reads select from the three tables and insert into none. */
const READER = "server/hosted/store/message-reads.ts";

const TABLE_IMPORTERS: ReadonlySet<string> = new Set([WRITER, READER]);

const WRITE_STATEMENT = /\.(insert|update|delete)\(\s*(messages|turns|events)\s*\)/;

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

test("the writer and the reader are the two server modules that import the messages, turns, or events table, only the writer writes them, and the schema is imported whole by the two that build queries over it", async () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const importers = new Map<string, readonly string[]>();
  const namespaceImporters = new Set<string>();
  for (const root of SERVER_ROOTS) {
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, "utf8");
      const relative = path.relative(repositoryRoot, file);
      const tables = importedTables(source);
      if (tables.length > 0) importers.set(relative, tables);
      if (importsSchemaNamespace(source)) namespaceImporters.add(relative);
    }
  }
  assert.deepEqual(new Set(importers.keys()), TABLE_IMPORTERS);
  assert.deepEqual(new Set(importers.get(WRITER)), WRITTEN_TABLES);
  assert.deepEqual(new Set(importers.get(READER)), WRITTEN_TABLES);
  const reader = await readFile(path.join(repositoryRoot, READER), "utf8");
  assert.equal(WRITE_STATEMENT.test(reader), false);
  assert.deepEqual(namespaceImporters, SCHEMA_NAMESPACE_IMPORTERS);
});
