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
import type { SecretCipher } from "./settings-store.js";

export const ENTITY_STORE_FILE_NAME = "entities.sealed";

const SAVE_EVERY = Duration.seconds(30);

const QUEUE_LOOK_EVERY = Duration.seconds(2);

export const KEPT_READ = {
  TASK_LIST: "taskList",
  SIDEBAR: "sidebar",
  WORKSPACES: "workspaces",
  MEMBERS: "members",
  INVITATIONS: "invitations",
  AUTOMATIONS: "automations",
} as const;

export type KeptRead = (typeof KEPT_READ)[keyof typeof KEPT_READ];

type KeptByWorkspace =
  | typeof KEPT_READ.MEMBERS
  | typeof KEPT_READ.INVITATIONS
  | typeof KEPT_READ.AUTOMATIONS;

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

export type KeptRows = typeof keptRowsSchema.Type;

const queuedEntrySchema = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  input: Schema.Unknown,
});

const keptReadsSchema = Schema.Struct({
  [KEPT_READ.TASK_LIST]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.TASK_LIST]),
  [KEPT_READ.SIDEBAR]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.SIDEBAR]),
  [KEPT_READ.WORKSPACES]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.WORKSPACES]),
  [KEPT_READ.MEMBERS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.MEMBERS]),
  [KEPT_READ.INVITATIONS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.INVITATIONS]),
  [KEPT_READ.AUTOMATIONS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.AUTOMATIONS]),
});

const keptSchema = Schema.Struct({
  hash: Schema.String,
  accountId: Schema.String,
  reads: keptReadsSchema,
  queue: Schema.Array(queuedEntrySchema),
});

const envelopeSchema = Schema.Struct({
  hash: Schema.String,
  accountId: Schema.String,
  reads: Schema.Unknown,
  queue: Schema.optionalKey(Schema.Array(queuedEntrySchema)),
});

type Envelope = typeof envelopeSchema.Type;

const decodeEnvelope = Schema.decodeUnknownResult(Schema.fromJsonString(envelopeSchema));
const decodeReads = Schema.decodeUnknownResult(keptReadsSchema);
const encodeKept = Schema.encodeEffect(Schema.fromJsonString(keptSchema));

export interface EntityStore {
  readonly stored: <Read extends KeptRead>(read: Read) => KeptRows[Read] | undefined;
  readonly keep: <Read extends KeptRead>(read: Read, rows: KeptRows[Read]) => Effect.Effect<void>;
  readonly keepUnmoved: <Read extends KeptRead>(
    read: Read,
    rows: KeptRows[Read],
  ) => Effect.Effect<void>;
  readonly storedIn: <Read extends KeptByWorkspace>(
    read: Read,
    workspaceId: string,
  ) => KeptRows[Read][string] | undefined;
  readonly keepIn: <Read extends KeptByWorkspace>(
    read: Read,
    workspaceId: string,
    rows: KeptRows[Read][string],
  ) => Effect.Effect<void>;
  readonly queue: readonly QueuedEntry[];
  readonly forget: Effect.Effect<void>;
}

export interface EntityStoreOptions {
  readonly directory: string;
  readonly cipher: SecretCipher;
  readonly accountId: string;
  readonly queued?: () => readonly QueuedEntry[];
}

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

function byWorkspaceOf<Read extends KeptByWorkspace>(
  reads: Partial<KeptRows>,
  read: Read,
): Readonly<Record<string, KeptRows[Read][string]>> | undefined {
  return reads[read] as Readonly<Record<string, KeptRows[Read][string]>> | undefined;
}

function withinWorkspaces(reads: Partial<KeptRows>): Partial<KeptRows> {
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

function opened(cipher: SecretCipher, text: string): Envelope | undefined {
  const plain = Result.flatMap(Base64.decode(text.trim()), (bytes) =>
    Result.try(() => cipher.decrypt(bytes)),
  );
  if (Result.isFailure(plain)) return undefined;
  return Result.getOrUndefined(decodeEnvelope(plain.success));
}

const removed = Effect.fn("host/entityStoreRemoved")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ENTITY_STORE_FILE_NAME);
  yield* Effect.ignore(fileSystem.remove(file, { force: true }));
  yield* Effect.ignore(fileSystem.remove(`${file}.tmp`, { force: true }));
});

export function forgetEntityStore(
  directory: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> {
  return removed(directory);
}

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
    const ours = read !== undefined && read.accountId === accountId;
    const kept =
      ours && read.hash === hash ? Result.getOrUndefined(decodeReads(read.reads)) : undefined;
    if (text !== undefined && kept === undefined) yield* removed(directory);
    const stored: Partial<KeptRows> = kept ?? {};
    const queue: readonly QueuedEntry[] = ours ? (read.queue ?? []) : [];
    const queued = options.queued ?? (() => queue);
    let reads: Partial<KeptRows> = stored;
    let dirty = kept === undefined && queue.length > 0;
    let unmoved = false;
    let savedQueue = JSON.stringify(queue);
    let forgotten = false;
    const lock = yield* Semaphore.make(1);
    let savedAt = yield* Clock.currentTimeMillis;
    const save = (closing: boolean) =>
      lock.withPermits(1)(
        Effect.flatMap(Clock.currentTimeMillis, (now) => {
          const waiting = queued();
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
              writeSettingsFileAtomic(directory, sealed, undefined, ENTITY_STORE_FILE_NAME),
            ),
            Effect.catch((failure) =>
              Effect.logWarning(`the entity store was not written: ${failure._tag}`),
            ),
            Effect.provideContext(services),
          );
        }),
      );
    yield* Effect.forkScoped(Effect.repeat(save(false), Schedule.spaced(QUEUE_LOOK_EVERY)));
    yield* Effect.addFinalizer(() => save(true));
    const laid = <Read extends KeptRead>(kept: Read, rows: KeptRows[Read]) => {
      reads = { ...reads, [kept]: rows };
      if (kept === KEPT_READ.WORKSPACES) reads = withinWorkspaces(reads);
    };
    return {
      stored: (read) => stored[read],
      queue,
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
          const listed = reads[KEPT_READ.WORKSPACES];
          if (listed !== undefined && !listed.some((workspace) => workspace.id === workspaceId)) {
            return;
          }
          const byWorkspace = { ...byWorkspaceOf<Read>(reads, kept), [workspaceId]: rows };
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
