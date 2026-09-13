import { EMBEDDING_BATCH_SIZE } from "@sidecar/brain";
import type { StoreClient } from "@sidecar/brain/store";
import {
  type MemorySyncReport,
  makeNotebookMemory,
  type NotebookMemory,
  type NotebookMemoryAccess,
  RETRIEVAL_MODE,
  type RetrievalMode,
} from "@sidecar/memory";
import type { ConversationRecord, EmbeddingAdapter, SessionKey } from "@sidecar/runtime/vocabulary";
import { Effect, type FileSystem, type Scope } from "effect";

/** The notebook's index as the host holds it, and what a run without one still answers. */
export interface MemoryWiring {
  /** Syncs once and starts watching; a run with nothing on disk does neither. */
  readonly start: Effect.Effect<void>;
  /** One reconcile of the index against the files; a call during a pass earns one follow-on pass under the adapter standing then. */
  readonly sync: Effect.Effect<MemorySyncReport | undefined>;
  /** That same reconcile, asked for and not waited on. */
  readonly requestSync: Effect.Effect<void>;
  /** The index's search and read for one conversation, as the memory provider offers them. */
  accessFor: (sessionKey: SessionKey) => NotebookMemoryAccess | undefined;
  /** The retrieval mode the last sync settled on. */
  readonly mode: Effect.Effect<RetrievalMode>;
}

/** A run without a notebook: nothing on disk to index, so nothing to search. */
export const INERT_MEMORY_WIRING: MemoryWiring = {
  start: Effect.void,
  sync: Effect.succeed(undefined),
  requestSync: Effect.void,
  accessFor: () => undefined,
  mode: Effect.succeed(RETRIEVAL_MODE.KEYWORD_ONLY),
};

export interface NotebookMemoryDependencies {
  client: () => StoreClient;
  /** The embedding adapter the credential policy built, or nothing when no credential stands. */
  embeddingAdapter: () => EmbeddingAdapter | undefined;
  /** The agent's identity workspace, watched for the notebook's files. */
  workspaceDirectory: () => string;
  conversationDirectory: () => readonly ConversationRecord[];
  isTemporary: (sessionKey: SessionKey) => boolean;
  now: () => number;
  report: (message: string) => void;
  /** Run at the end of every completed sync, so the notebook's cached entries can be read again after a hand edit. */
  onSynced?: Effect.Effect<void>;
}

/**
 * The notebook's index as the host wires it: the memory package's index over
 * the store's worker and the embedding adapter the credential policy built,
 * built in the caller's scope, which is its stop. This composes only; the
 * sync and the search live in the memory package.
 */
export function composeNotebookMemory(
  dependencies: NotebookMemoryDependencies,
): Effect.Effect<NotebookMemory, never, FileSystem.FileSystem | Scope.Scope> {
  return makeNotebookMemory({
    store: () => dependencies.client().notebookMemoryStore(),
    embeddingAdapter: dependencies.embeddingAdapter,
    embeddingBatchSize: EMBEDDING_BATCH_SIZE,
    workspaceDirectory: dependencies.workspaceDirectory,
    conversationDirectory: dependencies.conversationDirectory,
    isTemporary: dependencies.isTemporary,
    now: dependencies.now,
    report: dependencies.report,
    ...(dependencies.onSynced ? { onSynced: dependencies.onSynced } : undefined),
  });
}
