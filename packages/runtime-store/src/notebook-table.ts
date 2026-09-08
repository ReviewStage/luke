import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { maximumRememberedFacts } from "@sidecar/acts";
import { BRAIN_WORKSPACE_SEEDS } from "@sidecar/brain";
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
import type { RuntimeDatabase } from "./database.js";

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
 * whole through a rename.
 */

/** What a reconcile answers: the entries as they then stand, and the file content it read. */
export interface NotebookReconciliation {
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

type EntryRow = {
  id: string;
  words: string;
  path: string;
  created_at: number;
  origin: string;
  migrated_fact_id: string | null;
};

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

function userFile(root: string): string {
  return path.join(root, NOTEBOOK_FILE.USER);
}

/** The file as it stands, or the seed it would be given when it does not exist yet. */
function readUserFile(root: string): string {
  try {
    return fs.readFileSync(userFile(root), "utf8");
  } catch (error) {
    // SAFETY: fs throws an ErrnoException; only its code is read, and any other error is rethrown.
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return BRAIN_WORKSPACE_SEEDS[NOTEBOOK_FILE.USER];
    throw error;
  }
}

function writeUserFile(root: string, content: string): void {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = userFile(root);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function selectEntries(database: RuntimeDatabase): readonly NotebookEntry[] {
  // SAFETY: the columns selected are the ones the row type names.
  const rows = database
    .prepare(
      `SELECT id, words, path, created_at, origin, migrated_fact_id FROM notebook_entries
       WHERE path = ? ORDER BY created_at, rowid`,
    )
    .all(NOTEBOOK_FILE.USER) as EntryRow[];
  return rows.map(entryOf);
}

function recordedHash(database: RuntimeDatabase): string | undefined {
  // SAFETY: the one text column selected is the hash.
  const row = database
    .prepare("SELECT hash FROM notebook_files WHERE path = ?")
    .get(NOTEBOOK_FILE.USER) as { hash: string } | undefined;
  return row?.hash;
}

function recordHash(database: RuntimeDatabase, hash: string, now: number): void {
  database
    .prepare(
      `INSERT INTO notebook_files (path, hash, reconciled_at) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, reconciled_at = excluded.reconciled_at`,
    )
    .run(NOTEBOOK_FILE.USER, hash, now);
}

function insertEntry(
  database: RuntimeDatabase,
  entry: { id: string; words: string; origin: MemoryOrigin; migratedFactId?: string },
  now: number,
): void {
  database
    .prepare(
      `INSERT INTO notebook_entries (id, words, path, created_at, origin, migrated_fact_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.id,
      entry.words,
      NOTEBOOK_FILE.USER,
      now,
      entry.origin,
      entry.migratedFactId ?? null,
    );
}

/**
 * Folds the file into the table when the file moved since the table last
 * saw it: a line the table does not know becomes an entry of the developer's
 * own origin under a fresh id, and an entry whose line is gone is dropped.
 * Answers the entries as they then stand and the content that was read.
 */
export function reconcileNotebook(
  database: RuntimeDatabase,
  root: string,
  now: number,
): NotebookReconciliation {
  const content = readUserFile(root);
  const hash = hashText(content);
  if (recordedHash(database) === hash) return { entries: selectEntries(database), content };
  const parsed = parseNotebook(content);
  const entries = database.transaction(() => {
    const held = selectEntries(database);
    const words = new Set(parsed.entries.map((entry) => entry.words));
    for (const entry of held) {
      if (!words.has(entry.words)) {
        database.prepare("DELETE FROM notebook_entries WHERE id = ?").run(entry.id);
      }
    }
    const known = new Set(held.map((entry) => entry.words));
    for (const line of parsed.entries) {
      if (known.has(line.words)) continue;
      known.add(line.words);
      insertEntry(
        database,
        { id: randomUUID(), words: line.words, origin: MEMORY_ORIGIN.USER },
        now,
      );
    }
    recordHash(database, hash, now);
    return selectEntries(database);
  });
  return { entries, content };
}

export function listNotebookEntries(
  database: RuntimeDatabase,
  root: string,
  now: number,
): readonly NotebookEntry[] {
  return reconcileNotebook(database, root, now).entries;
}

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
export function rememberNotebookEntry(
  database: RuntimeDatabase,
  root: string,
  ask: { id: string; words: string; replaces?: string },
  now: number,
): NotebookMutation {
  const words = notebookEntryText(ask.words);
  const current = reconcileNotebook(database, root, now);
  if (!words) return { ok: false, entries: current.entries, reason: NOTEBOOK_REFUSAL.EMPTY };
  const replaced = ask.replaces
    ? current.entries.find((entry) => entry.id === ask.replaces)
    : undefined;
  if (ask.replaces !== undefined && !replaced) {
    return { ok: false, entries: current.entries, reason: NOTEBOOK_REFUSAL.UNKNOWN_ID };
  }
  const retained = current.entries.filter((entry) => entry.id !== replaced?.id);
  let content = replaced ? removeNotebookEntry(current.content, replaced.words) : current.content;
  const duplicate = retained.some((entry) => entry.words === words);
  if (!duplicate) {
    if (!replaced && current.entries.length >= maximumRememberedFacts) {
      return { ok: false, entries: current.entries, reason: NOTEBOOK_REFUSAL.FULL };
    }
    content = appendNotebookEntry(content, words);
  }
  if (content === current.content) return { ok: true, entries: current.entries };
  const entries = database.transaction(() => {
    if (replaced) database.prepare("DELETE FROM notebook_entries WHERE id = ?").run(replaced.id);
    if (!duplicate) insertEntry(database, { id: ask.id, words, origin: MEMORY_ORIGIN.AGENT }, now);
    recordHash(database, hashText(content), now);
    writeUserFile(root, content);
    return selectEntries(database);
  });
  return { ok: true, entries };
}

export function forgetNotebookEntry(
  database: RuntimeDatabase,
  root: string,
  id: string,
  now: number,
): NotebookMutation {
  const current = reconcileNotebook(database, root, now);
  const entry = current.entries.find((candidate) => candidate.id === id);
  if (!entry) return { ok: false, entries: current.entries, reason: NOTEBOOK_REFUSAL.UNKNOWN_ID };
  const content = removeNotebookEntry(current.content, entry.words);
  const entries = database.transaction(() => {
    database.prepare("DELETE FROM notebook_entries WHERE id = ?").run(id);
    recordHash(database, hashText(content), now);
    writeUserFile(root, content);
    return selectEntries(database);
  });
  return { ok: true, entries };
}

/**
 * Moves the stable facts an earlier build kept in their own table into the
 * notebook, once: each fact becomes a line of USER.md and an entry under the
 * same id it had, so a conversation that still names it finds it, and the
 * old table is emptied in the same transaction that records the entries. A
 * fact whose words the notebook already holds adds no line. Idempotent: a
 * launch that finds the table empty does nothing.
 */
export function migrateFactsIntoNotebook(
  database: RuntimeDatabase,
  root: string,
  now: number,
): number {
  // SAFETY: the two text columns selected are the ones the row type names.
  const facts = database.prepare("SELECT id, words FROM personal_facts ORDER BY ordinal").all() as {
    id: string;
    words: string;
  }[];
  if (facts.length === 0) return 0;
  const current = reconcileNotebook(database, root, now);
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
  database.transaction(() => {
    for (const fact of added) {
      insertEntry(
        database,
        {
          id: fact.id,
          words: fact.words,
          origin: MEMORY_ORIGIN.MIGRATED_FACT,
          migratedFactId: fact.id,
        },
        now,
      );
    }
    database.exec("DELETE FROM personal_facts");
    recordHash(database, hashText(content), now);
    if (content !== current.content) writeUserFile(root, content);
  });
  return facts.length;
}
