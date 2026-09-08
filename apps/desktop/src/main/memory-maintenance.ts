import type { BrainFlushInput, BrainFlushMarkerStore } from "@sidecar/brain";
import { runMemoryHousekeeping } from "@sidecar/brain";
import {
  type HousekeepingPrompt,
  housekeepingCompleted,
  isMaintenanceEligibleConversation,
  localDayStamp,
  MEMORY_FLUSH_DEFAULTS,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryHousekeepingResult,
  memoryFlushPrompt,
  resetCapturePrompt,
} from "@sidecar/memory";
import { readWorkspaceFile, writeWorkspaceFile } from "@sidecar/runtime";
import type { AgentRuntime, SessionKey } from "@sidecar/runtime-contracts";
import type {
  NotebookForgetAsk,
  NotebookForgetReport,
  RuntimeStoreClient,
} from "@sidecar/runtime-store";
import type { WireRecord } from "@sidecar/wire";

/**
 * Memory maintenance as the desktop wires it: the pre-compaction flush hook
 * and flush marker each eligible conversation's brain is handed, the capture
 * run before an eligible private conversation starts fresh, and forgetting
 * the notebook entries an ask names. Every model call is a workspace-only
 * run over a private context that is dropped at its end, on the developer's
 * own key or through Luke's service.
 */

export interface MemoryMaintenanceDependencies {
  persistent: boolean;
  client: () => RuntimeStoreClient;
  /** A runtime for the housekeeping runs, or nothing when no brain may stand. */
  createRuntime: () => AgentRuntime | undefined;
  workspaceDirectory: () => string;
  isTemporary: (sessionKey: SessionKey) => boolean;
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
  /** Hears every committed notebook change, so the index syncs. */
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
  /** Forgets the notebook entries an ask names; nothing on a run with no store. */
  forget: (ask: NotebookForgetAsk) => Promise<NotebookForgetReport | undefined>;
}

export function wireMemoryMaintenance(
  dependencies: MemoryMaintenanceDependencies,
): MemoryMaintenance {
  const workspace = () => ({
    read: (name: string) => readWorkspaceFile(dependencies.workspaceDirectory(), name),
    write: (name: string, content: string) =>
      writeWorkspaceFile(dependencies.workspaceDirectory(), name, content),
  });

  const eligible = (sessionKey: SessionKey): boolean =>
    dependencies.persistent &&
    isMaintenanceEligibleConversation(sessionKey, dependencies.isTemporary(sessionKey));

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
      MEMORY_FLUSH_DEFAULTS.RESET_CAPTURE_TIMEOUT_MS,
    );
    try {
      return await housekeeping(items, resetCapturePrompt(day), day, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  const forget: MemoryMaintenance["forget"] = async (ask) => {
    if (!dependencies.persistent) return undefined;
    const report = await dependencies.client().forgetNotebookEntries(ask, dependencies.now());
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
    forget,
  };
}
