import {
  failedHousekeeping,
  housekeepingCompleted,
  MEMORY_FLUSH_DEFAULTS,
  type MemoryHousekeepingResult,
  shouldRunMemoryFlush,
} from "@sidecar/memory";
import type { AgentRuntime } from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";
import {
  assessCompaction,
  COMPACTION_NEED,
  type CompactionAssessment,
  reserveTokens,
} from "./compaction.js";
import { CONTEXT_OPENING } from "./generation.js";
import type { AgentSeam } from "./seam.js";
import { claimedUnlessAborted, type Settled, settledUnlessAborted } from "./settled.js";
import {
  BRAIN_TURN_KIND,
  type BrainTurnDescription,
  type BrainTurnPreparation,
  type RunControl,
  type TurnContext,
  turnRevoked,
} from "./turn.js";

/** What the pre-compaction flush is handed: a copy of the context, never the engine itself, and the counts its gate read. */
export interface BrainFlushInput {
  readonly items: readonly WireRecord[];
  readonly contextTokens: number;
  readonly contextWindowTokens: number;
  readonly transcriptBytes: number;
  readonly compactionCount: number;
  readonly signal: AbortSignal;
}

/**
 * The durable side of the flush gate. The compaction count is the
 * generation's own and rides on its envelope; the marker saying which count
 * was flushed is maintenance state, kept here under the generation's id. A
 * write that rejects did not land, and the caller leaves the cycle unflushed.
 */
export interface BrainFlushMarkerStore {
  /** The compaction count the generation's last completed flush ran under, or nothing when none has. */
  read(generationId: string): Promise<number | undefined>;
  /** Records that a flush completed under this compaction count of this generation. */
  write(generationId: string, compactionCount: number): Promise<void>;
}

export interface MaintenanceOptions {
  seam: AgentSeam;
  runtime: AgentRuntime;
  prepareTurn: (turn: BrainTurnDescription) => BrainTurnPreparation | Promise<BrainTurnPreparation>;
  beforeCompaction?: (input: BrainFlushInput) => Promise<MemoryHousekeepingResult>;
  flushMarker?: BrainFlushMarkerStore;
  /** Holds the turn-in-flight flag while maintenance holds the context the way a turn does. */
  holdTurnInFlight: (held: boolean) => void;
}

/**
 * The compaction the brain owes its own context, and the memory flush that
 * runs a soft margin ahead of it. Two callers reach it: a turn's admission,
 * which must fit its next request, and the optional housekeeping a settled
 * turn leaves behind, which runs behind every turn already queued and is
 * cancelled by a new ask. Nothing here reaches a model except through the
 * runtime it was handed.
 */
export class Maintenance {
  readonly #options: MaintenanceOptions;
  readonly #seam: AgentSeam;
  /** The optional compaction queued after the last turn; a new ask, a stop, or a replacement cancels it. */
  #queued: AbortController | undefined;

  constructor(options: MaintenanceOptions) {
    this.#options = options;
    this.#seam = options.seam;
  }

  /** Cancels the housekeeping still waiting its turn; a new ask, a stop, or a replacement calls it. */
  cancel(): void {
    this.#queued?.abort();
    this.#queued = undefined;
  }

  /**
   * Queues the one optional maintenance a turn may leave behind: a compaction
   * of the context, decided against the window once the turn's reply is
   * persisted and its deliveries have settled. It runs behind every turn
   * already queued, under a signal a new ask cancels, so housekeeping never
   * delays the developer and never folds a context a new turn is reading.
   */
  schedule(turnContext: TurnContext, countedTokens: number | undefined): void {
    this.cancel();
    const abort = new AbortController();
    this.#queued = abort;
    void this.#seam.enqueue(() => this.#maintain(turnContext, countedTokens, abort));
  }

  async #maintain(
    turnContext: TurnContext,
    countedTokens: number | undefined,
    abort: AbortController,
  ): Promise<void> {
    const { generation, context } = turnContext;
    if (
      abort.signal.aborted ||
      this.#seam.stopped() ||
      generation !== this.#seam.generation() ||
      generation.abort.signal.aborted
    ) {
      return;
    }
    const standing = await generation.opened;
    if (standing.kind !== CONTEXT_OPENING.LOADED || standing.context !== context) return;
    const signal = AbortSignal.any([abort.signal, generation.abort.signal]);
    if (signal.aborted) return;
    // Maintenance is not a turn, but it holds the context the way one does,
    // so the roster look waits for it the way it waits for a turn.
    this.#options.holdTurnInFlight(true);
    try {
      const prepared = await this.#options.prepareTurn({ kind: BRAIN_TURN_KIND.MAINTENANCE });
      if (signal.aborted || generation !== this.#seam.generation()) return;
      const compacted = await this.compactIfNeeded(
        { generation, context, signal },
        prepared.prompt,
        countedTokens,
      );
      if (!compacted.ok)
        this.#seam.report(`Brain compaction did not complete: ${compacted.reason}`);
    } finally {
      this.#options.holdTurnInFlight(false);
    }
  }

  /**
   * The one compaction path, for the admission every turn passes before its
   * first inference and for the maintenance a settled turn leaves behind: a
   * context that would cross the transport's byte bound, or the window less
   * its reserve, is compacted and checkpointed so the request that follows
   * fits. A compaction that fails answers why; the context stands exactly as
   * it was, and nothing is deleted or cut to make the request fit. A turn
   * revoked meanwhile answers ok, having nothing left to prepare for.
   */
  async compactIfNeeded(
    turnContext: Omit<TurnContext, "run"> & { run?: RunControl },
    prompt: string,
    countedTokens?: number,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { context, signal } = turnContext;
    const capabilities = await this.#options.runtime.capabilities();
    if (this.#revoked(turnContext)) return { ok: true };
    const assessment = assessCompaction(
      context.checkpoint().items,
      prompt,
      capabilities,
      countedTokens,
    );
    // The flush fires a soft margin ahead of the fold, so in maintenance it
    // usually runs on a context not yet over the reserve; at admission it
    // runs right before the compaction the request needs.
    await this.#flushBeforeCompaction(turnContext, assessment);
    if (this.#revoked(turnContext)) return { ok: true };
    if (assessment.need === COMPACTION_NEED.NONE) return { ok: true };
    const outcome = await this.#options.runtime.compact(context, { prompt, signal });
    if (this.#revoked(turnContext)) return { ok: true };
    if (!outcome.compacted) return { ok: false, reason: outcome.reason };
    turnContext.generation.compactionCount += 1;
    if (!(await this.#seam.ledger.checkpoint(turnContext))) {
      return { ok: false, reason: "the compacted context could not be checkpointed" };
    }
    return { ok: true };
  }

  /**
   * The pre-compaction memory flush, under the pinned gate: over the soft
   * threshold or the byte trigger, and not yet flushed in this compaction
   * cycle. The hook is handed a copy of the items and never the engine, so
   * the housekeeping turn cannot reach the conversation's context; a hook
   * that says it ran to its end marks the cycle flushed, and any other
   * answer — interrupted, failed, or the signal firing first — leaves the
   * cycle unflushed so the next assessment runs it again. What the hook
   * wrote before then stands either way. The cycle is the generation's own
   * compaction count, and the marker of the last completed flush is read
   * from the marker store once per generation and written to it after each
   * completion, so a relaunch neither flushes a cycle twice nor skips one;
   * a marker that cannot be read defers the flush, and one that cannot be
   * written after its bounded attempts is reported and leaves the cycle
   * unflushed, never silently done.
   */
  async #flushBeforeCompaction(
    turnContext: Omit<TurnContext, "run"> & { run?: RunControl },
    assessment: CompactionAssessment,
  ): Promise<void> {
    const { generation, context, signal } = turnContext;
    const hook = this.#options.beforeCompaction;
    if (!hook || signal.aborted) return;
    if (!(await this.#readFlushMarker(turnContext))) return;
    const due = shouldRunMemoryFlush({
      contextTokens: assessment.contextTokens,
      contextWindowTokens: assessment.contextWindowTokens,
      reserveTokens: reserveTokens(assessment.contextWindowTokens),
      transcriptBytes: assessment.bytes,
      compactionCount: generation.compactionCount,
      ...(generation.flush.lastCompactionCount !== undefined
        ? { lastFlushCompactionCount: generation.flush.lastCompactionCount }
        : undefined),
    });
    if (!due) return;
    const cycle = generation.compactionCount;
    const settled = await settledUnlessAborted(
      hook({
        items: [...context.checkpoint().items],
        contextTokens: assessment.contextTokens,
        contextWindowTokens: assessment.contextWindowTokens,
        transcriptBytes: assessment.bytes,
        compactionCount: cycle,
        signal,
      }).catch((error: Error) => failedHousekeeping(error.message)),
      signal,
    );
    if (settled.aborted || this.#revoked(turnContext)) return;
    if (!housekeepingCompleted(settled.value.outcome)) {
      this.#seam.report(
        `Memory flush did not complete (${settled.value.outcome}${settled.value.reason ? `: ${settled.value.reason}` : ""}); it runs again at the next assessment`,
      );
      return;
    }
    const marked = await this.#writeFlushMarker(turnContext, cycle);
    if (marked.aborted || this.#revoked(turnContext)) return;
    if (!marked.value.ok) {
      this.#seam.report(
        `Memory flush completed but its marker could not be recorded after ${MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS} attempt(s) (${marked.value.reason}); the cycle stays unflushed and runs again at the next assessment`,
      );
      return;
    }
    generation.flush.lastCompactionCount = cycle;
  }

  /**
   * Fills the generation's flush marker from the store the first time it is
   * needed. Answers whether the gate may be read: a store that cannot answer
   * defers the flush to the next assessment rather than guessing, since a
   * guess of "unflushed" repeats a housekeeping turn and a guess of
   * "flushed" loses one.
   */
  async #readFlushMarker(
    turnContext: Pick<TurnContext, "generation" | "signal">,
  ): Promise<boolean> {
    const { generation, signal } = turnContext;
    if (generation.flush.settling) {
      // A write an earlier turn stopped waiting for may still be in flight;
      // the gate is read only once it has landed or failed, so the store is
      // never consulted ahead of a write already issued to it.
      const settled = await settledUnlessAborted(generation.flush.settling, signal);
      if (settled.aborted || this.#revoked(turnContext)) return false;
      delete generation.flush.settling;
    }
    if (generation.flush.read) return true;
    const store = this.#options.flushMarker;
    if (!store) {
      generation.flush.read = true;
      return true;
    }
    const read = await settledUnlessAborted(
      store.read(generation.id).then(
        (lastCompactionCount) => ({ ok: true as const, lastCompactionCount }),
        (error: Error) => ({ ok: false as const, reason: error.message }),
      ),
      signal,
    );
    if (read.aborted || this.#revoked(turnContext)) return false;
    if (!read.value.ok) {
      this.#seam.report(
        `Memory flush marker could not be read (${read.value.reason}); the flush waits for the next assessment`,
      );
      return false;
    }
    generation.flush = { read: true, lastCompactionCount: read.value.lastCompactionCount };
    return true;
  }

  /**
   * Offers the completed flush's marker to the store, a bounded number of
   * times; the turn itself is never rerun to retry. A turn revoked while a
   * write is out settles at once, but the write is not forgotten: the
   * attempt still in flight is what the generation's flush state waits for
   * before its gate is next read, and a write that lands late marks the
   * cycle as a timely one would, so the housekeeping turn is not run twice.
   */
  async #writeFlushMarker(
    turnContext: Pick<TurnContext, "generation" | "signal">,
    cycle: number,
  ): Promise<Settled<{ ok: true } | { ok: false; reason: string }>> {
    const store = this.#options.flushMarker;
    if (!store) return { aborted: false, value: { ok: true } };
    const { generation, signal } = turnContext;
    const attempts = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      let reason = "";
      for (let attempt = 0; attempt < MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS; attempt += 1) {
        if (signal.aborted) return { ok: false, reason: "the turn was revoked" };
        try {
          await store.write(generation.id, cycle);
          return { ok: true };
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
        }
      }
      return { ok: false, reason };
    };
    const outcome = attempts();
    const settled = await claimedUnlessAborted(outcome, signal, (late) => {
      if (late.ok) generation.flush.lastCompactionCount = cycle;
    });
    if (settled.aborted) {
      generation.flush.settling = outcome.then(() => undefined);
    }
    return settled;
  }

  #revoked(context: Pick<TurnContext, "signal">): boolean {
    return turnRevoked(this.#seam.stopped(), context);
  }
}
