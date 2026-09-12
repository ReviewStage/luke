import type { BrainFlushMarkerStore } from "@sidecar/brain";
import { carryOn, runMemoryHousekeeping } from "@sidecar/brain";
import type { StoreClient } from "@sidecar/brain/store";
import {
  type HousekeepingPrompt,
  housekeepingCompleted,
  isMaintenanceEligibleConversation,
  localDayStamp,
  MEMORY_FLUSH_DEFAULTS,
  MEMORY_HOUSEKEEPING_OUTCOME,
  memoryFlushPrompt,
  resetCapturePrompt,
} from "@sidecar/memory";
import { readWorkspaceFile, writeWorkspaceFile } from "@sidecar/runtime";
import {
  type AgentRuntimeEffect,
  type ExecutionRuntime,
  MEMORY_CAPTURE_PHASE,
  type MemoryCaptureResult,
  type MemoryCaptureTurn,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";

/**
 * Memory maintenance as the host wires it: the capture each eligible
 * conversation's memory provider carries — the pre-compaction flush at a
 * compaction, the reset capture before the conversation starts fresh — and
 * the flush marker the brain keeps its cycle by. Every model call is a
 * workspace-only run over a private context that is dropped at its end, on
 * the developer's own key or through Luke's service.
 */

export interface MemoryMaintenanceDependencies {
  persistent: boolean;
  client: () => StoreClient;
  /** A runtime for the housekeeping runs, or nothing when no brain may stand. */
  createRuntime: () => AgentRuntimeEffect | undefined;
  /** The runtime a housekeeping turn is a fiber of, since the memory provider's capture seam is still a promise. */
  execution: ExecutionRuntime;
  workspaceDirectory: () => string;
  isTemporary: (sessionKey: SessionKey) => boolean;
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
  /** Hears every committed notebook change, so the index syncs. */
  onNotebookChanged?: () => void;
}

type MemoryCapture = (turn: MemoryCaptureTurn) => Promise<MemoryCaptureResult>;

export interface MemoryMaintenance {
  /**
   * The capture for one conversation, or nothing for one whose memory is
   * never captured: main and the developer's durable private threads
   * capture, never a temporary thread, an observed session, or a child. A
   * reset's capture is cut at its own timeout; the flush runs under the
   * signal the brain hands it. Neither blocks the compaction or the reset
   * that asked for it.
   */
  captureFor: (sessionKey: SessionKey) => MemoryCapture | undefined;
  /**
   * Where one conversation's flush marker outlives the process: the store's
   * flush-state row, read and written under the generation the brain names,
   * so a relaunch knows which cycle was flushed and a new lifetime reads none.
   * Nothing for a conversation that never flushes.
   */
  flushMarkerFor: (sessionKey: SessionKey) => BrainFlushMarkerStore | undefined;
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
    turn: MemoryCaptureTurn,
    prompt: HousekeepingPrompt,
    dateStamp: string,
    signal: AbortSignal,
  ): Promise<MemoryCaptureResult> => {
    const runtime = dependencies.createRuntime();
    if (!runtime) {
      return {
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
        writes: 0,
        reason: "no brain stands to run it",
      };
    }
    const result = await carryOn(dependencies.execution)(
      runMemoryHousekeeping({
        runtime,
        items: turn.items,
        prompt,
        dateStamp,
        workspace: workspace(),
        signal,
        runId: dependencies.createId(),
      }),
    );
    if (result.writes > 0) dependencies.onNotebookChanged?.();
    return result;
  };

  const flush: MemoryCapture = (turn) => {
    const day = localDayStamp(dependencies.now());
    return housekeeping(turn, memoryFlushPrompt(day), day, turn.signal);
  };

  const resetCapture: MemoryCapture = async (turn) => {
    if (turn.items.length === 0) {
      return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE, writes: 0 };
    }
    const day = localDayStamp(dependencies.now());
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      MEMORY_FLUSH_DEFAULTS.RESET_CAPTURE_TIMEOUT_MS,
    );
    try {
      return await housekeeping(
        turn,
        resetCapturePrompt(day),
        day,
        AbortSignal.any([turn.signal, controller.signal]),
      );
    } finally {
      clearTimeout(timer);
    }
  };

  const captureFor: MemoryMaintenance["captureFor"] = (sessionKey) => {
    if (!eligible(sessionKey)) return undefined;
    return (turn) =>
      turn.phase === MEMORY_CAPTURE_PHASE.RESET_REQUESTED ? resetCapture(turn) : flush(turn);
  };

  const flushMarkerFor: MemoryMaintenance["flushMarkerFor"] = (sessionKey) => {
    if (!eligible(sessionKey)) return undefined;
    return {
      read: async (generationId) => {
        const state = await dependencies.client().ask("memory.flush-state.get", {
          sessionKey,
          generationId,
        });
        return state && housekeepingCompleted(state.outcome) ? state.compactionCount : undefined;
      },
      write: async (generationId, compactionCount) => {
        const recorded = await dependencies.client().ask("memory.flush-state.put", {
          sessionKey,
          state: {
            generationId,
            compactionCount,
            outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
            flushedAt: dependencies.now(),
          },
        });
        if (!recorded) throw new Error("the store refused the flush marker");
      },
    };
  };

  return { captureFor, flushMarkerFor };
}
