/**
 * entity-store.ts -- the account's lists kept on disk between launches, a row each in an encrypted SQLite database whose key the Keychain seals: what each kept read last answered, read back at the next launch so the lists draw before the service answers.
 *
 * Only the reads `KEPT_READ` names are kept, and each as the service
 * answered it, never with a write drawn over it: the task list's plans and
 * agents with the sync id they were read at, which its follow reads past,
 * the sidebar's sections, the tasks and agents in them, and its pinned
 * repositories, the account's workspaces with their GitHub installations,
 * and, for each workspace a window followed them in, its members and those
 * who left, its pending invitations with the origin their accept links are
 * built on, and its automations with their latest runs. None of them holds
 * a credential, and an automation's row holds no webhook's body or secret. Every other read the host
 * holds stays in memory, among them transcripts, the inbox, descriptions, pages,
 * comments, browser tabs, Mac commands, Terminal bytes, pictures, devices,
 * and every credential's standing.
 *
 * The database is `entities.db` beside `settings.json`, with its write-ahead
 * log beside it, opened through `better-sqlite3-multiple-ciphers`, which the
 * shell hands the host (`SqliteDriver`). The whole file and its log are
 * encrypted by SQLite3 Multiple Ciphers' default cipher, ChaCha20-Poly1305,
 * under a random 256-bit key minted once and kept only sealed by the account
 * source's cipher, which on a Mac is the Keychain's (`safeStorage`), in
 * `entities.key`; a host whose source hands no cipher, or no driver, as a
 * browser tab's, keeps none. Inside the file the rows are plain, a table of
 * them keyed by read, workspace, part, and row id (`kept_row`), each row the
 * JSON its schema encodes it to, beside the fields of each read that are not
 * rows (`kept_read`), as the task list's sync id, and a table naming the
 * account it was kept for and a hash of the row shapes it was kept at
 * (`meta`). A database of another account is emptied before anything reads
 * it, and one of another build's shapes loses its rows; one that will not
 * open with its key, or is no database, is deleted and made again, and every
 * read reads whole. One the driver cannot open at all is left as it stands,
 * reported by its kind, and the host keeps its lists in the sealed file's
 * store instead (`sealed-entity-store.ts`). Which of the two opens is the
 * deployment's rollout's to say (`entity-store-rollout.ts`).
 *
 * A store writes at most every `FLUSH_EVERY`, in one transaction, only the
 * rows that moved since it last wrote: a kept read is laid against what was
 * written of it, row by row, by the very object first and by its value
 * after, so an answer that moved one row writes that row. Rows kept where
 * none of them moved but where they stand (`keepUnmoved`), as the task
 * list's sync id moving alone, are written only beside the next write of
 * something that moved, and as the store closes; a sign-out forgets it,
 * which deletes the database, its log, and its key. Note that a database
 * left behind at an older sync id reads right, because a read past an id
 * answers every row that moved since it, and the rows kept at that id are
 * the very rows the service held there.
 *
 * Beside the lists it keeps the row writes made while the service could not
 * be reached, as the sync engine hands them out (`EntityPool.queued`) and
 * takes them back at the next launch (`requeue`): a row each (`queued_write`)
 * keyed by its idempotency key, holding the write's name and its input,
 * written as it is queued and deleted as the service takes it, but only
 * once the composer says the pool holds those the store handed back
 * (`requeued`), so a launch that lays them back late never deletes them. They are the
 * account's own, so they outlast a build of other row shapes where they still
 * read, and leave with the database at a sign-out.
 *
 * The sealed store kept the same in one file, `entities.sealed`
 * (`sealed-entity-store.ts`), as every build before this one did and as a Mac
 * still does while the deployment's rollout leaves this store off
 * (`entity-store-rollout.ts`). This store takes that file once for each
 * content it holds, as its SHA-256 names it in `meta`: its rows, where it is
 * this account's at these shapes, and its waiting writes, where it is this
 * account's, in one transaction, which a launch takes again where it does not
 * commit. The file is kept beside the database through
 * `SEALED_KEPT_LAUNCHES`, so a Mac the rollout turns back off reads its lists
 * where it left them, and deleted after; one that is another account's or
 * will not open is deleted at once, as the sealed store deletes it.
 */

import { automationsLiveRowsSchema } from "@repo/features/automation-live";
import { taskListLiveRowsSchema } from "@repo/features/task-list-live";
import {
  agentSectionEntrySchema,
  taskSectionEntrySchema,
  taskSectionSchema,
} from "@repo/features/task-section-wire";
import { repositoryPinSchema } from "@repo/features/task-wire";
import {
  workspaceInvitationsLiveRowsSchema,
  workspaceMembersLiveRowsSchema,
} from "@repo/features/workspace-live";
import { workspaceSchema } from "@repo/features/workspace-wire";
import { reportUnexpected } from "@repo/runtime/effect";
import type { QueuedEntry } from "@repo/sync";
import {
  Data,
  Deferred,
  Duration,
  Effect,
  Equal,
  Path,
  Result,
  Schedule,
  Schema,
  type Scope,
  Semaphore,
} from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import { readSettingsFileText, writeSettingsFileAtomic } from "./effect/settings-store-io.js";
import type { SecretCipher } from "./settings-store.js";

/** The database, beside the settings file in the state root. */
export const ENTITY_DATABASE_FILE_NAME = "entities.db";

/** The database's key, sealed by the account source's cipher, beside it. */
export const ENTITY_KEY_FILE_NAME = "entities.key";

/** The sealed file the sealed store keeps the lists in (`sealed-entity-store.ts`), which this store takes and deletes after `SEALED_KEPT_LAUNCHES`. */
export const ENTITY_SEALED_FILE_NAME = "entities.sealed";

/** Whether the rollout last kept this store on, and for which account (`entity-store-rollout.ts`), beside the database. */
export const ENTITY_ROLLOUT_FILE_NAME = "entities.rollout";

/** The files SQLite keeps beside the database in write-ahead mode. */
const DATABASE_SIDE_FILES = ["-wal", "-shm"] as const;

/** How often, at most, a store writes what moved. */
const FLUSH_EVERY = Duration.seconds(1);

/** How long a statement waits on a lock another connection holds before it fails. */
const BUSY_TIMEOUT_MS = 5_000;

/** The schema this build reads and writes, as SQLite's `user_version` names it. */
const SCHEMA_VERSION = 1;

/** The bytes of the database's key, written as hex. */
const KEY_BYTES = 32;

/** A key as `entities.key` holds it once opened. */
const KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The tables, each `WITHOUT ROWID` since each is read and written by its
 * key alone. `ord` keeps a part's rows in the order the read answered them;
 * `seq` keeps the waiting writes oldest first.
 */
const SCHEMA = `
CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE kept_read (
  read TEXT NOT NULL, scope TEXT NOT NULL, fields TEXT NOT NULL,
  PRIMARY KEY (read, scope)
) WITHOUT ROWID;
CREATE TABLE kept_row (
  read TEXT NOT NULL, scope TEXT NOT NULL, part TEXT NOT NULL, id TEXT NOT NULL,
  ord INTEGER NOT NULL, row TEXT NOT NULL,
  PRIMARY KEY (read, scope, part, id)
) WITHOUT ROWID;
CREATE TABLE queued_write (
  key TEXT PRIMARY KEY, seq INTEGER NOT NULL, name TEXT NOT NULL, input TEXT NOT NULL
) WITHOUT ROWID;
`;

/** What `meta` names: whose the database is, the shapes it keeps, and the sealed file it took, by its SHA-256, and through how many launches it has kept it since. */
const META = {
  ACCOUNT_ID: "accountId",
  SHAPES_HASH: "shapesHash",
  SEALED_HASH: "sealedHash",
  SEALED_LAUNCHES: "sealedLaunches",
} as const;

/**
 * How many launches a sealed file the database took is kept beside it before
 * it is deleted, so a Mac the rollout turns back off finds its lists where the
 * sealed store reads them.
 */
const SEALED_KEPT_LAUNCHES = 3;

/** The reads whose rows are kept on disk, and the only ones: a read not named here stays in memory. */
export const KEPT_READ = {
  TASK_LIST: "taskList",
  SIDEBAR: "sidebar",
  WORKSPACES: "workspaces",
  MEMBERS: "members",
  INVITATIONS: "invitations",
  AUTOMATIONS: "automations",
} as const;

export type KeptRead = (typeof KEPT_READ)[keyof typeof KEPT_READ];

/** The kept reads held per workspace, each workspace's rows under its id. */
export type KeptByWorkspace =
  | typeof KEPT_READ.MEMBERS
  | typeof KEPT_READ.INVITATIONS
  | typeof KEPT_READ.AUTOMATIONS;

/** The lists of rows within a read's value, each written a row apiece. */
const PART = {
  PLANS: "plans",
  AGENTS: "agents",
  SECTIONS: "sections",
  ENTRIES: "entries",
  AGENT_ENTRIES: "agentEntries",
  PINS: "pins",
  WORKSPACES: "workspaces",
  MEMBERS: "members",
  FORMER: "former",
  INVITATIONS: "invitations",
  AUTOMATIONS: "automations",
} as const;

type Part = (typeof PART)[keyof typeof PART];

/** The scope of a read of the account as a whole, which a read kept per workspace names its workspace in. */
const ACCOUNT_SCOPE = "";

/** Each kept read's rows as the store keeps them: what its follow last answered, the task list's with the sync id it was read at. */
const keptRowsSchema = Schema.Struct({
  [KEPT_READ.TASK_LIST]: Schema.Struct({ rows: taskListLiveRowsSchema, at: Schema.String }),
  [KEPT_READ.SIDEBAR]: Schema.Struct({
    sections: Schema.Array(taskSectionSchema),
    entries: Schema.Array(taskSectionEntrySchema),
    agentEntries: Schema.Array(agentSectionEntrySchema),
    pins: Schema.Array(repositoryPinSchema),
  }),
  [KEPT_READ.WORKSPACES]: Schema.Array(workspaceSchema),
  [KEPT_READ.MEMBERS]: Schema.Record(Schema.String, workspaceMembersLiveRowsSchema),
  [KEPT_READ.INVITATIONS]: Schema.Record(
    Schema.String,
    Schema.Struct({
      origin: Schema.String,
      invitations: workspaceInvitationsLiveRowsSchema.fields.invitations,
    }),
  ),
  [KEPT_READ.AUTOMATIONS]: Schema.Record(Schema.String, automationsLiveRowsSchema),
});

/** Each kept read's rows, as a read hands them to the store and takes them back. */
export type KeptRows = typeof keptRowsSchema.Type;

/** A row write waiting for the service, as the engine hands it out: its name, its key, and its input in its declaration's kept form. */
export const queuedEntrySchema = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  input: Schema.Unknown,
});

/** Every read's rows, each optional, since a read that never answered keeps nothing. */
export const keptReadsSchema = Schema.Struct({
  [KEPT_READ.TASK_LIST]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.TASK_LIST]),
  [KEPT_READ.SIDEBAR]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.SIDEBAR]),
  [KEPT_READ.WORKSPACES]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.WORKSPACES]),
  [KEPT_READ.MEMBERS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.MEMBERS]),
  [KEPT_READ.INVITATIONS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.INVITATIONS]),
  [KEPT_READ.AUTOMATIONS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.AUTOMATIONS]),
});

/** The sealed file of a build before the database, opened as far as its account and its waiting writes, whatever shapes its rows were kept at. */
const envelopeSchema = Schema.Struct({
  hash: Schema.String,
  accountId: Schema.String,
  reads: Schema.Unknown,
  queue: Schema.optionalKey(Schema.Array(queuedEntrySchema)),
});

type Envelope = typeof envelopeSchema.Type;

const decodeEnvelope = Schema.decodeUnknownResult(Schema.fromJsonString(envelopeSchema));
const decodeReads = Schema.decodeUnknownResult(keptReadsSchema);

/** A prepared statement as the store runs it, each row it reads decoded at the boundary. */
export interface SqliteStatement {
  run(...parameters: readonly (string | number)[]): unknown;
  get(...parameters: readonly (string | number)[]): unknown;
  all(...parameters: readonly (string | number)[]): unknown[];
}

/** A database as the driver opens it: the part of `better-sqlite3-multiple-ciphers`'s the store runs. */
export interface SqliteDatabase {
  prepare(source: string): SqliteStatement;
  transaction(run: () => void): () => void;
  exec(source: string): unknown;
  pragma(source: string, options?: { readonly simple?: boolean }): unknown;
  close(): unknown;
}

/** A row of `meta`, of `kept_read`, of `kept_row`, and of `queued_write`, as a statement reads it. */
const metaRowSchema = Schema.Struct({ value: Schema.String });
const readRowSchema = Schema.Struct({
  read: Schema.String,
  scope: Schema.String,
  fields: Schema.String,
});
const keptRowSchema = Schema.Struct({
  read: Schema.String,
  scope: Schema.String,
  part: Schema.String,
  id: Schema.String,
  ord: Schema.Number,
  row: Schema.String,
});
const queuedRowSchema = Schema.Struct({
  key: Schema.String,
  seq: Schema.Number,
  name: Schema.String,
  input: Schema.String,
});
const decodeMetaRow = Schema.decodeUnknownResult(metaRowSchema);
const decodeReadRow = Schema.decodeUnknownResult(readRowSchema);
const decodeKeptRow = Schema.decodeUnknownResult(keptRowSchema);
const decodeQueuedRow = Schema.decodeUnknownResult(queuedRowSchema);

/** How the shell opens a database: `better-sqlite3-multiple-ciphers` over the file named, which throws where it cannot. */
export interface SqliteDriverSeam {
  readonly open: (file: string) => SqliteDatabase;
}

/** The account's lists as they were kept, and what moved since, written within `FLUSH_EVERY`. */
export interface EntityStore {
  /** What the database held of `read` as the store opened, for this account and these row shapes; none where it held none. */
  readonly stored: <Read extends KeptRead>(read: Read) => KeptRows[Read] | undefined;
  /** `read`'s rows as the service answered them now, the rows that moved written within `FLUSH_EVERY` and as the store closes; the workspaces' leave with them every read kept per workspace of one they no longer name. */
  readonly keep: <Read extends KeptRead>(read: Read, rows: KeptRows[Read]) => Effect.Effect<void>;
  /** `read`'s rows kept as `keep` keeps them where none of them moved but where they stand, as the task list's sync id alone: written only with the next write of something that moved, and as the store closes. */
  readonly keepUnmoved: <Read extends KeptRead>(
    read: Read,
    rows: KeptRows[Read],
  ) => Effect.Effect<void>;
  /** What the store holds of one workspace's `read` now: as the database held it, or as it was kept since; none where it holds none. */
  readonly storedIn: <Read extends KeptByWorkspace>(
    read: Read,
    workspaceId: string,
  ) => KeptRows[Read][string] | undefined;
  /** One workspace's `read` as the service answered it now, kept beside the other workspaces' as `keep` keeps a read. */
  readonly keepIn: <Read extends KeptByWorkspace>(
    read: Read,
    workspaceId: string,
    rows: KeptRows[Read][string],
  ) => Effect.Effect<void>;
  /** The row writes waiting for the service as the database held them when the store opened, oldest first. */
  readonly queue: readonly QueuedEntry[];
  /**
   * Says the pool holds `queue` again (`EntityPool.requeue`), its writes laid
   * back behind any made since: until it is said, the store writes none of
   * the pool's waiting writes, so a pool that has not taken them back yet
   * never deletes them from disk.
   */
  readonly requeued: Effect.Effect<void>;
  /** Deletes the database and its key and keeps nothing more, as a sign-out does. */
  readonly forget: Effect.Effect<void>;
}

export interface EntityStoreOptions {
  /** The state root the settings file stands in. */
  readonly directory: string;
  /** The account source's cipher, which seals the database's key. */
  readonly cipher: SecretCipher;
  /** The shell's SQLite, which opens the database. */
  readonly driver: SqliteDriverSeam;
  /** The account signed in, whose lists alone the database may hold. */
  readonly accountId: string;
  /** The row writes waiting for the service now, oldest first, which every write after `requeued` keeps beside the lists; none keeps the queue as it opened. */
  readonly queued?: () => readonly QueuedEntry[];
}

/** One part of a read's value as a write lays it: each row, its id, and the JSON its schema encodes it to, asked only of a row that moved. */
interface SplitPart {
  readonly ids: readonly string[];
  readonly rows: readonly object[];
  readonly encoded: (index: number) => string | undefined;
}

/** One scope of a read's value as a write lays it: the fields that are not rows, as JSON, and each part. */
interface SplitScope {
  readonly fields: string;
  readonly parts: ReadonlyMap<Part, SplitPart>;
}

/** One scope of a read as the database holds it: its fields, and each part's rows in order, as JSON reads them back. */
interface StoredScope {
  readonly fields: object;
  readonly part: (part: Part) => readonly unknown[];
}

/** How one kept read is laid in the database: split into scopes and parts to write, and joined back into its encoded shape to read. */
interface ReadLayout<Value> {
  readonly split: (value: Value) => ReadonlyMap<string, SplitScope>;
  readonly joined: (scopes: ReadonlyMap<string, StoredScope>) => unknown;
}

/** A row as one part writes it: its id, and its encoding. */
interface RowCodec<Row> {
  readonly id: (row: Row) => string;
  readonly encode: (row: Row) => Result.Result<unknown, Schema.SchemaError>;
}

/** A row of what was written, and where it stands among its part's. */
interface WrittenRow {
  readonly row: object;
  readonly ord: number;
}

/** One part as it was last written: each row by its id, and the highest place any was written at. */
interface WrittenPart {
  readonly rows: Map<string, WrittenRow>;
  top: number;
}

/** One scope of a read as it was last written. */
interface WrittenScope {
  fields: string | undefined;
  readonly parts: Map<Part, WrittenPart>;
}

/** The prepared statements a store reads and writes by. */
interface Statements {
  readonly meta: SqliteStatement;
  readonly setMeta: SqliteStatement;
  readonly deleteMeta: SqliteStatement;
  readonly allReads: SqliteStatement;
  readonly allRows: SqliteStatement;
  readonly allQueued: SqliteStatement;
  readonly setFields: SqliteStatement;
  readonly setRow: SqliteStatement;
  readonly deleteRow: SqliteStatement;
  readonly deleteScope: SqliteStatement;
  readonly deleteScopeRows: SqliteStatement;
  readonly deleteRead: SqliteStatement;
  readonly deleteReadRows: SqliteStatement;
  readonly setQueued: SqliteStatement;
  readonly deleteQueued: SqliteStatement;
  readonly deleteAllQueued: SqliteStatement;
}

/** One step of a write, run inside its transaction. */
type Step = (statements: Statements) => void;

/** A database whose schema this build does not know, as a newer build's, which is made again as one that will not open is. */
class UnknownSchema extends Data.TaggedError("UnknownSchema")<{ readonly version: number }> {}

/** Why a database is made again: it will not open with its key, it is no database, or its schema is a newer build's. */
const UNREADABLE_CODES: ReadonlySet<string> = new Set(["SQLITE_NOTADB", "SQLITE_CORRUPT"]);

/** The SHA-256, in hex, of every kept row shape's JSON Schema, which a build that changes any of them changes. */
export const shapesHash: Effect.Effect<string> = Effect.suspend(() =>
  digestOf(JSON.stringify(Schema.toJsonSchemaDocument(keptRowsSchema))),
);

/** `bytes` written as lowercase hex. */
function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The SHA-256 of `text`, in hex. */
function digestOf(text: string): Effect.Effect<string> {
  return Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (digest) => hexOf(new Uint8Array(digest)),
  );
}

/** A part's rows written by `schema`, each by the id `id` reads. */
function rowCodec<Row>(
  schema: Schema.Codec<Row, unknown>,
  id: (row: Row) => string,
): RowCodec<Row> {
  return { id, encode: Schema.encodeResult(schema) };
}

const PLAN_ROW = rowCodec(taskListLiveRowsSchema.fields.plans.value, (row) => row.id);
const AGENT_ROW = rowCodec(taskListLiveRowsSchema.fields.agents.value, (row) => row.id);
const SECTION_ROW = rowCodec(taskSectionSchema, (row) => row.id);
// Note that a task, or an agent, stands in one section of the account at most, so its id names its entry.
const ENTRY_ROW = rowCodec(taskSectionEntrySchema, (row) => row.taskId);
const AGENT_ENTRY_ROW = rowCodec(agentSectionEntrySchema, (row) => row.agentId);
const PIN_ROW = rowCodec(repositoryPinSchema, (row) => row.repository);
const WORKSPACE_ROW = rowCodec(workspaceSchema, (row) => row.id);
const MEMBER_ROW = rowCodec(
  workspaceMembersLiveRowsSchema.fields.members.value,
  (row) => row.userId,
);
const FORMER_ROW = rowCodec(
  workspaceMembersLiveRowsSchema.fields.former.value,
  (row) => row.userId,
);
const INVITATION_ROW = rowCodec(
  workspaceInvitationsLiveRowsSchema.fields.invitations.value,
  (row) => row.id,
);
const AUTOMATION_ROW = rowCodec(
  automationsLiveRowsSchema.fields.automations.value,
  (row) => row.id,
);

/** `rows` as one part lays them. */
function splitPart<Row extends object>(codec: RowCodec<Row>, rows: readonly Row[]): SplitPart {
  return {
    ids: rows.map(codec.id),
    rows,
    encoded: (index) => {
      const row = rows[index];
      if (row === undefined) return undefined;
      const encoded = codec.encode(row);
      return Result.isSuccess(encoded) ? JSON.stringify(encoded.success) : undefined;
    },
  };
}

/** One scope's fields and parts as a write lays them. */
function scopeOf(fields: object, parts: readonly (readonly [Part, SplitPart])[]): SplitScope {
  return { fields: JSON.stringify(fields), parts: new Map(parts) };
}

/** A read of the account as a whole, laid as its one scope. */
function accountRead<Value>(
  split: (value: Value) => SplitScope,
  joined: (scope: StoredScope) => unknown,
): ReadLayout<Value> {
  return {
    split: (value) => new Map([[ACCOUNT_SCOPE, split(value)]]),
    joined: (scopes) => {
      const scope = scopes.get(ACCOUNT_SCOPE);
      return scope === undefined ? undefined : joined(scope);
    },
  };
}

/** A read kept per workspace, laid as a scope for each. */
function workspaceRead<Value>(
  split: (value: Value) => SplitScope,
  joined: (scope: StoredScope) => unknown,
): ReadLayout<Readonly<Record<string, Value>>> {
  return {
    split: (byWorkspace) =>
      new Map(
        Object.entries(byWorkspace).map(([workspaceId, value]) => [workspaceId, split(value)]),
      ),
    joined: (scopes) =>
      scopes.size === 0
        ? undefined
        : Object.fromEntries(
            [...scopes].map(([workspaceId, scope]) => [workspaceId, joined(scope)]),
          ),
  };
}

/** How each kept read is laid in the database. */
const LAYOUTS: { readonly [Read in KeptRead]: ReadLayout<KeptRows[Read]> } = {
  [KEPT_READ.TASK_LIST]: accountRead(
    (list) =>
      scopeOf({ at: list.at }, [
        [PART.PLANS, splitPart(PLAN_ROW, list.rows.plans)],
        [PART.AGENTS, splitPart(AGENT_ROW, list.rows.agents)],
      ]),
    (scope) => ({
      ...scope.fields,
      rows: { plans: scope.part(PART.PLANS), agents: scope.part(PART.AGENTS) },
    }),
  ),
  [KEPT_READ.SIDEBAR]: accountRead(
    (sidebar) =>
      scopeOf({}, [
        [PART.SECTIONS, splitPart(SECTION_ROW, sidebar.sections)],
        [PART.ENTRIES, splitPart(ENTRY_ROW, sidebar.entries)],
        [PART.AGENT_ENTRIES, splitPart(AGENT_ENTRY_ROW, sidebar.agentEntries)],
        [PART.PINS, splitPart(PIN_ROW, sidebar.pins)],
      ]),
    (scope) => ({
      ...scope.fields,
      sections: scope.part(PART.SECTIONS),
      entries: scope.part(PART.ENTRIES),
      agentEntries: scope.part(PART.AGENT_ENTRIES),
      pins: scope.part(PART.PINS),
    }),
  ),
  [KEPT_READ.WORKSPACES]: accountRead(
    (workspaces) => scopeOf({}, [[PART.WORKSPACES, splitPart(WORKSPACE_ROW, workspaces)]]),
    (scope) => scope.part(PART.WORKSPACES),
  ),
  [KEPT_READ.MEMBERS]: workspaceRead(
    (people) =>
      scopeOf({}, [
        [PART.MEMBERS, splitPart(MEMBER_ROW, people.members)],
        [PART.FORMER, splitPart(FORMER_ROW, people.former)],
      ]),
    (scope) => ({
      ...scope.fields,
      members: scope.part(PART.MEMBERS),
      former: scope.part(PART.FORMER),
    }),
  ),
  [KEPT_READ.INVITATIONS]: workspaceRead(
    (pending) =>
      scopeOf({ origin: pending.origin }, [
        [PART.INVITATIONS, splitPart(INVITATION_ROW, pending.invitations)],
      ]),
    (scope) => ({ ...scope.fields, invitations: scope.part(PART.INVITATIONS) }),
  ),
  [KEPT_READ.AUTOMATIONS]: workspaceRead(
    (kept) => scopeOf({}, [[PART.AUTOMATIONS, splitPart(AUTOMATION_ROW, kept.automations)]]),
    (scope) => ({ ...scope.fields, automations: scope.part(PART.AUTOMATIONS) }),
  ),
};

/** Every kept read, in the order the store reads and writes them. */
const KEPT_READS: readonly KeptRead[] = Object.values(KEPT_READ);

/** The record of each workspace's rows `read` holds in `reads`; none where it holds none. */
export function byWorkspaceOf<Read extends KeptByWorkspace>(
  reads: Partial<KeptRows>,
  read: Read,
): Readonly<Record<string, KeptRows[Read][string]>> | undefined {
  // SAFETY: a read kept per workspace is a record of its rows by workspace, so what `reads` holds of `read` is one.
  return reads[read] as Readonly<Record<string, KeptRows[Read][string]>> | undefined;
}

/** `reads` with every read kept per workspace cut to the workspaces the kept list names, where it names any. */
export function withinWorkspaces(reads: Partial<KeptRows>): Partial<KeptRows> {
  const listed = reads[KEPT_READ.WORKSPACES];
  if (listed === undefined) return reads;
  const named = new Set(listed.map((workspace) => workspace.id));
  const cut = <Rows>(byWorkspace: Readonly<Record<string, Rows>>) =>
    Object.fromEntries(Object.entries(byWorkspace).filter(([id]) => named.has(id)));
  const {
    [KEPT_READ.MEMBERS]: members,
    [KEPT_READ.INVITATIONS]: invitations,
    [KEPT_READ.AUTOMATIONS]: automations,
  } = reads;
  return {
    ...reads,
    ...(members === undefined ? undefined : { [KEPT_READ.MEMBERS]: cut(members) }),
    ...(invitations === undefined ? undefined : { [KEPT_READ.INVITATIONS]: cut(invitations) }),
    ...(automations === undefined ? undefined : { [KEPT_READ.AUTOMATIONS]: cut(automations) }),
  };
}

/**
 * The rows that take `written` to `next`, laid on `written` as they are
 * planned: each row new or moved, by the very object first and by its value
 * after, and the ids of those gone. A part whose rows kept their order, with
 * every new one after them, keeps each row's place and writes a new one
 * after the last; one whose order moved writes each row whose place did.
 */
function partWrites(
  written: WrittenPart,
  next: SplitPart,
): {
  readonly rows: readonly (readonly [id: string, ord: number, row: string])[];
  readonly gone: readonly string[];
} {
  let inOrder = true;
  let last = -1;
  let fresh = false;
  for (const id of next.ids) {
    const was = written.rows.get(id);
    if (was === undefined) {
      fresh = true;
    } else if (fresh || was.ord <= last) {
      inOrder = false;
      break;
    } else {
      last = was.ord;
    }
  }
  const rows: (readonly [string, number, string])[] = [];
  next.ids.forEach((id, index) => {
    const row = next.rows[index];
    if (row === undefined) return;
    const was = written.rows.get(id);
    const ord = inOrder ? (was?.ord ?? ++written.top) : index;
    if (was !== undefined && was.ord === ord && (was.row === row || Equal.equals(was.row, row))) {
      return;
    }
    const encoded = next.encoded(index);
    // Note that a row its schema will not encode is not written, and is laid again at the next write.
    if (encoded === undefined) {
      written.rows.delete(id);
      return;
    }
    rows.push([id, ord, encoded]);
    written.rows.set(id, { row, ord });
  });
  if (!inOrder) written.top = next.ids.length - 1;
  if (written.rows.size === next.ids.length) return { rows, gone: [] };
  const named = new Set(next.ids);
  const gone = [...written.rows.keys()].filter((id) => !named.has(id));
  for (const id of gone) written.rows.delete(id);
  return { rows, gone };
}

/**
 * The steps that take what was written of `read` to `next`, laid on
 * `written` as they are planned; a read none of which is known to stand
 * written (`byScope` none) is replaced whole.
 */
function readWrites(
  read: KeptRead,
  byScope: Map<string, WrittenScope> | undefined,
  next: ReadonlyMap<string, SplitScope>,
): { readonly steps: readonly Step[]; readonly written: Map<string, WrittenScope> } {
  const steps: Step[] = [];
  const written = byScope ?? new Map<string, WrittenScope>();
  if (byScope === undefined) {
    steps.push((statements) => {
      statements.deleteReadRows.run(read);
      statements.deleteRead.run(read);
    });
  }
  for (const scope of written.keys()) {
    if (next.has(scope)) continue;
    written.delete(scope);
    steps.push((statements) => {
      statements.deleteScopeRows.run(read, scope);
      statements.deleteScope.run(read, scope);
    });
  }
  for (const [scope, split] of next) {
    let was = written.get(scope);
    if (was === undefined) {
      was = { fields: undefined, parts: new Map() };
      written.set(scope, was);
    }
    if (was.fields !== split.fields) {
      was.fields = split.fields;
      steps.push((statements) => statements.setFields.run(read, scope, split.fields));
    }
    for (const [part, rows] of split.parts) {
      let wasPart = was.parts.get(part);
      if (wasPart === undefined) {
        wasPart = { rows: new Map(), top: -1 };
        was.parts.set(part, wasPart);
      }
      const planned = partWrites(wasPart, rows);
      if (planned.rows.length === 0 && planned.gone.length === 0) continue;
      steps.push((statements) => {
        for (const id of planned.gone) statements.deleteRow.run(read, scope, part, id);
        for (const [id, ord, row] of planned.rows) {
          statements.setRow.run(read, scope, part, id, ord, row);
        }
      });
    }
  }
  return { steps, written };
}

/** The statements over `database`, whose schema stands. */
function prepared(database: SqliteDatabase): Statements {
  return {
    meta: database.prepare("SELECT value FROM meta WHERE name = ?"),
    setMeta: database.prepare("INSERT OR REPLACE INTO meta (name, value) VALUES (?, ?)"),
    deleteMeta: database.prepare("DELETE FROM meta WHERE name = ?"),
    allReads: database.prepare("SELECT read, scope, fields FROM kept_read"),
    allRows: database.prepare(
      "SELECT read, scope, part, id, ord, row FROM kept_row ORDER BY read, scope, part, ord",
    ),
    allQueued: database.prepare("SELECT key, seq, name, input FROM queued_write ORDER BY seq"),
    setFields: database.prepare(
      "INSERT OR REPLACE INTO kept_read (read, scope, fields) VALUES (?, ?, ?)",
    ),
    setRow: database.prepare(
      "INSERT OR REPLACE INTO kept_row (read, scope, part, id, ord, row) VALUES (?, ?, ?, ?, ?, ?)",
    ),
    deleteRow: database.prepare(
      "DELETE FROM kept_row WHERE read = ? AND scope = ? AND part = ? AND id = ?",
    ),
    deleteScope: database.prepare("DELETE FROM kept_read WHERE read = ? AND scope = ?"),
    deleteScopeRows: database.prepare("DELETE FROM kept_row WHERE read = ? AND scope = ?"),
    deleteRead: database.prepare("DELETE FROM kept_read WHERE read = ?"),
    deleteReadRows: database.prepare("DELETE FROM kept_row WHERE read = ?"),
    setQueued: database.prepare(
      "INSERT OR REPLACE INTO queued_write (key, seq, name, input) VALUES (?, ?, ?, ?)",
    ),
    deleteQueued: database.prepare("DELETE FROM queued_write WHERE key = ?"),
    deleteAllQueued: database.prepare("DELETE FROM queued_write"),
  };
}

/** `database`'s schema made where it is new, and refused where it is a newer build's. */
function migrated(database: SqliteDatabase): void {
  const version = Number(database.pragma("user_version", { simple: true }));
  if (version === SCHEMA_VERSION) return;
  if (version !== 0) throw new UnknownSchema({ version });
  database.transaction(() => {
    database.exec(SCHEMA);
    database.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

/**
 * The database over `file` opened under `key`, read once to prove the key,
 * in write-ahead mode, its schema standing; it throws where it will not
 * open, closing what it opened.
 */
function openedDatabase(driver: SqliteDriverSeam, file: string, key: string): SqliteDatabase {
  const database = driver.open(file);
  try {
    // Note that the key is hex this store minted (`KEY_PATTERN`), so it cannot close the string it is written in.
    database.pragma(`key = '${key}'`);
    database.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    database.prepare("SELECT count(*) FROM sqlite_master").get();
    database.pragma("journal_mode = WAL");
    // Note that a commit waits on the disk, at most once each `FLUSH_EVERY`, so a write the store took survives a crash of the machine as well as the app's.
    database.pragma("synchronous = FULL");
    migrated(database);
    return database;
  } catch (cause) {
    database.close();
    throw cause;
  }
}

/** A failure's code, which a report may carry: a SQLite code, or Node's; its message may name a path. */
function codeOf(cause: unknown): string {
  if (cause instanceof UnknownSchema) return "unknown schema";
  if (typeof cause === "object" && cause !== null && "code" in cause) return String(cause.code);
  return "no code";
}

/** Whether `cause` says the database will not open with its key, is no database, or is a newer build's, which is made again. */
function unreadable(cause: unknown): boolean {
  return cause instanceof UnknownSchema || UNREADABLE_CODES.has(codeOf(cause));
}

/** The sealed file's text opened and read as far as its account and its waiting writes, or none where it will not open or is not a store's. */
export function openedSealed(cipher: SecretCipher, text: string): Envelope | undefined {
  const plain = Result.flatMap(Base64.decode(text.trim()), (bytes) =>
    Result.try(() => cipher.decrypt(bytes)),
  );
  if (Result.isFailure(plain)) return undefined;
  return Result.getOrUndefined(decodeEnvelope(plain.success));
}

/** Deletes the database and the files SQLite keeps beside it. */
const databaseRemoved = Effect.fn("host/entityDatabaseRemoved")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ENTITY_DATABASE_FILE_NAME);
  for (const name of [file, ...DATABASE_SIDE_FILES.map((side) => `${file}${side}`)]) {
    yield* Effect.ignore(fileSystem.remove(name, { force: true }));
  }
});

/** Deletes the sealed file of a build before the database, a temporary one a cut-off write left beside it among it. */
const sealedRemoved = Effect.fn("host/entitySealedRemoved")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ENTITY_SEALED_FILE_NAME);
  yield* Effect.ignore(fileSystem.remove(file, { force: true }));
  yield* Effect.ignore(fileSystem.remove(`${file}.tmp`, { force: true }));
});

/** Deletes every file the store keeps: the database, its key, the rollout's last answer, and the sealed store's file. */
const removed = Effect.fn("host/entityStoreRemoved")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const key = path.join(directory, ENTITY_KEY_FILE_NAME);
  yield* databaseRemoved(directory);
  yield* Effect.ignore(fileSystem.remove(key, { force: true }));
  yield* Effect.ignore(fileSystem.remove(`${key}.tmp`, { force: true }));
  yield* Effect.ignore(
    fileSystem.remove(path.join(directory, ENTITY_ROLLOUT_FILE_NAME), { force: true }),
  );
  yield* sealedRemoved(directory);
});

/** Deletes the store's files under `directory`, kept for whichever account, as a sign-out does where no store stands. */
export function forgetEntityStore(
  directory: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> {
  return removed(directory);
}

/** Reports one failure of the database by its kind and code alone, since a row's words or a path may be among its message. */
function reported(kind: string, cause: unknown): Effect.Effect<void> {
  return Effect.andThen(
    Effect.logWarning(`the entity store ${kind}: ${codeOf(cause)}`),
    reportUnexpected(`The entity store ${kind}`, { code: codeOf(cause) }),
  );
}

/**
 * The database's key: as `entities.key` holds it, opened by `cipher`, or
 * minted and written there where it holds none, or one that will not open,
 * the database kept under any other deleted first, since nothing opens it
 * now. None where the file is there but cannot be read, which leaves the
 * database as it stands for a later launch, or where a new key cannot be
 * written.
 */
const databaseKey = Effect.fn("host/entityDatabaseKey")(function* (
  directory: string,
  cipher: SecretCipher,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = yield* Effect.result(
    fileSystem.readFileString(path.join(directory, ENTITY_KEY_FILE_NAME)),
  );
  // Note that only a key that is not there is minted again: one that is there but will not read may read at the next launch, and the waiting writes it opens are kept for it.
  if (Result.isFailure(read) && read.failure.reason._tag !== "NotFound") {
    yield* reported("key was not read", read.failure.reason);
    return undefined;
  }
  const opened = Result.isFailure(read)
    ? undefined
    : Result.getOrUndefined(
        Result.flatMap(Base64.decode(read.success.trim()), (bytes) =>
          Result.try(() => cipher.decrypt(bytes)),
        ),
      );
  if (opened !== undefined && KEY_PATTERN.test(opened)) return opened;
  // Note that a key that reads but will not open is lost for good: a store opens only once the account is signed in, so the same cipher opened the account's tokens this launch, and the system's key it holds no longer asks the Keychain; what it cannot open was sealed under another key, or is damaged.
  yield* databaseRemoved(directory);
  const key = hexOf(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
  const sealed = yield* Effect.try(() => Base64.encode(cipher.encrypt(key))).pipe(
    Effect.flatMap((sealed) =>
      writeSettingsFileAtomic(directory, sealed, undefined, ENTITY_KEY_FILE_NAME),
    ),
    Effect.as(true),
    Effect.catch((failure) => Effect.as(reported("key was not written", failure), false)),
  );
  return sealed ? key : undefined;
});

/** What a database held as it opened: each read by scope, as JSON reads it back, each part's ids at the places they were written at, and the writes waiting. */
interface Loaded {
  readonly scopes: ReadonlyMap<
    KeptRead,
    Map<string, { fields: object; parts: Map<Part, unknown[]> }>
  >;
  readonly ords: ReadonlyMap<KeptRead, Map<string, Map<Part, Map<string, number>>>>;
  readonly queue: readonly QueuedEntry[];
  readonly seq: number;
}

/** Whether `value` names one of `values`. */
function isOneOf<Value extends string>(values: readonly Value[], value: string): value is Value {
  return values.some((each) => each === value);
}

const PARTS: readonly Part[] = Object.values(PART);

/** The value of `key` in the map `map` holds under it, made where it holds none. */
function within<Key, Value>(map: Map<Key, Value>, key: Key, made: () => Value): Value {
  let value = map.get(key);
  if (value === undefined) {
    value = made();
    map.set(key, value);
  }
  return value;
}

/** Everything `statements` read of the database, a row whose JSON will not parse left out. */
function loaded(statements: Statements): Loaded {
  const scopes = new Map<KeptRead, Map<string, { fields: object; parts: Map<Part, unknown[]> }>>();
  const ords = new Map<KeptRead, Map<string, Map<Part, Map<string, number>>>>();
  const parsed = (text: string): Result.Result<unknown, unknown> =>
    Result.try(() => JSON.parse(text));
  for (const read of statements.allReads.all()) {
    const decoded = decodeReadRow(read);
    if (Result.isFailure(decoded)) continue;
    const each = decoded.success;
    const fields = parsed(each.fields);
    if (!isOneOf(KEPT_READS, each.read) || Result.isFailure(fields)) continue;
    const value = fields.success;
    if (typeof value !== "object" || value === null) continue;
    within(scopes, each.read, () => new Map()).set(each.scope, { fields: value, parts: new Map() });
  }
  for (const kept of statements.allRows.all()) {
    const decoded = decodeKeptRow(kept);
    if (Result.isFailure(decoded)) continue;
    const each = decoded.success;
    if (!isOneOf(KEPT_READS, each.read) || !isOneOf(PARTS, each.part)) continue;
    const scope = scopes.get(each.read)?.get(each.scope);
    const row = parsed(each.row);
    if (scope === undefined || Result.isFailure(row)) continue;
    within(scope.parts, each.part, () => []).push(row.success);
    within(
      within(
        within(ords, each.read, () => new Map()),
        each.scope,
        () => new Map(),
      ),
      each.part,
      () => new Map(),
    ).set(each.id, each.ord);
  }
  let seq = 0;
  const queue: QueuedEntry[] = [];
  for (const queued of statements.allQueued.all()) {
    const decoded = decodeQueuedRow(queued);
    if (Result.isFailure(decoded)) continue;
    const each = decoded.success;
    seq = Math.max(seq, each.seq + 1);
    const input = parsed(each.input);
    if (Result.isSuccess(input))
      queue.push({ name: each.name, key: each.key, input: input.success });
  }
  return { scopes, ords, queue, seq };
}

/** One read of what a database held, decoded at these row shapes; none where it held none, or its rows no longer read. */
function storedRead<Read extends KeptRead>(read: Read, held: Loaded): KeptRows[Read] | undefined {
  const scopes = held.scopes.get(read);
  if (scopes === undefined) return undefined;
  const joined = LAYOUTS[read].joined(
    new Map(
      [...scopes].map(([scope, { fields, parts }]) => [
        scope,
        { fields, part: (part: Part) => parts.get(part) ?? [] },
      ]),
    ),
  );
  if (joined === undefined) return undefined;
  const decoded = decodeReads({ [read]: joined });
  if (Result.isFailure(decoded)) return undefined;
  const reads: Partial<KeptRows> = decoded.success;
  return reads[read];
}

/** What was written of `read`, as `value` decoded from the database stands, each row at the place it was written at; none where it was not read whole. */
function writtenOf<Read extends KeptRead>(
  read: Read,
  value: KeptRows[Read],
  held: Loaded,
): Map<string, WrittenScope> {
  const written = new Map<string, WrittenScope>();
  for (const [scope, split] of LAYOUTS[read].split(value)) {
    const parts = new Map<Part, WrittenPart>();
    for (const [part, rows] of split.parts) {
      const ords = held.ords.get(read)?.get(scope)?.get(part);
      const writtenRows = new Map<string, WrittenRow>();
      let top = -1;
      rows.ids.forEach((id, index) => {
        const row = rows.rows[index];
        const ord = ords?.get(id) ?? index;
        if (row === undefined) return;
        writtenRows.set(id, { row, ord });
        top = Math.max(top, ord);
      });
      parts.set(part, { rows: writtenRows, top });
    }
    written.set(scope, { fields: split.fields, parts });
  }
  return written;
}

/** A store's database standing open: the database, its statements, and what it held as it opened. */
interface Standing {
  readonly database: SqliteDatabase;
  readonly statements: Statements;
  readonly held: Loaded;
}

/**
 * The database opened for `accountId` at `hash`: emptied where it was kept
 * for another account, its rows and reads let go where it was kept at other
 * shapes, its waiting writes kept, and read. It throws where it will not.
 */
function standing(
  driver: SqliteDriverSeam,
  file: string,
  key: string,
  accountId: string,
  hash: string,
): Standing {
  const database = openedDatabase(driver, file, key);
  try {
    const statements = prepared(database);
    database.transaction(() => {
      const meta = (name: string) =>
        Result.getOrUndefined(decodeMetaRow(statements.meta.get(name)))?.value;
      const keptFor = meta(META.ACCOUNT_ID);
      const keptAt = meta(META.SHAPES_HASH);
      // Note that a database of another account is emptied before anything reads it, so no other account's rows or writes are ever drawn or sent.
      if (keptFor !== accountId || keptAt !== hash) {
        database.exec("DELETE FROM kept_row; DELETE FROM kept_read;");
        if (keptFor !== accountId) {
          statements.deleteAllQueued.run();
          statements.deleteMeta.run(META.SEALED_HASH);
          statements.deleteMeta.run(META.SEALED_LAUNCHES);
        }
      }
      statements.setMeta.run(META.ACCOUNT_ID, accountId);
      statements.setMeta.run(META.SHAPES_HASH, hash);
    })();
    return { database, statements, held: loaded(statements) };
  } catch (cause) {
    database.close();
    throw cause;
  }
}

/**
 * The database standing open, or made again once where it will not open
 * with its key, is no database, or is a newer build's; none where the
 * driver cannot open it at all, as where it did not load or the file is
 * locked, which is reported by its kind and left as it stands.
 */
const databaseStanding = Effect.fn("host/entityDatabaseStanding")(function* (
  options: EntityStoreOptions,
  file: string,
  key: string,
  hash: string,
) {
  const open = Effect.try({
    try: () => standing(options.driver, file, key, options.accountId, hash),
    catch: (cause) => cause,
  });
  const first = yield* Effect.result(open);
  if (Result.isSuccess(first)) return first.success;
  if (!unreadable(first.failure)) {
    yield* reported("database did not open", first.failure);
    return undefined;
  }
  yield* reported("database was unreadable and is made again", first.failure);
  yield* databaseRemoved(options.directory);
  const again = yield* Effect.result(open);
  if (Result.isSuccess(again)) return again.success;
  yield* reported("database did not open", again.failure);
  return undefined;
});

/**
 * The account's store for as long as the caller's scope stands, or none
 * where its database cannot be had: the database opened under its sealed
 * key, emptied where it is another account's and its rows let go where they
 * are of other row shapes, a sealed file of a build before it written into it
 * and deleted, and the rows that move written at most every `FLUSH_EVERY`,
 * and once more as the scope closes, which closes the database, unless it
 * was forgotten.
 */
export function openEntityStore(
  options: EntityStoreOptions,
): Effect.Effect<EntityStore | undefined, never, FileSystem.FileSystem | Path.Path | Scope.Scope> {
  return Effect.gen(function* () {
    const { directory, cipher, accountId } = options;
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const path = yield* Path.Path;
    const hash = yield* shapesHash;
    const key = yield* databaseKey(directory, cipher);
    if (key === undefined) return undefined;
    const opened = yield* databaseStanding(
      options,
      path.join(directory, ENTITY_DATABASE_FILE_NAME),
      key,
      hash,
    );
    if (opened === undefined) return undefined;
    const { database, statements, held } = opened;

    /** What was written of each read, by scope; a read absent is replaced whole at its next write. */
    const written = new Map<KeptRead, Map<string, WrittenScope>>();
    /** The steps that take what was written of `read` to `value`, laid on what was written. */
    const planned = <Read extends KeptRead>(read: Read, value: KeptRows[Read]) => {
      const writes = readWrites(read, written.get(read), LAYOUTS[read].split(value));
      written.set(read, writes.written);
      return writes.steps;
    };
    let stored: Partial<KeptRows> = {};
    const lay = <Read extends KeptRead>(read: Read) => {
      const value = storedRead(read, held);
      if (value === undefined) {
        // Note that a read that is not read back whole is replaced whole once it is next kept, and none of it is drawn meanwhile.
        if (held.scopes.has(read)) return;
        written.set(read, new Map());
        return;
      }
      stored[read] = value;
      written.set(read, writtenOf(read, value, held));
    };
    for (const read of KEPT_READS) lay(read);
    /** The keys of the waiting writes the database holds; none where that is not known, which replaces them whole. */
    let writtenQueue: Set<string> | undefined = new Set(held.queue.map((entry) => entry.key));
    let seq = held.seq;
    let queue: readonly QueuedEntry[] = held.queue;

    /** The steps that take the waiting writes the database holds to `waiting`, laid on what was written as they are planned. */
    const queueWrites = (waiting: readonly QueuedEntry[]): readonly Step[] => {
      const steps: Step[] = [];
      const known = writtenQueue;
      if (known === undefined) steps.push((each) => each.deleteAllQueued.run());
      const next = known ?? new Set<string>();
      for (const entry of waiting) {
        if (next.has(entry.key)) continue;
        const input = Result.try(() => JSON.stringify(entry.input));
        if (Result.isFailure(input) || input.success === undefined) continue;
        const at = seq++;
        next.add(entry.key);
        steps.push((each) => each.setQueued.run(entry.key, at, entry.name, input.success));
      }
      if (next.size > waiting.length || known === undefined) {
        const named = new Set(waiting.map((entry) => entry.key));
        for (const key of [...next].filter((each) => !named.has(each))) {
          next.delete(key);
          steps.push((each) => each.deleteQueued.run(key));
        }
      }
      writtenQueue = next;
      return steps;
    };

    /** Runs `steps` in one transaction, answering whether it committed. */
    const committed = (steps: readonly Step[]) =>
      Effect.try({
        try: () =>
          database.transaction(() => {
            for (const step of steps) step(statements);
          })(),
        catch: (cause) => cause,
      }).pipe(
        Effect.as(true),
        // Note that a failure is logged by its code alone, since a row's words may be among its message.
        Effect.catch((cause) =>
          Effect.as(Effect.logWarning(`the entity store was not written: ${codeOf(cause)}`), false),
        ),
      );

    // A sealed file the sealed store kept is written into the database once for each content it holds, and kept beside it for `SEALED_KEPT_LAUNCHES`.
    const sealedText = yield* Effect.orElseSucceed(
      readSettingsFileText(directory, ENTITY_SEALED_FILE_NAME),
      () => undefined,
    );
    if (sealedText !== undefined) {
      const sealedHash = yield* digestOf(sealedText);
      const meta = (name: string) =>
        Result.getOrUndefined(decodeMetaRow(statements.meta.get(name)))?.value;
      const taken = meta(META.SEALED_HASH) === sealedHash;
      const envelope = taken ? undefined : openedSealed(cipher, sealedText);
      if (taken) {
        // Note that a file the database took already is not taken again, since what moved since it is newer; it is counted through each launch, and deleted once it has stood through its last.
        const launches = Number(meta(META.SEALED_LAUNCHES) ?? 0) + 1;
        const done = launches > SEALED_KEPT_LAUNCHES;
        const counted = yield* committed([
          done
            ? (each) => {
                each.deleteMeta.run(META.SEALED_HASH);
                each.deleteMeta.run(META.SEALED_LAUNCHES);
              }
            : (each) => each.setMeta.run(META.SEALED_LAUNCHES, String(launches)),
        ]);
        if (counted && done) yield* Effect.provideContext(sealedRemoved(directory), services);
      } else if (envelope === undefined || envelope.accountId !== accountId) {
        // Note that a file that will not open, or is another account's, is deleted as the sealed store deletes it, and nothing of it is taken.
        yield* Effect.provideContext(sealedRemoved(directory), services);
      } else {
        const kept =
          envelope.hash === hash ? Result.getOrUndefined(decodeReads(envelope.reads)) : undefined;
        // Note that the account's own waiting writes outlast other row shapes.
        const sealedQueue: readonly QueuedEntry[] = envelope.queue ?? [];
        const steps: Step[] = [];
        for (const read of KEPT_READS) {
          const value = kept?.[read];
          if (value === undefined) continue;
          written.delete(read);
          steps.push(...planned(read, value));
        }
        const importedQueue = [
          ...queue,
          ...sealedQueue.filter((entry) => !queue.some((each) => each.key === entry.key)),
        ];
        steps.push(...queueWrites(importedQueue), (each) => {
          each.setMeta.run(META.SEALED_HASH, sealedHash);
          each.setMeta.run(META.SEALED_LAUNCHES, "1");
        });
        if (yield* committed(steps)) {
          stored = { ...stored, ...kept };
          queue = importedQueue;
        } else {
          // Note that a file that was not written into the database is taken at the next launch.
          for (const read of KEPT_READS) if (kept?.[read] !== undefined) written.delete(read);
          writtenQueue = undefined;
          yield* reportUnexpected("The entity store did not take the sealed file", {});
        }
      }
    }

    const queued = options.queued ?? (() => queue);
    /** Done once the pool holds the waiting writes the store handed out (`requeued`), before which the pool's are not written; at once for a store keeping its own. */
    const taken = yield* Deferred.make<void>();
    if (options.queued === undefined) Deferred.doneUnsafe(taken, Effect.void);
    let reads: Partial<KeptRows> = { ...stored };
    /** The reads kept since the last write, and those kept where nothing moved but where they stand (`keepUnmoved`), which only a write of something that moved, or the last, writes. */
    const dirty = new Set<KeptRead>();
    const unmoved = new Set<KeptRead>();
    let forgotten = false;
    let closed = false;
    const lock = yield* Semaphore.make(1);
    const flush = (closing: boolean) =>
      lock.withPermits(1)(
        Effect.suspend(() => {
          if (forgotten || closed) return Effect.void;
          const steps: Step[] = Deferred.isDoneUnsafe(taken) ? [...queueWrites(queued())] : [];
          const flushed = new Set(dirty);
          if (closing || steps.length > 0 || flushed.size > 0) {
            for (const read of unmoved) flushed.add(read);
          }
          if (flushed.size === 0 && steps.length === 0) return Effect.void;
          for (const read of flushed) {
            const value = reads[read];
            if (value !== undefined) steps.push(...planned(read, value));
          }
          dirty.clear();
          unmoved.clear();
          if (steps.length === 0) return Effect.void;
          return Effect.flatMap(committed(steps), (wrote) =>
            Effect.sync(() => {
              if (wrote) return;
              // Note that what was not written is replaced whole at the next write.
              for (const read of flushed) {
                written.delete(read);
                dirty.add(read);
              }
              writtenQueue = undefined;
            }),
          );
        }),
      );
    yield* Effect.forkScoped(Effect.repeat(flush(false), Schedule.spaced(FLUSH_EVERY)));
    yield* Effect.addFinalizer(() =>
      Effect.andThen(
        flush(true),
        lock.withPermits(1)(
          Effect.sync(() => {
            if (closed) return;
            closed = true;
            database.close();
          }),
        ),
      ),
    );
    /** `read`'s rows laid among those kept, the workspaces' leaving with them every read kept per workspace of one they no longer name. */
    const laid = <Read extends KeptRead>(kept: Read, rows: KeptRows[Read]) => {
      reads = { ...reads, [kept]: rows };
      if (kept !== KEPT_READ.WORKSPACES) return;
      reads = withinWorkspaces(reads);
      for (const byWorkspace of [KEPT_READ.MEMBERS, KEPT_READ.INVITATIONS, KEPT_READ.AUTOMATIONS]) {
        if (reads[byWorkspace] !== undefined) dirty.add(byWorkspace);
      }
    };
    return {
      stored: (read) => stored[read],
      queue,
      requeued: Deferred.succeed(taken, undefined).pipe(Effect.asVoid),
      keep: (kept, rows) =>
        Effect.sync(() => {
          laid(kept, rows);
          dirty.add(kept);
        }),
      keepUnmoved: (kept, rows) =>
        Effect.sync(() => {
          laid(kept, rows);
          unmoved.add(kept);
        }),
      storedIn: <Read extends KeptByWorkspace>(kept: Read, workspaceId: string) =>
        byWorkspaceOf<Read>(reads, kept)?.[workspaceId],
      keepIn: <Read extends KeptByWorkspace>(
        kept: Read,
        workspaceId: string,
        rows: KeptRows[Read][string],
      ) =>
        Effect.sync(() => {
          // Note that a late answer for a workspace the kept list no longer names is not kept, so a workspace left never comes back with it.
          const listed = reads[KEPT_READ.WORKSPACES];
          if (listed !== undefined && !listed.some((workspace) => workspace.id === workspaceId)) {
            return;
          }
          const byWorkspace = { ...byWorkspaceOf<Read>(reads, kept), [workspaceId]: rows };
          // SAFETY: the read `kept` names is set to a record of its own rows, each workspace's `KeptRows[Read][string]`.
          reads = { ...reads, [kept]: byWorkspace } as Partial<KeptRows>;
          dirty.add(kept);
        }),
      forget: lock.withPermits(1)(
        Effect.suspend(() => {
          forgotten = true;
          if (!closed) {
            closed = true;
            database.close();
          }
          return Effect.provideContext(removed(directory), services);
        }),
      ),
    };
  });
}
