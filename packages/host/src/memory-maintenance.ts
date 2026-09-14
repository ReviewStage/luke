import type { BrainFlushMarkerStore } from "@sidecar/brain";
import { runMemoryHousekeeping } from "@sidecar/brain";
import {
  type HousekeepingPrompt,
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
  MEMORY_CAPTURE_PHASE,
  type MemoryCaptureResult,
  type MemoryCaptureTurn,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";

/**
 * Memory maintenance as the host wires it: the capture each eligible
 * conversation's memory provider carries — the pre-compaction flush at a
 * compaction, the reset capture before the conversation starts fresh — and
 * the flush marker the brain keeps its cycle by. Every model call is a
 * workspace-only run over a private context that is dropped at its end,
 * through Luke's service on the signed-in account, and what it writes is a
 * dated note in the agent's workspace on disk.
 */

export interface MemoryMaintenanceDependencies {
  /** A runtime for the housekeeping runs, or nothing when no brain may stand. */
  createRuntime: () => AgentRuntimeEffect | undefined;
  workspaceDirectory: () => string;
  isTemporary: (sessionKey: SessionKey) => boolean;
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
}

type MemoryCapture = (turn: MemoryCaptureTurn) => Effect.Effect<MemoryCaptureResult>;

/** Which compaction of which generation a conversation last flushed at. */
interface FlushMark {
  readonly generationId: string;
  readonly compactionCount: number;
}

export interface MemoryMaintenance {
  /**
   * The capture for one conversation, or nothing for one whose memory is
   * never captured: main captures, never a conversation opened in this run
   * for an observed session or a child. A
   * reset's capture is cut at its own timeout; the flush runs under the
   * signal the brain hands it. Neither blocks the compaction or the reset
   * that asked for it.
   */
  captureFor: (sessionKey: SessionKey) => MemoryCapture | undefined;
  /**
   * Where one conversation's flush marker stands for this run: held in
   * memory under the generation the brain names, so a second compaction of
   * one cycle is not flushed twice and a new lifetime reads none. The
   * generation itself is this run's alone, so a marker outliving it would
   * name nothing. Nothing for a conversation that never flushes.
   */
  flushMarkerFor: (sessionKey: SessionKey) => BrainFlushMarkerStore | undefined;
}

export function wireMemoryMaintenance(
  dependencies: MemoryMaintenanceDependencies,
): MemoryMaintenance {
  const workspace = () => ({
    read: (name: string) =>
      Effect.promise(() => readWorkspaceFile(dependencies.workspaceDirectory(), name)),
    write: (name: string, content: string) =>
      Effect.promise(() => writeWorkspaceFile(dependencies.workspaceDirectory(), name, content)),
  });

  const eligible = (sessionKey: SessionKey): boolean =>
    isMaintenanceEligibleConversation(sessionKey, dependencies.isTemporary(sessionKey));

  const housekeeping = /* @__PURE__ */ Effect.fnUntraced(function* (
    turn: MemoryCaptureTurn,
    prompt: HousekeepingPrompt,
    dateStamp: string,
    signal: AbortSignal,
  ): Effect.fn.Return<MemoryCaptureResult> {
    const runtime = dependencies.createRuntime();
    if (!runtime) {
      return {
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
        writes: 0,
        reason: "no brain stands to run it",
      };
    }
    return yield* runMemoryHousekeeping({
      runtime,
      items: turn.items,
      prompt,
      dateStamp,
      workspace: workspace(),
      signal,
      runId: dependencies.createId(),
    });
  });

  const flush: MemoryCapture = (turn) =>
    Effect.suspend(() => {
      const day = localDayStamp(dependencies.now());
      return housekeeping(turn, memoryFlushPrompt(day), day, turn.signal);
    });

  const resetCapture: MemoryCapture = (turn) =>
    Effect.suspend(() => {
      if (turn.items.length === 0) {
        return Effect.succeed({
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
          writes: 0,
        });
      }
      const day = localDayStamp(dependencies.now());
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        MEMORY_FLUSH_DEFAULTS.RESET_CAPTURE_TIMEOUT_MS,
      );
      return Effect.ensuring(
        housekeeping(
          turn,
          resetCapturePrompt(day),
          day,
          AbortSignal.any([turn.signal, controller.signal]),
        ),
        Effect.sync(() => {
          clearTimeout(timer);
        }),
      );
    });

  const captureFor: MemoryMaintenance["captureFor"] = (sessionKey) => {
    if (!eligible(sessionKey)) return undefined;
    return (turn) =>
      turn.phase === MEMORY_CAPTURE_PHASE.RESET_REQUESTED ? resetCapture(turn) : flush(turn);
  };

  const marks = new Map<SessionKey, FlushMark>();
  const flushMarkerFor: MemoryMaintenance["flushMarkerFor"] = (sessionKey) => {
    if (!eligible(sessionKey)) return undefined;
    return {
      read: async (generationId) => {
        const mark = marks.get(sessionKey);
        return mark?.generationId === generationId ? mark.compactionCount : undefined;
      },
      write: async (generationId, compactionCount) => {
        marks.set(sessionKey, { generationId, compactionCount });
      },
    };
  };

  return { captureFor, flushMarkerFor };
}
