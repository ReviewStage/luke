/**
 * entity-store.ts -- the account's lists kept on disk between launches, sealed under the Keychain's key: what each kept read last answered, read back at the next launch so the lists draw before the service answers.
 *
 * Only the reads `KEPT_READ` names are kept, and each as the service
 * answered it, never with a write drawn over it: the task list's plans and
 * agents with the sync id they were read at, which its follow reads past,
 * the sidebar's sections, the tasks and agents in them, and its pinned
 * repositories, and the account's workspaces with their GitHub
 * installations. None of them holds a credential. Every other read the host
 * holds stays in memory, among them transcripts, the inbox, plans, pages,
 * comments, browser tabs, Mac commands, Terminal bytes, pictures, devices,
 * and every credential's standing.
 *
 * The file is `entities.sealed` beside `settings.json`, written whole
 * through a temporary file of its own (`writeSettingsFileAtomic`), sealed by
 * the account source's cipher, which on a Mac is the Keychain's
 * (`safeStorage`); a host whose source hands no cipher, as a browser tab's,
 * keeps none. It names the account it was kept for and a hash of the row
 * shapes it was kept at, so a file of another account, of another build's
 * shapes, or one that will not open, is deleted and read as none, and every
 * read reads whole. A store saves what moved at most every `SAVE_EVERY`, and
 * once more as it closes; a sign-out forgets it, which deletes the file.
 */

import { taskListLiveRowsSchema } from "@repo/features/task-list-live";
import {
  agentSectionEntrySchema,
  taskSectionEntrySchema,
  taskSectionSchema,
} from "@repo/features/task-section-wire";
import { repositoryPinSchema } from "@repo/features/task-wire";
import { workspaceSchema } from "@repo/features/workspace-wire";
import { Duration, Effect, Path, Result, Schedule, Schema, type Scope, Semaphore } from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import { readSettingsFileText, writeSettingsFileAtomic } from "./effect/settings-store-io.js";
import type { SecretCipher } from "./settings-store.js";

/** The sealed file, beside the settings file in the state root. */
export const ENTITY_STORE_FILE_NAME = "entities.sealed";

/** How often, at most, a store writes what moved. */
const SAVE_EVERY = Duration.seconds(2);

/** The reads whose rows are kept on disk, and the only ones: a read not named here stays in memory. */
export const KEPT_READ = {
  TASK_LIST: "taskList",
  SIDEBAR: "sidebar",
  WORKSPACES: "workspaces",
} as const;

export type KeptRead = (typeof KEPT_READ)[keyof typeof KEPT_READ];

/** Each kept read's rows as the file keeps them: what its follow last answered, the task list's with the sync id it was read at. */
const keptRowsSchema = Schema.Struct({
  [KEPT_READ.TASK_LIST]: Schema.Struct({ rows: taskListLiveRowsSchema, at: Schema.String }),
  [KEPT_READ.SIDEBAR]: Schema.Struct({
    sections: Schema.Array(taskSectionSchema),
    entries: Schema.Array(taskSectionEntrySchema),
    agentEntries: Schema.Array(agentSectionEntrySchema),
    pins: Schema.Array(repositoryPinSchema),
  }),
  [KEPT_READ.WORKSPACES]: Schema.Array(workspaceSchema),
});

/** Each kept read's rows, as a read hands them to the store and takes them back. */
export type KeptRows = typeof keptRowsSchema.Type;

/** What the file holds once opened, every read optional, since a read that never answered keeps nothing. */
const keptSchema = Schema.Struct({
  hash: Schema.String,
  accountId: Schema.String,
  reads: Schema.Struct({
    [KEPT_READ.TASK_LIST]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.TASK_LIST]),
    [KEPT_READ.SIDEBAR]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.SIDEBAR]),
    [KEPT_READ.WORKSPACES]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.WORKSPACES]),
  }),
});

type Kept = typeof keptSchema.Type;

const decodeKept = Schema.decodeUnknownResult(Schema.fromJsonString(keptSchema));
const encodeKept = Schema.encodeEffect(Schema.fromJsonString(keptSchema));

/** The account's lists as they were kept, and what moved since, written within `SAVE_EVERY`. */
export interface EntityStore {
  /** What the file held of `read` as the store opened, for this account and these row shapes; none where it held none. */
  readonly stored: <Read extends KeptRead>(read: Read) => KeptRows[Read] | undefined;
  /** `read`'s rows as the service answered them now, written within `SAVE_EVERY` and as the store closes. */
  readonly keep: <Read extends KeptRead>(read: Read, rows: KeptRows[Read]) => Effect.Effect<void>;
  /** Deletes the file and keeps nothing more, as a sign-out does. */
  readonly forget: Effect.Effect<void>;
}

export interface EntityStoreOptions {
  /** The state root the settings file stands in. */
  readonly directory: string;
  /** The account source's cipher, which seals the file. */
  readonly cipher: SecretCipher;
  /** The account signed in, whose lists alone the file may hold. */
  readonly accountId: string;
}

/** The SHA-256, in hex, of every kept row shape's JSON Schema, which a build that changes any of them changes. */
const shapesHash: Effect.Effect<string> = Effect.map(
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(Schema.toJsonSchemaDocument(keptRowsSchema))),
    ),
  ),
  (digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
);

/** The file's text opened and read, or none where it will not open or is not a store's. */
function opened(cipher: SecretCipher, text: string): Kept | undefined {
  const plain = Result.flatMap(Base64.decode(text.trim()), (bytes) =>
    Result.try(() => cipher.decrypt(bytes)),
  );
  if (Result.isFailure(plain)) return undefined;
  return Result.getOrUndefined(decodeKept(plain.success));
}

/** Deletes the file, a temporary one a cut-off write left beside it among it. */
const removed = Effect.fn("host/entityStoreRemoved")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ENTITY_STORE_FILE_NAME);
  yield* Effect.ignore(fileSystem.remove(file, { force: true }));
  yield* Effect.ignore(fileSystem.remove(`${file}.tmp`, { force: true }));
});

/** Deletes the sealed file under `directory`, kept for whichever account, as a sign-out does where no store stands. */
export function forgetEntityStore(
  directory: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> {
  return removed(directory);
}

/**
 * The account's store for as long as the caller's scope stands: the file
 * read and opened, deleted where it is another account's, of other row
 * shapes, or will not open; what moves written at most every `SAVE_EVERY`,
 * and once more as the scope closes, unless it was forgotten.
 */
export function openEntityStore(
  options: EntityStoreOptions,
): Effect.Effect<EntityStore, never, FileSystem.FileSystem | Path.Path | Scope.Scope> {
  return Effect.gen(function* () {
    const { directory, cipher, accountId } = options;
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const hash = yield* shapesHash;
    const text = yield* Effect.orElseSucceed(
      readSettingsFileText(directory, ENTITY_STORE_FILE_NAME),
      () => undefined,
    );
    const read = text === undefined ? undefined : opened(cipher, text);
    const fits = read !== undefined && read.accountId === accountId && read.hash === hash;
    // Note that a file that is not this account's at these shapes is deleted before anything reads it, so no other account's rows are ever drawn.
    if (text !== undefined && !fits) yield* removed(directory);
    const stored: Partial<KeptRows> = fits ? read.reads : {};
    let reads: Partial<KeptRows> = stored;
    let dirty = false;
    let forgotten = false;
    const lock = yield* Semaphore.make(1);
    const save = lock.withPermits(1)(
      Effect.suspend(() => {
        if (!dirty || forgotten) return Effect.void;
        dirty = false;
        return encodeKept({ hash, accountId, reads }).pipe(
          Effect.map((plain) => Base64.encode(cipher.encrypt(plain))),
          Effect.flatMap((sealed) =>
            writeSettingsFileAtomic(directory, sealed, undefined, ENTITY_STORE_FILE_NAME),
          ),
          // Note that a failure is logged by its kind alone, since a row's words may be among its message.
          Effect.catch((failure) =>
            Effect.logWarning(`the entity store was not written: ${failure._tag}`),
          ),
          Effect.provideContext(services),
        );
      }),
    );
    yield* Effect.forkScoped(Effect.repeat(save, Schedule.spaced(SAVE_EVERY)));
    yield* Effect.addFinalizer(() => save);
    return {
      stored: (kept) => stored[kept],
      keep: (kept, rows) =>
        Effect.sync(() => {
          reads = { ...reads, [kept]: rows };
          dirty = true;
        }),
      forget: lock.withPermits(1)(
        Effect.suspend(() => {
          forgotten = true;
          return Effect.provideContext(removed(directory), services);
        }),
      ),
    };
  });
}
