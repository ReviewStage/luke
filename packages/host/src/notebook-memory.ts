import type { BrainMemoryAccess } from "@sidecar/brain";
import { EMBEDDING_BATCH_SIZE } from "@sidecar/brain";
import {
  type MemorySyncReport,
  NotebookMemory,
  RETRIEVAL_MODE,
  type RetrievalMode,
} from "@sidecar/memory";
import type { ConversationRecord, EmbeddingAdapter, SessionKey } from "@sidecar/runtime/vocabulary";
import type { RuntimeStoreClient } from "@sidecar/runtime-store";

/** The notebook's index as the host holds it, and what a run without one still answers. */
export interface MemoryWiring {
  /** Syncs once and starts watching; a run with nothing on disk does neither. */
  start: () => Promise<void>;
  stop: () => void;
  /** One reconcile of the index against the files; a call during a pass earns one follow-on pass under the adapter standing then. */
  sync: () => Promise<MemorySyncReport | undefined>;
  /** The brain's memory tools for one conversation. */
  accessFor: (sessionKey: SessionKey) => BrainMemoryAccess | undefined;
  /** The retrieval mode the last sync settled on. */
  mode: () => RetrievalMode;
}

/** A run without a notebook: nothing on disk to index, so nothing to search. */
export const INERT_MEMORY_WIRING: MemoryWiring = {
  start: async () => undefined,
  stop: () => undefined,
  sync: async () => undefined,
  accessFor: () => undefined,
  mode: () => RETRIEVAL_MODE.KEYWORD_ONLY,
};

export interface NotebookMemoryDependencies {
  client: () => RuntimeStoreClient;
  /** The embedding adapter the credential policy built, or nothing when no credential stands. */
  embeddingAdapter: () => EmbeddingAdapter | undefined;
  /** Hears every credential change that may have replaced the adapter; the index is synced again so keyword-only chunks gain their vectors. */
  onEmbeddingAdapterChanged?: (listener: () => void) => void;
  /** The agent's identity workspace, watched for the notebook's files. */
  workspaceDirectory: () => string;
  conversationDirectory: () => readonly ConversationRecord[];
  isTemporary: (sessionKey: SessionKey) => boolean;
  now: () => number;
  report: (message: string) => void;
  /** Hears every completed sync, so the notebook's cached entries can be read again after a hand edit. */
  onSynced?: () => void;
}

/**
 * The notebook's index as the host wires it: the memory package's host over
 * the store's worker and the embedding adapter the credential policy built.
 * This composes only; the sync and the search live in `NotebookMemory`.
 */
export function composeNotebookMemory(dependencies: NotebookMemoryDependencies): NotebookMemory {
  const memory = new NotebookMemory({
    store: dependencies.client,
    embeddingAdapter: dependencies.embeddingAdapter,
    embeddingBatchSize: EMBEDDING_BATCH_SIZE,
    workspaceDirectory: dependencies.workspaceDirectory,
    conversationDirectory: dependencies.conversationDirectory,
    isTemporary: dependencies.isTemporary,
    now: dependencies.now,
    report: dependencies.report,
    ...(dependencies.onSynced ? { onSynced: dependencies.onSynced } : undefined),
  });
  dependencies.onEmbeddingAdapterChanged?.(() => {
    void memory.sync();
  });
  return memory;
}
