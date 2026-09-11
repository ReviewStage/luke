import path from "node:path";
import { Rpc, RpcGroup } from "@effect/rpc";
import type { SqlError } from "@effect/sql/SqlError";
import type {
  EmbeddingModelIdentity,
  EmbeddingWrite,
  IndexedFileWrite,
  MemoryApplyReport,
  MemoryReadResult,
  MemoryScanPlan,
  MemorySearchOutcome,
  MemorySearchQuery,
} from "@sidecar/memory";
import {
  type AgentId,
  ArchiveReasonSchema,
  agentId,
  type ChildCompletionRecord,
  type ChildRunRecord,
  type ConversationAppendOutcome,
  type ConversationRecord,
  type SessionKey,
  sessionKey,
} from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import { Effect, Schema, type Scope } from "effect";
import type { DeletionOptions, DeletionOutcome } from "./archives.js";
import type { EnvelopeRead } from "./brain-envelope.js";
import type { ConversationSearchHit } from "./conversation-table.js";
import { type ConversationCreation, createConversationEffect } from "./conversations-table.js";
import { AGENT_DATABASE_FILE, StoreDatabase } from "./database.js";
import type { BrainStateSave } from "./envelope.js";
import type { MaintenanceReport } from "./maintenance-run.js";
import type { FlushState } from "./memory-flush-table.js";
import type { MemoryIndexStatus } from "./memory-index-table.js";
import { StoreSchemaRefused } from "./migration.js";
import {
  migrateFactsIntoNotebookEffect,
  type NotebookEntry,
  type NotebookMutation,
} from "./notebook-table.js";

/**
 * Every operation the store answers, as one `RpcGroup`. An operation is
 * declared once here — its name, what it takes, what it answers, and what
 * it refuses with — and the worker's handlers, the client's methods, and the
 * types both ends speak all derive from that one declaration: a handler the
 * group names and the host does not supply is a compile error, and so is a
 * caller's typo.
 *
 * What the declarations carry is bounded the way the boundary is. Both ends
 * are one build in one process, and the port between them makes a
 * structured clone of every message, so what a request needs established is
 * the envelope's shape and the fields the store itself declares: those are
 * `Schema.Struct`s here, and a request whose fields the schema refuses is
 * refused before any handler runs. A shape another package owns — a
 * conversation entry, a child's record, the brain's envelope save, the
 * memory index's plan — has no schema of its own yet anywhere in the tree,
 * and declaring one here would be a second statement of it, so it rides as
 * `carried`: typed by the declaration, cloned by the port, validated nowhere,
 * exactly as the hand-rolled envelope before this one let it ride behind a
 * `SAFETY:` comment. When its package declares the schema, the field here
 * takes it in place of `carried`.
 */

/** An open store as an operation sees it: the database, and the two directories it owns. */
export interface OpenStore {
  readonly db: StoreDatabase;
  /** The agent's own directory under Luke's application data: the database file and the archives live in it. */
  readonly agentRoot: string;
  /** The agent's identity workspace, the notebook's root. */
  readonly workspace: string;
}

/**
 * A value carried across the worker boundary as the structured clone the
 * port makes of it: typed by the declaration alone. The predicate admits
 * everything, because both ends are the same build and the sender typed the
 * value against this same declaration.
 */
const carried = <A>(): Schema.Schema<A> => Schema.declare((_value): _value is A => true);

/** A session key on the boundary: the non-empty string the runtime's own constructor brands. */
const SessionKeySchema: Schema.Schema<SessionKey, string> = Schema.transform(
  Schema.NonEmptyString,
  carried<SessionKey>(),
  { strict: true, decode: sessionKey, encode: (key) => key },
);

/** An agent id on the boundary, branded the same way. */
const AgentIdSchema: Schema.Schema<AgentId, string> = Schema.transform(
  Schema.NonEmptyString,
  carried<AgentId>(),
  { strict: true, decode: agentId, encode: (id) => id },
);

/** An operation that takes nothing beyond the open store. */
const NoParams = Schema.Struct({});

/**
 * What an operation that could not be carried out fails with: the message of
 * whatever the store threw or failed with. The cause stays on the worker,
 * where it was raised; what the host is owed is the answer that the request
 * did not take effect, and why in words.
 */
export class StoreOperationFailed extends Schema.TaggedError<StoreOperationFailed>()(
  "StoreOperationFailed",
  { message: Schema.String },
) {}

/** What an operation against a worker whose store is not open is refused with. */
export const STORE_NOT_OPEN = "the brain's store is not open";

/**
 * The open's parameters, read rather than assumed: they are the one payload
 * the worker acts on before any operation runs, since they name the
 * directory it opens a database in.
 */
const StoreOpenOptionsSchema = Schema.Struct({
  /** The agent's own directory under Luke's application data; the database lives in it. */
  agentRoot: Schema.String,
  /** The agent's identity workspace, the notebook's root; `<agentRoot>/workspace` by default. */
  workspaceDirectory: Schema.optionalWith(Schema.String, { exact: true }),
  agentId: AgentIdSchema,
  sessionKey: SessionKeySchema,
  conversationName: Schema.String,
  now: Schema.Number,
});
export type StoreOpenOptions = Schema.Schema.Type<typeof StoreOpenOptionsSchema>;

const operation = <
  const Tag extends string,
  Payload extends Schema.Schema.Any | Schema.Struct.Fields,
  Success extends Schema.Schema.Any,
>(
  tag: Tag,
  payload: Payload,
  success: Success,
) => Rpc.make(tag, { payload, success, error: StoreOperationFailed });

export const StoreRpcs = RpcGroup.make(
  /**
   * The two operations that are not table operations: they make and unmake
   * the store every other operation runs against, so the worker owns them
   * and answers an open's refusal typed, with the version it found where the
   * schema is the reason.
   */
  Rpc.make("store.open", {
    payload: StoreOpenOptionsSchema,
    success: Schema.Boolean,
    error: Schema.Union(StoreSchemaRefused, StoreOperationFailed),
  }),
  operation("store.close", NoParams, Schema.Boolean),

  operation("brain.load", { sessionKey: SessionKeySchema }, carried<EnvelopeRead>()),
  operation(
    "brain.save",
    { sessionKey: SessionKeySchema, save: carried<BrainStateSave>() },
    Schema.Boolean,
  ),

  operation(
    "conversation.append",
    {
      sessionKey: SessionKeySchema,
      entries: carried<readonly ConversationEntry[]>(),
      now: Schema.Number,
    },
    carried<ConversationAppendOutcome<ConversationEntry>>(),
  ),
  operation(
    "conversation.list",
    { sessionKey: SessionKeySchema, now: Schema.Number },
    carried<readonly ConversationEntry[]>(),
  ),
  operation(
    "conversation.cutoff",
    { sessionKey: SessionKeySchema },
    Schema.UndefinedOr(Schema.Number),
  ),
  operation(
    "conversation.search",
    {
      sessionKeys: Schema.Array(SessionKeySchema),
      query: Schema.String,
      limit: Schema.Number,
      now: Schema.Number,
    },
    carried<readonly ConversationSearchHit[]>(),
  ),

  operation("notebook.list", { now: Schema.Number }, carried<readonly NotebookEntry[]>()),
  operation(
    "notebook.remember",
    {
      id: Schema.String,
      words: Schema.String,
      replaces: Schema.optionalWith(Schema.String, { exact: true }),
      now: Schema.Number,
    },
    carried<NotebookMutation>(),
  ),
  operation(
    "notebook.forget",
    { id: Schema.String, now: Schema.Number },
    carried<NotebookMutation>(),
  ),

  operation(
    "memory.plan-sync",
    {
      identity: Schema.optionalWith(carried<EmbeddingModelIdentity>(), { exact: true }),
      now: Schema.Number,
    },
    carried<MemoryScanPlan>(),
  ),
  operation(
    "memory.apply-sync",
    {
      changed: carried<readonly IndexedFileWrite[]>(),
      removed: Schema.Array(Schema.String),
      embeddings: carried<readonly EmbeddingWrite[]>(),
      identity: Schema.optionalWith(carried<EmbeddingModelIdentity>(), { exact: true }),
      now: Schema.Number,
    },
    carried<MemoryApplyReport>(),
  ),
  operation("memory.search", carried<MemorySearchQuery>(), carried<MemorySearchOutcome>()),
  operation(
    "memory.get",
    {
      path: Schema.String,
      from: Schema.optionalWith(Schema.Number, { exact: true }),
      lines: Schema.optionalWith(Schema.Number, { exact: true }),
    },
    carried<MemoryReadResult | undefined>(),
  ),
  operation("memory.rebuild", NoParams, Schema.Boolean),
  operation("memory.status", NoParams, carried<MemoryIndexStatus>()),
  operation(
    "memory.flush-state.get",
    { sessionKey: SessionKeySchema, generationId: Schema.String },
    carried<FlushState | undefined>(),
  ),
  operation(
    "memory.flush-state.put",
    { sessionKey: SessionKeySchema, state: carried<FlushState>() },
    Schema.Boolean,
  ),

  operation("conversations.list", NoParams, carried<readonly ConversationRecord[]>()),
  operation("conversations.create", carried<ConversationCreation>(), carried<ConversationRecord>()),
  operation(
    "conversations.archive",
    { sessionKey: SessionKeySchema, now: Schema.Number, reason: ArchiveReasonSchema },
    Schema.Boolean,
  ),
  operation("conversations.unarchive", { sessionKey: SessionKeySchema }, Schema.Boolean),
  operation(
    "conversations.pin",
    { sessionKey: SessionKeySchema, pinnedAt: Schema.optionalWith(Schema.Number, { exact: true }) },
    Schema.Boolean,
  ),
  operation(
    "conversations.delete",
    carried<{ sessionKey: SessionKey; now: number } & DeletionOptions>(),
    carried<DeletionOutcome | undefined>(),
  ),

  operation(
    "maintenance.run",
    { now: Schema.Number, preserve: Schema.Array(SessionKeySchema) },
    carried<MaintenanceReport>(),
  ),

  operation("children.list", NoParams, carried<readonly ChildRunRecord[]>()),
  operation("children.put", { record: carried<ChildRunRecord>() }, Schema.Boolean),
  operation("children.delete", { childId: Schema.String }, Schema.Boolean),
  operation("completions.list", NoParams, carried<readonly ChildCompletionRecord[]>()),
  operation("completions.put", { completion: carried<ChildCompletionRecord>() }, Schema.Boolean),
  operation("completions.delete", { completionId: Schema.String }, Schema.Boolean),
);

/** One operation of the group, by any of its tags. */
export type StoreRpc = RpcGroup.Rpcs<typeof StoreRpcs>;

export type StoreOperationName = StoreRpc["_tag"];

/** One operation's parameters and answer, read off the group by name. */
export type OperationParams<Name extends StoreOperationName> = Rpc.PayloadConstructor<
  Rpc.ExtractTag<StoreRpc, Name>
>;
export type OperationResult<Name extends StoreOperationName> = Rpc.Success<
  Rpc.ExtractTag<StoreRpc, Name>
>;

const WORKSPACE_DIRECTORY = "workspace";

/**
 * Opens the database under the agent root given and creates the conversation
 * the open names; the store lives in the scope and closes with it. The
 * stable facts an earlier build kept move into the notebook at the first
 * open that finds them, under their own ids, and never again.
 */
export function openStore(
  options: StoreOpenOptions,
): Effect.Effect<OpenStore, SqlError | StoreSchemaRefused, Scope.Scope> {
  return Effect.gen(function* () {
    const workspace =
      options.workspaceDirectory ?? path.join(options.agentRoot, WORKSPACE_DIRECTORY);
    const db = yield* Effect.acquireRelease(
      StoreDatabase.open(path.join(options.agentRoot, AGENT_DATABASE_FILE)),
      (database) => Effect.sync(() => database.close()),
    );
    yield* Effect.provide(
      Effect.zipRight(
        createConversationEffect({
          agentId: options.agentId,
          sessionKey: options.sessionKey,
          name: options.conversationName,
          now: options.now,
        }),
        migrateFactsIntoNotebookEffect(workspace, options.now),
      ),
      db.sql,
    );
    return { db, agentRoot: options.agentRoot, workspace };
  });
}
