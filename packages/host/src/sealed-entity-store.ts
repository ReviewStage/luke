/**
 * sealed-entity-store.ts -- the account's lists kept on disk between launches in one sealed file, as every build before the encrypted SQLite store kept them, and as a Mac still keeps them while the deployment's rollout leaves it off (`entity-store-rollout.ts`).
 *
 * It keeps what the SQLite store keeps (`entity-store.ts`), under the same
 * row shapes and their hash, so either reads what the other left: only the
 * reads `KEPT_READ` names are kept, and each as the service
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
 * The file is `entities.sealed` beside `settings.json`, written whole
 * through a temporary file of its own (`writeSettingsFileAtomic`), sealed by
 * the account source's cipher, which on a Mac is the Keychain's
 * (`safeStorage`); a host whose source hands no cipher, as a browser tab's,
 * keeps none. It names the account it was kept for and a hash of the row
 * shapes it was kept at, so a file of another account, of another build's
 * shapes, or one that will not open, is deleted and read as none, and every
 * read reads whole. A store saves lists that moved at most every
 * `SAVE_EVERY`, the writes waiting for the service within `QUEUE_LOOK_EVERY`
 * of their moving, and both once more as it closes; a sign-out forgets it,
 * which deletes the file. Rows
 * kept where none of them moved but where they stand (`keepUnmoved`), as the
 * task list's sync id moving alone, are written only beside the next save of
 * something that moved, and as the store closes. Note that a file left
 * behind at an older sync id reads right, because a read past an id answers
 * every row that moved since it, and the rows the file kept at that id are
 * the very rows the service held there.
 *
 * Beside the lists it keeps the row writes made while the service could not
 * be reached, as the sync engine hands them out (`EntityPool.queued`) and
 * takes them back at the next launch (`requeue`): each a write's name, its
 * idempotency key, and its input. They are the account's own, so they
 * outlast a build of other row shapes where they still read, and leave with
 * the file at a sign-out.
 *
 * Its writes waiting for the service are compared with the pool's only once
 * the composer says the pool holds those it handed back (`requeued`), as the
 * SQLite store's are, so a launch never writes the file without them.
 */

import type { QueuedEntry } from "@repo/sync";
import {
  Clock,
  Duration,
  Effect,
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
import {
  byWorkspaceOf,
  ENTITY_SEALED_FILE_NAME,
  type EntityStore,
  KEPT_READ,
  type KeptByWorkspace,
  type KeptRead,
  type KeptRows,
  keptReadsSchema,
  openedSealed,
  queuedEntrySchema,
  shapesHash,
  withinWorkspaces,
} from "./entity-store.js";
import type { SecretCipher } from "./settings-store.js";

/**
 * How often, at most, a store writes lists that moved. Note that it is long,
 * because each write seals the whole file again and the task list moves
 * about once a second while agents work, and that a crash between two saves
 * costs only a launch drawing the lists a little older until the service
 * answers.
 */
const SAVE_EVERY = Duration.seconds(30);

/** How often a store looks whether the writes waiting for the service moved, which it writes at once, since they are what a crash would lose. */
const QUEUE_LOOK_EVERY = Duration.seconds(2);

/** What the file holds once opened: whose it is, the shapes its rows were kept at, the rows, and the writes waiting. */
const keptSchema = Schema.Struct({
  hash: Schema.String,
  accountId: Schema.String,
  reads: keptReadsSchema,
  queue: Schema.Array(queuedEntrySchema),
});

const decodeReads = Schema.decodeUnknownResult(keptReadsSchema);
const encodeKept = Schema.encodeEffect(Schema.fromJsonString(keptSchema));

export interface SealedEntityStoreOptions {
  /** The state root the settings file stands in. */
  readonly directory: string;
  /** The account source's cipher, which seals the file. */
  readonly cipher: SecretCipher;
  /** The account signed in, whose lists alone the file may hold. */
  readonly accountId: string;
  /** The row writes waiting for the service now, oldest first, which every save keeps beside the lists. */
  readonly queued?: () => readonly QueuedEntry[];
}

/** Deletes the file, a temporary one a cut-off write left beside it among it. */
const removed = Effect.fn("host/sealedEntityStoreRemoved")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ENTITY_SEALED_FILE_NAME);
  yield* Effect.ignore(fileSystem.remove(file, { force: true }));
  yield* Effect.ignore(fileSystem.remove(`${file}.tmp`, { force: true }));
});

/**
 * The account's store for as long as the caller's scope stands: the file
 * read and opened, deleted where it is another account's, of other row
 * shapes, or will not open; what moves written at most every `SAVE_EVERY`,
 * and once more as the scope closes, unless it was forgotten.
 */
export function openSealedEntityStore(
  options: SealedEntityStoreOptions,
): Effect.Effect<EntityStore, never, FileSystem.FileSystem | Path.Path | Scope.Scope> {
  return Effect.gen(function* () {
    const { directory, cipher, accountId } = options;
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const hash = yield* shapesHash;
    const text = yield* Effect.orElseSucceed(
      readSettingsFileText(directory, ENTITY_SEALED_FILE_NAME),
      () => undefined,
    );
    const read = text === undefined ? undefined : openedSealed(cipher, text);
    const ours = read !== undefined && read.accountId === accountId;
    const kept =
      ours && read.hash === hash ? Result.getOrUndefined(decodeReads(read.reads)) : undefined;
    // Note that a file that is not this account's at these shapes is deleted before anything reads it, so no other account's rows are ever drawn.
    if (text !== undefined && kept === undefined) yield* removed(directory);
    const stored: Partial<KeptRows> = kept ?? {};
    // Note that the account's own waiting writes outlast other row shapes, and are kept again at the next save.
    const queue: readonly QueuedEntry[] = ours ? (read.queue ?? []) : [];
    const queued = options.queued ?? (() => queue);
    /** Whether the pool holds the waiting writes the store handed out (`requeued`), before which the file keeps those it held; at once for a store keeping its own. */
    let taken = options.queued === undefined;
    let reads: Partial<KeptRows> = stored;
    let dirty = kept === undefined && queue.length > 0;
    /** Whether rows kept since the last save moved nothing but where they stand (`keepUnmoved`), which only a save of something that moved, or the last, writes. */
    let unmoved = false;
    let savedQueue = JSON.stringify(queue);
    let forgotten = false;
    const lock = yield* Semaphore.make(1);
    let savedAt = yield* Clock.currentTimeMillis;
    const save = (closing: boolean) =>
      lock.withPermits(1)(
        Effect.flatMap(Clock.currentTimeMillis, (now) => {
          const waiting = taken ? queued() : queue;
          const waitingText = JSON.stringify(waiting);
          const listsDue = dirty && (closing || now - savedAt >= Duration.toMillis(SAVE_EVERY));
          const moved = listsDue || waitingText !== savedQueue;
          if (!(moved || (closing && unmoved)) || forgotten) return Effect.void;
          dirty = false;
          unmoved = false;
          savedQueue = waitingText;
          savedAt = now;
          return encodeKept({ hash, accountId, reads, queue: waiting }).pipe(
            Effect.map((plain) => Base64.encode(cipher.encrypt(plain))),
            Effect.flatMap((sealed) =>
              writeSettingsFileAtomic(directory, sealed, undefined, ENTITY_SEALED_FILE_NAME),
            ),
            // Note that a failure is logged by its kind alone, since a row's words may be among its message.
            Effect.catch((failure) =>
              Effect.logWarning(`the entity store was not written: ${failure._tag}`),
            ),
            Effect.provideContext(services),
          );
        }),
      );
    yield* Effect.forkScoped(Effect.repeat(save(false), Schedule.spaced(QUEUE_LOOK_EVERY)));
    yield* Effect.addFinalizer(() => save(true));
    /** `read`'s rows laid among those kept, the workspaces' leaving with them every read kept per workspace of one they no longer name. */
    const laid = <Read extends KeptRead>(kept: Read, rows: KeptRows[Read]) => {
      reads = { ...reads, [kept]: rows };
      if (kept === KEPT_READ.WORKSPACES) reads = withinWorkspaces(reads);
    };
    return {
      stored: (read) => stored[read],
      queue,
      requeued: Effect.sync(() => {
        taken = true;
      }),
      keep: (kept, rows) =>
        Effect.sync(() => {
          laid(kept, rows);
          dirty = true;
        }),
      keepUnmoved: (kept, rows) =>
        Effect.sync(() => {
          laid(kept, rows);
          unmoved = true;
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
