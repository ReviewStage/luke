import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

/**
 * No code path writes a message, a turn, or an event except the store writer:
 * the invariant the writer establishes, stated over the server's own sources.
 * A module that could write one of the three tables has to name it in the
 * text of a statement the `SqlClient` runs, so the modules that name one are
 * the modules that could write one, and that set is the writer and the two
 * readers that select from the same tables. A `from`/`join`/`into`/`update`
 * clause does not tell a select from an insert, so each reader stands in the
 * list by name, in the open, and the modules that write are read from the
 * writes themselves, which is the writer alone.
 */

/** Every server module lives under `server/`; the functions Vercel deploys are emitted from it and nothing is committed under `api/`. */
const SERVER_ROOTS = ["server"].map((root) =>
  fileURLToPath(new URL(`../${root}/`, import.meta.url)),
);

const WRITTEN_TABLES: ReadonlySet<string> = new Set(["messages", "turns", "events"]);

const WRITER = "server/hosted/store/writer.ts";

/** The read module: the cursor reads and the rating's authorship and latest-rating reads select from the three tables and insert into none. */
const READER = "server/hosted/store/message-reads.ts";

/** The speech module: folds a briefing's standing from the events on its message and writes every transition through the writer. */
const SPEECH_READER = "server/hosted/store/speech.ts";

/** The tables each module names at all. */
const TABLES_NAMED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [WRITER, WRITTEN_TABLES],
  [READER, WRITTEN_TABLES],
  [SPEECH_READER, new Set(["messages", "events"])],
]);

/** The modules that may write one of the three tables, which is the writer and nothing else. */
const TABLE_WRITERS: ReadonlySet<string> = new Set([WRITER]);

/** A statement's write over one of the three tables, and the clauses that merely name one. */
const STATEMENT_WRITE = /\b(?:insert\s+into|update|delete\s+from)\s+(messages|turns|events)\b/g;

const STATEMENT_TABLE = /\b(?:from|join|into|update)\s+(messages|turns|events)\b/g;

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => path.join(directory, entry));
}

/** The written tables a pattern finds in a module's statements. */
function matchedTables(source: string, pattern: RegExp): readonly string[] {
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

test("the writer and the two readers are the server modules that name the messages, turns, or events table, and only the writer writes one", async () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const named = new Map<string, ReadonlySet<string>>();
  const writers = new Set<string>();
  for (const root of SERVER_ROOTS) {
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, "utf8");
      const relative = path.relative(repositoryRoot, file);
      const tables = matchedTables(source, STATEMENT_TABLE);
      if (tables.length > 0) named.set(relative, new Set(tables));
      if (matchedTables(source, STATEMENT_WRITE).length > 0) {
        writers.add(relative);
      }
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
});
