import type { BrainFlushInput, BrainFlushMarkerStore } from "@sidecar/brain";
import { completeToolFree, runMemoryHousekeeping } from "@sidecar/brain";
import {
  CANDIDATE_ORIGIN,
  type CandidateOrigin,
  CONSOLIDATION_DEFAULTS,
  type ConsolidationSweepReport,
  DEEP_PATH,
  type HousekeepingPrompt,
  housekeepingCompleted,
  type IngestibleHistoryLine,
  isMaintenanceEligibleConversation,
  localDayStamp,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryHousekeepingResult,
  memoryFlushPrompt,
  resetCapturePrompt,
  runConsolidationSweep,
} from "@sidecar/memory";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import { readWorkspaceFile, writeWorkspaceFile } from "@sidecar/runtime";
import type { AgentRuntime, ConversationRecord, SessionKey } from "@sidecar/runtime-contracts";
import type {
  MemoryForgetAsk,
  MemoryForgetReport,
  RuntimeStoreClient,
} from "@sidecar/runtime-store";
import type { WireRecord } from "@sidecar/wire";

/**
 * Memory maintenance as the desktop wires it: the pre-compaction flush hook
 * and flush marker each eligible conversation's brain is handed, the capture
 * run before an eligible private conversation starts fresh, the daily
 * consolidation sweep the memory package runs over the store, the History
 * lines, and one tool-free completion, and source-aware forgetting. Every
 * model call is a tool-free or workspace-only run over a private context
 * that is dropped at its end, on the developer's own key or through Luke's
 * service.
 */

export type { ConsolidationSweepReport };
export { DEEP_PATH };

export interface MemoryMaintenanceDependencies {
  persistent: boolean;
  client: () => RuntimeStoreClient;
  /** A runtime for the housekeeping and consolidation runs, or nothing when no brain may stand. */
  createRuntime: () => AgentRuntime | undefined;
  workspaceDirectory: () => string;
  conversationDirectory: () => readonly ConversationRecord[];
  isTemporary: (sessionKey: SessionKey) => boolean;
  /** One conversation's retained History lines, the light phase's source. */
  historyLines: (sessionKey: SessionKey) => readonly ConversationEntry[];
  /** Runs work on the background lane, the shared budget consolidation completions spend. */
  background: <T>(work: () => Promise<T>) => Promise<T>;
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
  /** Hears every committed notebook change, so the index syncs and recall caches clear. */
  onNotebookChanged?: () => void;
}

export interface MemoryMaintenance {
  /** The flush hook for one conversation, or nothing for one that never flushes. */
  flushHookFor: (
    sessionKey: SessionKey,
  ) => ((input: BrainFlushInput) => Promise<MemoryHousekeepingResult>) | undefined;
  /**
   * Where one conversation's flush marker outlives the process: the store's
   * flush-state row, read and written under the generation the brain names,
   * so a relaunch knows which cycle was flushed and a new lifetime reads none.
   * Nothing for a conversation that never flushes.
   */
  flushMarkerFor: (sessionKey: SessionKey) => BrainFlushMarkerStore | undefined;
  /** Whether a conversation's reset captures first: main and the developer's durable private threads. */
  capturesOnReset: (sessionKey: SessionKey) => boolean;
  /** The capture run before a reset, over a copy of the conversation's context; never blocks the reset's outcome. */
  captureBeforeReset: (
    sessionKey: SessionKey,
    items: readonly WireRecord[],
  ) => Promise<MemoryHousekeepingResult>;
  /** One full sweep: light, REM, deep; nothing on a run with no store. */
  runConsolidation: () => Promise<ConsolidationSweepReport | undefined>;
  /** Source-aware forgetting; nothing on a run with no store. */
  forget: (ask: MemoryForgetAsk) => Promise<MemoryForgetReport | undefined>;
}

function originOf(kind: ConversationEntry["kind"]): CandidateOrigin {
  switch (kind) {
    case CONVERSATION_ENTRY_KIND.TYPED_ASK:
    case CONVERSATION_ENTRY_KIND.SPOKEN_ASK:
      return CANDIDATE_ORIGIN.USER;
    case CONVERSATION_ENTRY_KIND.REPLY:
    case CONVERSATION_ENTRY_KIND.ANNOUNCEMENT:
      return CANDIDATE_ORIGIN.AGENT;
    default:
      // An act's narration, a child's or a system's words relayed into the
      // thread: evidence, but never trusted by repetition.
      return CANDIDATE_ORIGIN.SYSTEM;
  }
}

/** A History line as the sweep is handed it: the same kind and words the hash reads, and who said it. */
function ingestibleLine(entry: ConversationEntry): IngestibleHistoryLine {
  return {
    kind: entry.kind,
    words: entry.words,
    origin: originOf(entry.kind),
    ...(entry.eventId ? { eventId: entry.eventId } : undefined),
    ...(entry.recordedAt !== undefined ? { recordedAt: entry.recordedAt } : undefined),
  };
}

export function wireMemoryMaintenance(
  dependencies: MemoryMaintenanceDependencies,
): MemoryMaintenance {
  const workspace = () => ({
    read: (name: string) => readWorkspaceFile(dependencies.workspaceDirectory(), name),
    write: (name: string, content: string) =>
      writeWorkspaceFile(dependencies.workspaceDirectory(), name, content),
  });

  const maintained = (sessionKey: SessionKey): boolean =>
    isMaintenanceEligibleConversation(sessionKey, {
      temporary: dependencies.isTemporary(sessionKey),
    });

  const eligible = (sessionKey: SessionKey): boolean =>
    dependencies.persistent && maintained(sessionKey);

  const housekeeping = async (
    items: readonly WireRecord[],
    prompt: HousekeepingPrompt,
    dateStamp: string,
    signal: AbortSignal,
  ): Promise<MemoryHousekeepingResult> => {
    const runtime = dependencies.createRuntime();
    if (!runtime) {
      return {
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
        writes: 0,
        reason: "no brain stands to run it",
      };
    }
    const result = await runMemoryHousekeeping({
      runtime,
      items,
      prompt,
      dateStamp,
      workspace: workspace(),
      signal,
      runId: dependencies.createId(),
    });
    if (result.writes > 0) dependencies.onNotebookChanged?.();
    return result;
  };

  const flushHookFor: MemoryMaintenance["flushHookFor"] = (sessionKey) => {
    if (!eligible(sessionKey)) return undefined;
    return (input) => {
      const day = localDayStamp(dependencies.now());
      return housekeeping(input.items, memoryFlushPrompt(day), day, input.signal);
    };
  };

  const flushMarkerFor: MemoryMaintenance["flushMarkerFor"] = (sessionKey) => {
    if (!eligible(sessionKey)) return undefined;
    return {
      read: async (generationId) => {
        const state = await dependencies.client().memoryFlushState(sessionKey, generationId);
        return state && housekeepingCompleted(state.outcome) ? state.compactionCount : undefined;
      },
      write: async (generationId, compactionCount) => {
        const recorded = await dependencies.client().recordMemoryFlush(sessionKey, {
          generationId,
          compactionCount,
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
          flushedAt: dependencies.now(),
        });
        if (!recorded) throw new Error("the store refused the flush marker");
      },
    };
  };

  const captureBeforeReset: MemoryMaintenance["captureBeforeReset"] = async (sessionKey, items) => {
    if (!eligible(sessionKey)) {
      return {
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
        writes: 0,
        reason: "not an eligible private conversation",
      };
    }
    if (items.length === 0) {
      return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE, writes: 0 };
    }
    const day = localDayStamp(dependencies.now());
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      CONSOLIDATION_DEFAULTS.CONSOLIDATION_TIMEOUT_MS,
    );
    try {
      return await housekeeping(items, resetCapturePrompt(day), day, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  const runConsolidation: MemoryMaintenance["runConsolidation"] = () => {
    if (!dependencies.persistent) return Promise.resolve(undefined);
    return dependencies.background(async () => {
      const runtime = dependencies.createRuntime();
      try {
        return await runConsolidationSweep({
          store: dependencies.client(),
          workspaceDirectory: dependencies.workspaceDirectory,
          eligibleConversations: () =>
            dependencies
              .conversationDirectory()
              .filter((record) => record.archivedAt === undefined && maintained(record.sessionKey))
              .map((record) => record.sessionKey),
          historyLines: (sessionKey) => dependencies.historyLines(sessionKey).map(ingestibleLine),
          completeToolFree: runtime
            ? (ask) => completeToolFree({ ...ask, runtime, runId: dependencies.createId() })
            : undefined,
          now: dependencies.now,
          ...(dependencies.onNotebookChanged
            ? { onNotebookChanged: dependencies.onNotebookChanged }
            : undefined),
        });
      } catch (error) {
        dependencies.report(
          `Memory consolidation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    });
  };

  const forget: MemoryMaintenance["forget"] = async (ask) => {
    if (!dependencies.persistent) return undefined;
    const report = await dependencies.client().forgetMemorySources(ask, dependencies.now());
    dependencies.onNotebookChanged?.();
    for (const limitation of report.limitations) {
      dependencies.report(`Memory forget limitation: ${limitation}`);
    }
    return report;
  };

  return {
    flushHookFor,
    flushMarkerFor,
    capturesOnReset: eligible,
    captureBeforeReset,
    runConsolidation,
    forget,
  };
}
