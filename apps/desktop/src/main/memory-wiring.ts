import type { BrainMemoryAccess, BrainRecallAsk } from "@sidecar/brain";
import { EMBEDDING_BATCH_SIZE, runRecallSubrun } from "@sidecar/brain";
import {
  type EmbeddingProviderSelection,
  localDayStamp,
  MEMORY_SOURCE,
  type MemorySearchResult,
  type MemorySyncReport,
  NotebookMemory,
  RETRIEVAL_MODE,
  type RetrievalMode,
  recallSignalSeeds,
} from "@sidecar/memory";
import type { ConversationEntry } from "@sidecar/realtime";
import { DAILY_NOTES_DIRECTORY } from "@sidecar/runtime";
import type {
  AgentRuntime,
  ConversationRecord,
  EmbeddingAdapter,
  SessionKey,
} from "@sidecar/runtime-contracts";
import type { RuntimeStoreClient } from "@sidecar/runtime-store";

/**
 * The notebook's index and recall as the desktop wires them: the memory
 * package's host over the store's worker, the embedding adapter the
 * credential policy built, and the brain's recall subrun. This module only
 * composes; the sync, the search, and the recall live in `NotebookMemory`.
 */

export interface MemoryWiringDependencies {
  persistent: boolean;
  client: () => RuntimeStoreClient;
  /** The embedding adapter the credential policy built, or nothing when no credential stands. */
  embeddingAdapter: () => EmbeddingAdapter | undefined;
  /** Hears every credential change that may have replaced the adapter; the index is synced again so keyword-only chunks gain their vectors. */
  onEmbeddingAdapterChanged?: (listener: () => void) => void;
  embeddingSelection?: EmbeddingProviderSelection;
  /** The agent's identity workspace, watched for the notebook's files. */
  workspaceDirectory: () => string;
  /** A runtime for the recall subrun, or nothing when no brain may stand. */
  createRuntime: () => AgentRuntime | undefined;
  conversationDirectory: () => readonly ConversationRecord[];
  isTemporary: (sessionKey: SessionKey) => boolean;
  /** One conversation's retained lines, for the recall's small recent-turn input. */
  historyLines: (sessionKey: SessionKey) => readonly ConversationEntry[];
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
  /** Hears every completed sync, so the notebook's cached entries can be read again after a hand edit. */
  onSynced?: () => void;
}

export type { MemorySyncReport };

export interface MemoryWiring {
  /** Syncs once and starts watching; a run with nothing on disk does neither. */
  start: () => Promise<void>;
  stop: () => void;
  /** One reconcile of the index against the files; a call during a pass earns one follow-on pass under the adapter standing then. */
  sync: () => Promise<MemorySyncReport | undefined>;
  /** The brain's memory tools for one conversation. */
  accessFor: (sessionKey: SessionKey) => BrainMemoryAccess | undefined;
  /** The recall an eligible conversation's asks run, or nothing for one that does not recall. */
  recallFor: (
    sessionKey: SessionKey,
  ) => ((ask: BrainRecallAsk) => Promise<string | undefined>) | undefined;
  /** The retrieval mode the last sync settled on. */
  mode: () => RetrievalMode;
  /** Forgets every cached recall, after a forget or a durable rewrite changed what a recall would say. */
  clearRecallCaches: () => void;
}

const RECALL_RUN_ID_PREFIX = "recall-";

/** A run without a notebook: nothing on disk to index, so nothing to search or recall. */
const INERT_MEMORY_WIRING: MemoryWiring = {
  start: async () => undefined,
  stop: () => undefined,
  sync: async () => undefined,
  accessFor: () => undefined,
  recallFor: () => undefined,
  mode: () => RETRIEVAL_MODE.KEYWORD_ONLY,
  clearRecallCaches: () => undefined,
};

export function wireMemory(dependencies: MemoryWiringDependencies): MemoryWiring {
  if (!dependencies.persistent) return INERT_MEMORY_WIRING;

  /**
   * A search that surfaces a dated note's lines is a recall signal for
   * consolidation: the snippet is staged as a short-term candidate under the
   * query that found it, so a fact recalled on several days under several
   * questions can earn promotion. Curated files are already durable and stage
   * nothing; nothing here changes what the search answered.
   */
  const recordRecallSignals = async (
    query: string,
    results: readonly MemorySearchResult[],
  ): Promise<void> => {
    const now = dependencies.now();
    const seeds = recallSignalSeeds(
      query,
      results.filter((result) => result.source === MEMORY_SOURCE.MEMORY),
      localDayStamp(now),
      DAILY_NOTES_DIRECTORY,
    );
    if (seeds.length === 0) return;
    try {
      await dependencies.client().stageMemoryCandidates(seeds, now);
    } catch (error) {
      dependencies.report(
        `Recall signal could not be recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const memory = new NotebookMemory({
    store: dependencies.client,
    embeddingAdapter: dependencies.embeddingAdapter,
    ...(dependencies.embeddingSelection
      ? { embeddingSelection: dependencies.embeddingSelection }
      : undefined),
    embeddingBatchSize: EMBEDDING_BATCH_SIZE,
    workspaceDirectory: dependencies.workspaceDirectory,
    conversationDirectory: dependencies.conversationDirectory,
    isTemporary: dependencies.isTemporary,
    historyLines: dependencies.historyLines,
    runSubrun: async (ask) => {
      const runtime = dependencies.createRuntime();
      if (!runtime) return undefined;
      return runRecallSubrun({
        runtime,
        memory: ask.memory,
        query: ask.query,
        recentTurns: ask.recentTurns,
        signal: ask.signal,
        runId: `${RECALL_RUN_ID_PREFIX}${dependencies.createId()}`,
      });
    },
    now: dependencies.now,
    report: dependencies.report,
    ...(dependencies.onSynced ? { onSynced: dependencies.onSynced } : undefined),
    onNotebookResults: recordRecallSignals,
  });
  dependencies.onEmbeddingAdapterChanged?.(() => {
    void memory.sync();
  });
  return {
    start: () => memory.start(),
    stop: () => memory.stop(),
    sync: () => memory.sync(),
    accessFor: (sessionKey) => memory.accessFor(sessionKey),
    recallFor: (sessionKey) => memory.recallFor(sessionKey),
    mode: () => memory.mode(),
    clearRecallCaches: () => memory.clearRecallCaches(),
  };
}
