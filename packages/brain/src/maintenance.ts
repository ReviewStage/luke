import {
  failedHousekeeping,
  housekeepingCompleted,
  MEMORY_FLUSH_DEFAULTS,
  shouldRunMemoryFlush,
} from "@sidecar/memory";
import { markerWriteSchedule } from "@sidecar/memory/effect";
import {
  type AgentRuntimeEffect,
  MEMORY_CAPTURE_PHASE,
  type MemoryDefinition,
  reserveTokens,
} from "@sidecar/runtime/vocabulary";
import { Data, Effect, Either, Fiber, Option } from "effect";
import { assessCompaction, COMPACTION_NEED, type CompactionAssessment } from "./compaction.js";
import { whenAborted } from "./effect/settled.js";
import { CONTEXT_OPENING } from "./generation.js";
import { turnCompactionOf } from "./run-events.js";
import type { AgentSeam } from "./seam.js";
import {
  BRAIN_TURN_KIND,
  type BrainTurnDescription,
  type BrainTurnPreparation,
  type RunControl,
  type TurnContext,
  turnRevoked,
} from "./turn.js";

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

/** A failed offer of the flush marker to its store; `revoked` marks the turn having ended rather than the write itself failing. */
export class FlushMarkerWriteFailed extends Data.TaggedError("FlushMarkerWriteFailed")<{
  readonly reason: string;
  readonly revoked: boolean;
}> {}

/** A failed read of the flush marker from its store. */
class FlushMarkerReadFailed extends Data.TaggedError("FlushMarkerReadFailed")<{
  readonly reason: string;
}> {}

/** The context could not be folded to fit the next request. */
export class CompactionRefused extends Data.TaggedError("CompactionRefused")<{
  readonly reason: string;
}> {}

/**
 * Offers the flush marker to its store under `markerWriteSchedule`'s bound —
 * the same `MARKER_WRITE_ATTEMPTS` the port states, expressed as a
 * `Schedule` rather than a loop counter. A turn revoked before an attempt
 * fails at once without spending the rest of the schedule; a write that
 * merely failed is retried until the schedule is spent, and the effect then
 * carries the last attempt's own reason.
 */
export function writeFlushMarkerEffect(
  store: BrainFlushMarkerStore,
  generationId: string,
  cycle: number,
  signal: AbortSignal,
): Effect.Effect<void, FlushMarkerWriteFailed> {
  return Effect.suspend(() =>
    signal.aborted
      ? Effect.fail(new FlushMarkerWriteFailed({ reason: "the turn was revoked", revoked: true }))
      : Effect.tryPromise({
          try: () => store.write(generationId, cycle),
          catch: (error) =>
            new FlushMarkerWriteFailed({
              reason: error instanceof Error ? error.message : String(error),
              revoked: false,
            }),
        }),
  ).pipe(Effect.retry({ schedule: markerWriteSchedule, while: (error) => !error.revoked }));
}

export interface MaintenanceOptions {
  seam: AgentSeam;
  runtime: AgentRuntimeEffect;
  prepareTurn: (turn: BrainTurnDescription) => BrainTurnPreparation | Promise<BrainTurnPreparation>;
  /** The memory provider bound to this conversation; one with a capture is asked for the pre-compaction flush. */
  memory?: MemoryDefinition;
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
    void this.#seam.enqueue(() =>
      this.#seam.carry(this.#maintain(turnContext, countedTokens, abort)),
    );
  }

  #maintain(
    turnContext: TurnContext,
    countedTokens: number | undefined,
    abort: AbortController,
  ): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const { generation, context, events } = turnContext;
      if (
        abort.signal.aborted ||
        this.#seam.stopped() ||
        generation !== this.#seam.generation() ||
        generation.abort.signal.aborted
      ) {
        return;
      }
      const standing = yield* Effect.promise(() => generation.opened);
      if (standing.kind !== CONTEXT_OPENING.LOADED || standing.context !== context) return;
      const signal = AbortSignal.any([abort.signal, generation.abort.signal]);
      if (signal.aborted) return;
      // Maintenance is not a turn, but it holds the context the way one does,
      // so the roster look waits for it the way it waits for a turn.
      this.#options.holdTurnInFlight(true);
      yield* Effect.ensuring(
        Effect.gen(this, function* () {
          const prepared = yield* Effect.promise(
            async () => await this.#options.prepareTurn({ kind: BRAIN_TURN_KIND.MAINTENANCE }),
          );
          if (signal.aborted || generation !== this.#seam.generation()) return;
          const compacted = yield* Effect.either(
            this.compactIfNeeded(
              { generation, context, signal, events },
              prepared.prompt,
              countedTokens,
            ),
          );
          if (Either.isLeft(compacted))
            this.#seam.report(`Brain compaction did not complete: ${compacted.left.reason}`);
        }),
        Effect.sync(() => this.#options.holdTurnInFlight(false)),
      );
    });
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
  compactIfNeeded(
    turnContext: Omit<TurnContext, "run"> & { run?: RunControl },
    prompt: string,
    countedTokens?: number,
  ): Effect.Effect<void, CompactionRefused> {
    return Effect.gen(this, function* () {
      const { context, signal } = turnContext;
      const capabilities = yield* this.#options.runtime.capabilities();
      if (this.#revoked(turnContext)) return;
      const assessment = assessCompaction(
        context.checkpoint().items,
        prompt,
        capabilities,
        countedTokens,
      );
      // The flush fires a soft margin ahead of the fold, so in maintenance it
      // usually runs on a context not yet over the reserve; at admission it
      // runs right before the compaction the request needs.
      yield* this.#flushBeforeCompaction(turnContext, assessment);
      if (this.#revoked(turnContext)) return;
      if (assessment.need === COMPACTION_NEED.NONE) return;
      const outcome = yield* this.#options.runtime.compact(context, { prompt, signal });
      if (this.#revoked(turnContext)) return;
      if (!outcome.compacted) {
        return yield* Effect.fail(new CompactionRefused({ reason: outcome.reason }));
      }
      turnContext.generation.compactionCount += 1;
      if (!(yield* Effect.promise(() => this.#seam.ledger.checkpoint(turnContext)))) {
        return yield* Effect.fail(
          new CompactionRefused({ reason: "the compacted context could not be checkpointed" }),
        );
      }
      // The fold is told once it is on record, and to the turn whose sequence it
      // belongs in: the turn about to run, or the settled turn that queued this
      // maintenance, whose events it follows.
      turnContext.events.compacted(turnCompactionOf(outcome));
    });
  }

  /**
   * The pre-compaction memory flush, under the pinned gate: over the soft
   * threshold or the byte trigger, and not yet flushed in this compaction
   * cycle. The memory provider's capture is handed a copy of the items and
   * never the engine, so the housekeeping turn cannot reach the
   * conversation's context; a capture
   * that says it ran to its end marks the cycle flushed, and any other
   * answer — interrupted, failed, or the signal firing first — leaves the
   * cycle unflushed so the next assessment runs it again. What the capture
   * wrote before then stands either way. The cycle is the generation's own
   * compaction count, and the marker of the last completed flush is read
   * from the marker store once per generation and written to it after each
   * completion, so a relaunch neither flushes a cycle twice nor skips one;
   * a marker that cannot be read defers the flush, and one that cannot be
   * written after its bounded attempts is reported and leaves the cycle
   * unflushed, never silently done.
   */
  #flushBeforeCompaction(
    turnContext: Omit<TurnContext, "run"> & { run?: RunControl },
    assessment: CompactionAssessment,
  ): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const { generation, context, signal } = turnContext;
      const memory = this.#options.memory;
      const capture = memory?.provider.capture?.bind(memory.provider);
      if (!memory || !capture || signal.aborted) return;
      if (!(yield* this.#readFlushMarker(turnContext))) return;
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
      const captured = yield* Effect.promise(
        async () =>
          await capture({
            scope: memory.scope,
            phase: MEMORY_CAPTURE_PHASE.COMPACTION_REQUESTED,
            operation: { generationId: generation.id, compactionCount: cycle },
            items: [...context.checkpoint().items],
            signal,
          }).catch((error: Error) => failedHousekeeping(error.message)),
      );
      if (this.#revoked(turnContext)) return;
      if (!housekeepingCompleted(captured.outcome)) {
        this.#seam.report(
          `Memory flush did not complete (${captured.outcome}${captured.reason ? `: ${captured.reason}` : ""}); it runs again at the next assessment`,
        );
        return;
      }
      const marked = yield* this.#writeFlushMarker(turnContext, cycle);
      if (Option.isNone(marked) || this.#revoked(turnContext)) return;
      if (Either.isLeft(marked.value)) {
        this.#seam.report(
          `Memory flush completed but its marker could not be recorded after ${MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS} attempt(s) (${marked.value.left.reason}); the cycle stays unflushed and runs again at the next assessment`,
        );
        return;
      }
      generation.flush.lastCompactionCount = cycle;
    });
  }

  /**
   * Fills the generation's flush marker from the store the first time it is
   * needed. Answers whether the gate may be read: a store that cannot answer
   * defers the flush to the next assessment rather than guessing, since a
   * guess of "unflushed" repeats a housekeeping turn and a guess of
   * "flushed" loses one.
   */
  #readFlushMarker(
    turnContext: Pick<TurnContext, "generation" | "signal">,
  ): Effect.Effect<boolean> {
    return Effect.gen(this, function* () {
      const { generation } = turnContext;
      const settling = generation.flush.settling;
      if (settling) {
        // A write an earlier turn stopped waiting for may still be in flight;
        // the gate is read only once it has landed or failed, so the store is
        // never consulted ahead of a write already issued to it.
        yield* settling;
        if (this.#revoked(turnContext)) return false;
        delete generation.flush.settling;
      }
      if (generation.flush.read) return true;
      const store = this.#options.flushMarker;
      if (!store) {
        generation.flush.read = true;
        return true;
      }
      const read = yield* Effect.either(
        Effect.tryPromise({
          try: () => store.read(generation.id),
          catch: (error) =>
            new FlushMarkerReadFailed({
              reason: error instanceof Error ? error.message : String(error),
            }),
        }),
      );
      if (this.#revoked(turnContext)) return false;
      if (Either.isLeft(read)) {
        this.#seam.report(
          `Memory flush marker could not be read (${read.left.reason}); the flush waits for the next assessment`,
        );
        return false;
      }
      generation.flush = { read: true, lastCompactionCount: read.right };
      return true;
    });
  }

  /**
   * Offers the completed flush's marker to the store, a bounded number of
   * times; the turn itself is never rerun to retry. A turn revoked while a
   * write is out settles at once, but the write is not forgotten: the
   * attempt still in flight is what the generation's flush state waits for
   * before its gate is next read, and a write that lands late marks the
   * cycle as a timely one would, so the housekeeping turn is not run twice.
   */
  #writeFlushMarker(
    turnContext: Pick<TurnContext, "generation" | "signal">,
    cycle: number,
  ): Effect.Effect<Option.Option<Either.Either<void, FlushMarkerWriteFailed>>> {
    const store = this.#options.flushMarker;
    if (!store) return Effect.succeed(Option.some(Either.right(undefined)));
    return Effect.gen(this, function* () {
      const { generation, signal } = turnContext;
      // The attempt is a daemon, so the turn ending — of its own accord or
      // by the interruption its revocation raises — leaves the write running
      // and its own late success marking the cycle, which is the whole of
      // what this method owes the next assessment.
      const writing = yield* Effect.forkDaemon(
        Effect.tap(
          Effect.either(writeFlushMarkerEffect(store, generation.id, cycle, signal)),
          (outcome) =>
            Effect.sync(() => {
              if (Either.isRight(outcome)) generation.flush.lastCompactionCount = cycle;
            }),
        ),
      );
      generation.flush.settling = Effect.asVoid(Fiber.await(writing));
      const settled = yield* Effect.raceFirst(
        Effect.map(Fiber.join(writing), Option.some),
        Effect.as(whenAborted(signal), Option.none()),
      );
      if (Option.isSome(settled)) delete generation.flush.settling;
      return settled;
    });
  }

  #revoked(context: Pick<TurnContext, "signal">): boolean {
    return turnRevoked(this.#seam.stopped(), context);
  }
}
