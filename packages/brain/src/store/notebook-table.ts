import { randomUUID } from "node:crypto";
import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
import { maximumRememberedFacts } from "@sidecar/actions";
import {
  appendNotebookEntry,
  hashText,
  MEMORY_ORIGIN,
  type MemoryOrigin,
  NOTEBOOK_FILE,
  notebookEntryText,
  parseNotebook,
  removeNotebookEntry,
} from "@sidecar/memory";
import { Data, Effect, Either, Option, Schema } from "effect";
import { BRAIN_WORKSPACE_SEEDS } from "../workspace-seeds.js";
import type { StoreDatabase } from "./database.js";
import { columnsDecoded } from "./rows.js";
import { readWorkspaceFileSync, writeWorkspaceFileSync } from "./workspace-files.js";

/**
 * The notebook's writer. The facts Luke remembers about the developer are
 * lines of USER.md, the human-readable source of truth; the table beside them
 * holds provenance about each line — its id, when it was written, whether it
 * came from the developer's own edit, Luke's tool, or the stable-fact store
 * an earlier build kept — and the file's hash as last reconciled. Every
 * mutation runs here, on the database worker, one at a time: the worker
 * answers one request before it reads the next, so two conversations (or a
 * child) remembering at once cannot read the list, compute, and replace it
 * past each other. Before any write the file is read again and its hash
 * compared with the recorded one, so an edit the developer made by hand is
 * folded into the table rather than overwritten, and the write itself lands
 * whole through a rename. The file reads and writes stay the synchronous
 * calls `workspace-files.ts` still is; only the table beside them moves onto
 * the client here.
 */

/** What a reconcile answers: the entries as they then stand, and the file content it read. */
interface NotebookReconciliation {
  readonly entries: readonly NotebookEntry[];
  readonly content: string;
}

export interface NotebookEntry {
  readonly id: string;
  readonly words: string;
  readonly path: string;
  readonly createdAt: number;
  readonly origin: MemoryOrigin;
  readonly migratedFactId?: string;
}

const EntryRow = Schema.Struct({
  id: Schema.String,
  words: Schema.String,
  path: Schema.String,
  created_at: Schema.Number,
  origin: Schema.String,
  migrated_fact_id: Schema.NullOr(Schema.String),
});

type EntryRow = Schema.Schema.Type<typeof EntryRow>;

const ORIGINS: readonly string[] = Object.values(MEMORY_ORIGIN);

function entryOf(row: EntryRow): NotebookEntry {
  return {
    id: row.id,
    words: row.words,
    path: row.path,
    createdAt: row.created_at,
    // SAFETY: the origin column holds one of the vocabulary's values, written below.
    origin: ORIGINS.includes(row.origin) ? (row.origin as MemoryOrigin) : MEMORY_ORIGIN.UNTRUSTED,
    ...(row.migrated_fact_id ? { migratedFactId: row.migrated_fact_id } : undefined),
  };
}

/** The file as it stands, or the seed it would be given when it does not exist yet. */
function readUserFile(root: string): string {
  return readWorkspaceFileSync(root, NOTEBOOK_FILE.USER, BRAIN_WORKSPACE_SEEDS[NOTEBOOK_FILE.USER]);
}

function writeUserFile(root: string, content: string): void {
  writeWorkspaceFileSync(root, NOTEBOOK_FILE.USER, content);
}

const entryRows = SqlSchema.findAll({
  Request: Schema.String,
  Result: EntryRow,
  execute: (path) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT id, words, path, created_at, origin, migrated_fact_id FROM notebook_entries
            WHERE path = ${path} ORDER BY created_at, rowid`,
    ),
});

const selectEntriesEffect: Effect.Effect<readonly NotebookEntry[], SqlError, Client.SqlClient> =
  Effect.map(columnsDecoded(entryRows(NOTEBOOK_FILE.USER)), (rows) => rows.map(entryOf));

const hashRowAt = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ hash: Schema.String }),
  execute: (path) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT hash FROM notebook_files WHERE path = ${path}`,
    ),
});

const recordedHashEffect: Effect.Effect<string | undefined, SqlError, Client.SqlClient> =
  Effect.map(columnsDecoded(hashRowAt(NOTEBOOK_FILE.USER)), (row) =>
    Option.map(row, ({ hash }) => hash).pipe(Option.getOrUndefined),
  );

const recordHashEffect = (
  hash: string,
  now: number,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`INSERT INTO notebook_files (path, hash, reconciled_at)
          VALUES (${NOTEBOOK_FILE.USER}, ${hash}, ${now})
          ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, reconciled_at = excluded.reconciled_at`,
  ).pipe(Effect.asVoid);

const insertEntryEffect = (
  entry: { id: string; words: string; origin: MemoryOrigin; migratedFactId?: string },
  now: number,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`INSERT INTO notebook_entries (id, words, path, created_at, origin, migrated_fact_id)
          VALUES (${entry.id}, ${entry.words}, ${NOTEBOOK_FILE.USER}, ${now}, ${entry.origin},
                  ${entry.migratedFactId ?? null})`,
  ).pipe(Effect.asVoid);

const deleteEntryEffect = (id: string): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) => sql`DELETE FROM notebook_entries WHERE id = ${id}`,
  ).pipe(Effect.asVoid);

/**
 * Folds the file into the table when the file moved since the table last
 * saw it: a line the table does not know becomes an entry of the developer's
 * own origin under a fresh id, and an entry whose line is gone is dropped.
 * Answers the entries as they then stand and the content that was read.
 */
const reconcileNotebookEffect = (
  root: string,
  now: number,
): Effect.Effect<NotebookReconciliation, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const content = readUserFile(root);
    const hash = hashText(content);
    if ((yield* recordedHashEffect) === hash)
      return { entries: yield* selectEntriesEffect, content };
    const parsed = parseNotebook(content);
    const sql = yield* Client.SqlClient;
    const entries = yield* sql.withTransaction(
      Effect.gen(function* () {
        const held = yield* selectEntriesEffect;
        const words = new Set(parsed.entries.map((entry) => entry.words));
        for (const entry of held) {
          if (!words.has(entry.words)) yield* deleteEntryEffect(entry.id);
        }
        const known = new Set(held.map((entry) => entry.words));
        for (const line of parsed.entries) {
          if (known.has(line.words)) continue;
          known.add(line.words);
          yield* insertEntryEffect(
            { id: randomUUID(), words: line.words, origin: MEMORY_ORIGIN.USER },
            now,
          );
        }
        yield* recordHashEffect(hash, now);
        return yield* selectEntriesEffect;
      }),
    );
    return { entries, content };
  });

export const listNotebookEntriesEffect = (
  root: string,
  now: number,
): Effect.Effect<readonly NotebookEntry[], SqlError, Client.SqlClient> =>
  Effect.map(reconcileNotebookEffect(root, now), (reconciled) => reconciled.entries);

export interface NotebookMutation {
  readonly ok: boolean;
  readonly entries: readonly NotebookEntry[];
  readonly reason?: string;
}

export const NOTEBOOK_REFUSAL = {
  EMPTY: "a memory needs words",
  UNKNOWN_ID: "nothing remembered goes by that id",
  FULL: `Luke already remembers ${maximumRememberedFacts} things; replace or forget one first`,
} as const;

/** Why a notebook write did not land, carrying the entries as they stood when it was refused. */
class NotebookRefusal extends Data.TaggedError("NotebookRefusal")<{
  readonly reason: (typeof NOTEBOOK_REFUSAL)[keyof typeof NOTEBOOK_REFUSAL];
  readonly entries: readonly NotebookEntry[];
}> {}

function notebookMutationOf(
  result: Either.Either<{ entries: readonly NotebookEntry[] }, NotebookRefusal>,
): NotebookMutation {
  return Either.match(result, {
    onLeft: (refusal) => ({ ok: false, entries: refusal.entries, reason: refusal.reason }),
    onRight: ({ entries }) => ({ ok: true, entries }),
  });
}

/**
 * Remembers one thing: a line under USER.md's remembered heading and an
 * entry beside it. Naming an entry to replace removes that line first; words
 * already remembered add nothing; and the list past its bound refuses a new
 * entry rather than cutting one. The rows land first and the file is written
 * inside the same transaction, so a file write that throws rolls the rows
 * back and the caller sees the failure, never an id with no line behind it.
 * The two resources are still two: a commit that fails after the file landed
 * leaves a line with no row, which the next reconcile adopts under a fresh id
 * of the developer's origin, and the caller still sees a failure, not an id.
 */
export const rememberNotebookEntryEffect = (
  root: string,
  ask: { id: string; words: string; replaces?: string },
  now: number,
): Effect.Effect<NotebookMutation, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const words = notebookEntryText(ask.words);
    const current = yield* reconcileNotebookEffect(root, now);
    if (!words)
      return notebookMutationOf(
        Either.left(
          new NotebookRefusal({ reason: NOTEBOOK_REFUSAL.EMPTY, entries: current.entries }),
        ),
      );
    const replaced = ask.replaces
      ? current.entries.find((entry) => entry.id === ask.replaces)
      : undefined;
    if (ask.replaces !== undefined && !replaced) {
      return notebookMutationOf(
        Either.left(
          new NotebookRefusal({ reason: NOTEBOOK_REFUSAL.UNKNOWN_ID, entries: current.entries }),
        ),
      );
    }
    const retained = current.entries.filter((entry) => entry.id !== replaced?.id);
    let content = replaced ? removeNotebookEntry(current.content, replaced.words) : current.content;
    const duplicate = retained.some((entry) => entry.words === words);
    if (!duplicate) {
      if (!replaced && current.entries.length >= maximumRememberedFacts) {
        return notebookMutationOf(
          Either.left(
            new NotebookRefusal({ reason: NOTEBOOK_REFUSAL.FULL, entries: current.entries }),
          ),
        );
      }
      content = appendNotebookEntry(content, words);
    }
    if (content === current.content)
      return notebookMutationOf(Either.right({ entries: current.entries }));
    const sql = yield* Client.SqlClient;
    const entries = yield* sql.withTransaction(
      Effect.gen(function* () {
        if (replaced) yield* deleteEntryEffect(replaced.id);
        if (!duplicate)
          yield* insertEntryEffect({ id: ask.id, words, origin: MEMORY_ORIGIN.AGENT }, now);
        yield* recordHashEffect(hashText(content), now);
        writeUserFile(root, content);
        return yield* selectEntriesEffect;
      }),
    );
    return notebookMutationOf(Either.right({ entries }));
  });

export const forgetNotebookEntryEffect = (
  root: string,
  id: string,
  now: number,
): Effect.Effect<NotebookMutation, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const current = yield* reconcileNotebookEffect(root, now);
    const entry = current.entries.find((candidate) => candidate.id === id);
    if (!entry)
      return notebookMutationOf(
        Either.left(
          new NotebookRefusal({ reason: NOTEBOOK_REFUSAL.UNKNOWN_ID, entries: current.entries }),
        ),
      );
    const content = removeNotebookEntry(current.content, entry.words);
    const sql = yield* Client.SqlClient;
    const entries = yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* deleteEntryEffect(id);
        yield* recordHashEffect(hashText(content), now);
        writeUserFile(root, content);
        return yield* selectEntriesEffect;
      }),
    );
    return notebookMutationOf(Either.right({ entries }));
  });

const personalFactRows = SqlSchema.findAll({
  Request: Schema.Void,
  Result: Schema.Struct({ id: Schema.String, words: Schema.String }),
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT id, words FROM personal_facts ORDER BY ordinal`,
    ),
});

/**
 * Moves the stable facts an earlier build kept in their own table into the
 * notebook, once: each fact becomes a line of USER.md and an entry under the
 * same id it had, so a conversation that still names it finds it, and the
 * old table is emptied in the same transaction that records the entries. A
 * fact whose words the notebook already holds adds no line. Idempotent: a
 * launch that finds the table empty does nothing.
 */
export const migrateFactsIntoNotebookEffect = (
  root: string,
  now: number,
): Effect.Effect<number, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const facts = yield* columnsDecoded(personalFactRows());
    if (facts.length === 0) return 0;
    const current = yield* reconcileNotebookEffect(root, now);
    const known = new Set(current.entries.map((entry) => entry.words));
    let content = current.content;
    const added: { id: string; words: string }[] = [];
    for (const fact of facts) {
      const words = notebookEntryText(fact.words);
      if (!words || known.has(words)) continue;
      known.add(words);
      content = appendNotebookEntry(content, words);
      added.push({ id: fact.id, words });
    }
    const sql = yield* Client.SqlClient;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const fact of added) {
          yield* insertEntryEffect(
            {
              id: fact.id,
              words: fact.words,
              origin: MEMORY_ORIGIN.MIGRATED_FACT,
              migratedFactId: fact.id,
            },
            now,
          );
        }
        yield* sql`DELETE FROM personal_facts`;
        yield* recordHashEffect(hashText(content), now);
        if (content !== current.content) writeUserFile(root, content);
      }),
    );
    return facts.length;
  });

/**
 * The synchronous doors onto the effects above, for the callers that still
 * hold a handle rather than a client: the store's own tests today.
 *
 * @deprecated Each goes with the caller that holds it; P5-11 runs every
 * remaining one on the worker's own runtime edge.
 */
export function listNotebookEntries(
  database: StoreDatabase,
  root: string,
  now: number,
): readonly NotebookEntry[] {
  return database.run(listNotebookEntriesEffect(root, now));
}

/** @deprecated The synchronous door onto {@link rememberNotebookEntryEffect}; see {@link listNotebookEntries}. */
export function rememberNotebookEntry(
  database: StoreDatabase,
  root: string,
  ask: { id: string; words: string; replaces?: string },
  now: number,
): NotebookMutation {
  return database.run(rememberNotebookEntryEffect(root, ask, now));
}

/** @deprecated The synchronous door onto {@link forgetNotebookEntryEffect}; see {@link listNotebookEntries}. */
export function forgetNotebookEntry(
  database: StoreDatabase,
  root: string,
  id: string,
  now: number,
): NotebookMutation {
  return database.run(forgetNotebookEntryEffect(root, id, now));
}

/** @deprecated The synchronous door onto {@link migrateFactsIntoNotebookEffect}; see {@link listNotebookEntries}. */
export function migrateFactsIntoNotebook(
  database: StoreDatabase,
  root: string,
  now: number,
): number {
  return database.run(migrateFactsIntoNotebookEffect(root, now));
}
