import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test } from "vitest";

/**
 * No code path writes a message, a turn, or an event except the store writer:
 * the invariant the writer establishes, stated over the server's own sources.
 * A module that could write one of the three tables has to reach it, and
 * there are two ways to reach one: name it in the text of a statement the
 * `SqlClient` runs, or hold the Drizzle table the query builder renders from,
 * which a module can only come by through an import. So the modules that
 * reach one are the modules that could write one, and that set is the writer
 * and the readers that select from the same tables. Neither a
 * `from`/`join`/`into`/`update` clause nor a held table tells a select from an
 * insert, so each reader stands in the list by name, in the open, and the
 * modules that write are read from the writes themselves — `insert into`,
 * `update`, `delete from`, `truncate`, and the builder's `.insert()`,
 * `.update()`, `.delete()` over a held table — which is the writer alone.
 *
 * Both halves read the module rather than its text. Statement text is taken
 * from the literals a module spells, so prose that happens to say "update
 * turns" is not a write; a held table is taken from the module's imports
 * resolved against the modules that declare the tables, so an alias
 * (`messages as rows`), a namespace (`schema.messages`), and a re-export are
 * each the table they name and nothing launders one. What the sweep cannot
 * follow is a table reached through a bare package specifier or a dynamic
 * import, and a name in `WRITTEN_TABLES` imported from anywhere in the tree
 * is taken as its table for that reason, whatever module handed it over.
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

/** The children module: derives where a child stands from the latest of its turns and its task from its first line, holds a child's open to a message of its parent's, and writes neither table. */
const CHILDREN_READER = "server/hosted/store/children.ts";

/** The agents module: derives where an observed session stands from the latest of its turns, and writes nothing. */
const AGENTS_READER = "server/hosted/store/agents.ts";

/** The abandoned-turns module: lists the turns still running past the bound and settles each through the writer. */
const ABANDONED_TURNS_READER = "server/hosted/store/abandoned-turns.ts";

/** The tables each module reaches at all, in either dialect. */
const TABLES_REACHED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [WRITER, WRITTEN_TABLES],
  [READER, WRITTEN_TABLES],
  [SPEECH_READER, new Set(["messages", "events"])],
  [CHILDREN_READER, new Set(["messages", "turns"])],
  [AGENTS_READER, new Set(["turns"])],
  [ABANDONED_TURNS_READER, new Set(["turns"])],
]);

/** The modules that may write one of the three tables, which is the writer and nothing else. */
const TABLE_WRITERS: ReadonlySet<string> = new Set([WRITER]);

/** A table as a statement spells it: unquoted or quoted, bare or schema-qualified, in any case. */
const STATEMENT_TABLE_NAME = `(?:public\\.)?"?(messages|turns|events)\\b"?`;

/** A statement's write over one of the three tables, and the clauses that merely name one. */
const STATEMENT_WRITE = new RegExp(
  `\\b(?:insert\\s+into|update|delete\\s+from|truncate(?:\\s+table)?)\\s+${STATEMENT_TABLE_NAME}`,
  "gi",
);

const STATEMENT_TABLE = new RegExp(
  `\\b(?:from|join|into|update|truncate(?:\\s+table)?)\\s+${STATEMENT_TABLE_NAME}`,
  "gi",
);

/** Drizzle declares a table with this call, and writes one through these three builders. */
const TABLE_FACTORY = "pgTable";

const BUILDER_WRITES: ReadonlySet<string> = new Set(["insert", "update", "delete"]);

/** What a module reaches: the tables it can name at all, and the tables it writes. */
interface Reach {
  readonly reached: ReadonlySet<string>;
  readonly written: ReadonlySet<string>;
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => path.join(directory, entry));
}

/** The written tables a pattern finds in text, as the statement dialect spells them. */
function matchedTables(text: string, pattern: RegExp): readonly string[] {
  return [...text.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1].toLowerCase()],
  );
}

/** A module specifier as a key of the source set: relative, `.js` as the `.ts` it is emitted from. */
function resolveSpecifier(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  return resolved.replace(/\.js$/, ".ts");
}

/** What an interpolation stands for in scanned text: one character no clause and no table name can be spelled with. */
const HOLE = "\u0000";

/** A template literal as scanned: its text with every interpolation replaced by one `HOLE`, so no clause joins a table across one. */
function templateText(node: ts.TemplateExpression): string {
  return [node.head.text, ...node.templateSpans.map((span) => `${HOLE}${span.literal.text}`)].join(
    "",
  );
}

/** The module specifier of an import or export declaration, when it has one that is a literal. */
function moduleSpecifier(node: ts.ImportDeclaration | ts.ExportDeclaration): string | undefined {
  const specifier = node.moduleSpecifier;
  return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : undefined;
}

/** The table a declaration declares, when it is `pgTable("<name>", …)` over one of the three. */
function declaredTable(declaration: ts.VariableDeclaration): string | undefined {
  const initializer = declaration.initializer;
  if (initializer === undefined || !ts.isCallExpression(initializer)) return undefined;
  const callee = initializer.expression;
  if (!ts.isIdentifier(callee) || callee.text !== TABLE_FACTORY) return undefined;
  const [name] = initializer.arguments;
  if (name === undefined || !ts.isStringLiteral(name) || !WRITTEN_TABLES.has(name.text)) {
    return undefined;
  }
  return name.text;
}

/**
 * The written tables a module exports, by the name it exports each under: the
 * tables it declares plus everything it passes on from another module. A name
 * is followed through `export *` and through a renaming re-export, so the
 * module a table is declared in is not the only module it can be had from.
 */
function exportedTables(
  file: string,
  parsed: ReadonlyMap<string, ts.SourceFile>,
  visiting: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const exported = new Map<string, string>();
  const source = parsed.get(file);
  if (source === undefined || visiting.has(file)) return exported;
  const onward = new Set([...visiting, file]);
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const table = declaredTable(declaration);
        if (table !== undefined && ts.isIdentifier(declaration.name)) {
          exported.set(declaration.name.text, table);
        }
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    const specifier = moduleSpecifier(statement);
    const target = specifier === undefined ? undefined : resolveSpecifier(file, specifier);
    if (target === undefined) continue;
    const onwardTables = exportedTables(target, parsed, onward);
    if (statement.exportClause === undefined) {
      for (const [name, table] of onwardTables) exported.set(name, table);
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const original = (element.propertyName ?? element.name).text;
      const table = onwardTables.get(original);
      if (table !== undefined) exported.set(element.name.text, table);
    }
  }
  return exported;
}

/**
 * The table an argument to a builder call stands for: a local binding of an
 * imported table, or a member of a namespace import that reaches one.
 */
function argumentTable(
  argument: ts.Expression,
  bindings: ReadonlyMap<string, string>,
  namespaces: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string | undefined {
  if (ts.isIdentifier(argument)) return bindings.get(argument.text);
  if (ts.isPropertyAccessExpression(argument) && ts.isIdentifier(argument.expression)) {
    return namespaces.get(argument.expression.text)?.get(argument.name.text);
  }
  return undefined;
}

/** What one module reaches, read from its imports, its literals, and its builder calls. */
function moduleReach(file: string, parsed: ReadonlyMap<string, ts.SourceFile>): Reach {
  const source = parsed.get(file);
  const reached = new Set<string>();
  const written = new Set<string>();
  if (source === undefined) return { reached, written };

  // The tables this module holds, whatever it calls them: one binding per imported table.
  const bindings = new Map<string, string>();
  const namespaces = new Map<string, ReadonlyMap<string, string>>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    const specifier = moduleSpecifier(statement);
    if (clause === undefined || clause.isTypeOnly || specifier === undefined) continue;
    const target = resolveSpecifier(file, specifier);
    const exported = target === undefined ? undefined : exportedTables(target, parsed, new Set());
    const namedBindings = clause.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      if (exported !== undefined && exported.size > 0) {
        namespaces.set(namedBindings.name.text, exported);
      }
      continue;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const original = (element.propertyName ?? element.name).text;
      // Note that a name in WRITTEN_TABLES counts wherever it comes from, because
      // a module the sweep could not resolve must not be a way to launder one.
      const table =
        exported?.get(original) ?? (WRITTEN_TABLES.has(original) ? original : undefined);
      if (table === undefined) continue;
      bindings.set(element.name.text, table);
      reached.add(table);
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const table of matchedTables(node.text, STATEMENT_TABLE)) reached.add(table);
      for (const table of matchedTables(node.text, STATEMENT_WRITE)) written.add(table);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const text = templateText(node);
      for (const table of matchedTables(text, STATEMENT_TABLE)) reached.add(table);
      for (const table of matchedTables(text, STATEMENT_WRITE)) written.add(table);
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      BUILDER_WRITES.has(node.expression.name.text)
    ) {
      const [argument] = node.arguments;
      const table =
        argument === undefined ? undefined : argumentTable(argument, bindings, namespaces);
      if (table !== undefined) written.add(table);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const table = namespaces.get(node.expression.text)?.get(node.name.text);
      if (table !== undefined) reached.add(table);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // A write is a reach: the two assertions cannot disagree about a module that writes.
  for (const table of written) reached.add(table);
  return { reached, written };
}

/** What every module in a source set reaches; a module that reaches nothing is left out. */
function tableReach(sources: ReadonlyMap<string, string>): ReadonlyMap<string, Reach> {
  const parsed = new Map<string, ts.SourceFile>();
  for (const [file, source] of sources) {
    parsed.set(file, ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false));
  }
  const reach = new Map<string, Reach>();
  for (const file of parsed.keys()) {
    const found = moduleReach(file, parsed);
    if (found.reached.size > 0 || found.written.size > 0) reach.set(file, found);
  }
  return reach;
}

/** Every server module, keyed the way the lists above name one. */
async function serverSources(): Promise<ReadonlyMap<string, string>> {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const sources = new Map<string, string>();
  for (const root of SERVER_ROOTS) {
    for (const file of await sourceFiles(root)) {
      const key = path.relative(repositoryRoot, file).split(path.sep).join(path.posix.sep);
      sources.set(key, await readFile(file, "utf8"));
    }
  }
  return sources;
}

/** A reach map as a failure can be read: one module per row in order, its tables in order. */
function readable(
  reach: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    [...reach]
      .map(([file, tables]): [string, readonly string[]] => [file, [...tables].sort()])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

test("the writer and the five readers are the server modules that reach the messages, turns, or events table, and only the writer writes one", async () => {
  const reach = tableReach(await serverSources());
  const reached = new Map([...reach].map(([file, found]) => [file, found.reached]));
  const writers = [...reach]
    .flatMap(([file, found]) => (found.written.size > 0 ? [file] : []))
    .sort();
  assert.deepEqual(readable(reached), readable(TABLES_REACHED));
  assert.deepEqual(writers, [...TABLE_WRITERS].sort());
  assert.deepEqual([...(reach.get(WRITER)?.written ?? [])].sort(), [...WRITTEN_TABLES].sort());
});

/**
 * The detection itself, over modules written to be read rather than run: what
 * it takes for a write and what it passes over, stated in one place so the
 * sweep above is a claim about the server and not about the regular
 * expressions. Every case stands in a source set of its own beside the two
 * schema modules, which is the shape the server's own tree has.
 */
const SCHEMA_SOURCES: ReadonlyMap<string, string> = new Map([
  [
    "server/db/storage-schema.ts",
    `import { pgTable, text, uuid } from "drizzle-orm/pg-core";
     export const conversations = pgTable("conversations", { id: uuid("id") });
     export const messages = pgTable("messages", { id: uuid("id") });
     export const turns = pgTable("turns", { id: uuid("id") });
     export const events = pgTable("events", { id: uuid("id") });`,
  ],
  ["server/db/schema.ts", `export * from "./storage-schema.js";`],
  ["server/db/auth-schema.ts", `export const user = pgTable("user", {});`],
]);

interface DetectionCase {
  readonly name: string;
  readonly source: string;
  readonly reached: readonly string[];
  readonly written: readonly string[];
}

const DETECTION_CASES: readonly DetectionCase[] = [
  {
    name: "a builder insert over an imported table",
    source: `import { messages } from "../db/schema.js";
      export const write = (db) => db.insert(messages).values({ id: "1" });`,
    reached: ["messages"],
    written: ["messages"],
  },
  {
    name: "a builder update over a table imported under another name",
    source: `import { turns as turnRows } from "../db/storage-schema.js";
      export const settle = (db) => db.update(turnRows).set({ status: "done" });`,
    reached: ["turns"],
    written: ["turns"],
  },
  {
    name: "a builder delete over a namespace member",
    source: `import * as schema from "../db/schema.js";
      export const purge = (db) => db.delete(schema.events);`,
    reached: ["events"],
    written: ["events"],
  },
  {
    name: "a builder select and join reach without writing",
    source: `import { messages, turns } from "../db/schema.js";
      export const read = (db) =>
        db.select().from(messages).innerJoin(turns, eq(messages.turnId, turns.id));`,
    reached: ["messages", "turns"],
    written: [],
  },
  {
    name: "a select for update is a lock, not a write",
    source: `import { turns } from "../db/schema.js";
      export const lock = (db) => db.select().from(turns).for("update");`,
    reached: ["turns"],
    written: [],
  },
  {
    name: "a table had through a renaming re-export is still the table",
    source: `import { rows } from "./relay.js";
      export const write = (db) => db.insert(rows).values({});`,
    reached: ["messages"],
    written: ["messages"],
  },
  {
    name: "a type-only import writes nothing",
    source: `import type { messages } from "../db/schema.js";
      export type Row = typeof messages.$inferSelect;`,
    reached: [],
    written: [],
  },
  {
    name: "a raw statement's write",
    source: `export const write = (sql) =>
        sql\`insert into events (user_id, seq) values (\${id}, \${seq})\`;`,
    reached: ["events"],
    written: ["events"],
  },
  {
    name: "a raw statement's write, quoted, qualified, and in upper case",
    source: `export const write = (sql) => sql\`UPDATE public."turns" SET status = 'done'\`;`,
    reached: ["turns"],
    written: ["turns"],
  },
  {
    name: "a raw statement's select",
    source: `export const read = (sql) => sql\`select id from messages where id = \${id}\`;`,
    reached: ["messages"],
    written: [],
  },
  {
    name: "a statement handed over as an unsafe string",
    source: `export const write = (client) => client.unsafe("delete from messages where id = $1", [id]);`,
    reached: ["messages"],
    written: ["messages"],
  },
  {
    name: "prose that says what a statement elsewhere does",
    source: `/** Note that we update turns through the writer, because a status is its own row's. */
      // The caller inserts into messages nowhere; it asks the writer to.
      export const settle = (writer) => writer.settleTurn();`,
    reached: [],
    written: [],
  },
  {
    name: "a local binding that happens to be called events",
    source: `export const send = (batch) => {
        const events = batch.map((one) => one.wire);
        return post(events);
      };`,
    reached: [],
    written: [],
  },
  {
    name: "an interpolation joins no clause to its table",
    source: `export const read = (sql, table) => sql\`select id from \${table} join \${other}messages\`;`,
    reached: [],
    written: [],
  },
];

const RELAY_SOURCE = `export { messages as rows } from "../db/storage-schema.js";`;

test("the detection reads a write in either dialect and passes over what only reads or only says one", () => {
  for (const detection of DETECTION_CASES) {
    const sources = new Map<string, string>([
      ...SCHEMA_SOURCES,
      ["server/store/relay.ts", RELAY_SOURCE],
      ["server/store/subject.ts", detection.source],
    ]);
    const found = tableReach(sources).get("server/store/subject.ts");
    assert.deepEqual(
      [...(found?.reached ?? [])].sort(),
      [...detection.reached].sort(),
      `${detection.name}: tables reached`,
    );
    assert.deepEqual(
      [...(found?.written ?? [])].sort(),
      [...detection.written].sort(),
      `${detection.name}: tables written`,
    );
  }
});
