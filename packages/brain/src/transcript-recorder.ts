import {
  type CheckpointFormat,
  COMPACTION_SOURCE,
  type CompactionSource,
  type ContextAssembly,
  type ContextBootstrap,
  type ContextEngine,
  type ContextInput,
  type ContextLifecycle,
  type ContextMark,
  checkpointFormatTag,
  type MaybePromise,
  type RuntimeCheckpoint,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
} from "@sidecar/runtime/vocabulary";
import type { UnknownActionResult, WireRecord } from "@sidecar/wire";

/**
 * The context engine with the transcript written beside it. Every input the
 * runtime ingests and every fold of the projection is recorded here as it
 * happens, as the event it was — a user text, a model's output items kept
 * opaque, a tool's answer, a fold's boundary — and handed to the host
 * with the checkpoint that carries it, so the retained transcript and the
 * active projection are written in one save. Nothing here reads inside an
 * item: the engine beneath owns the provider's shapes, and this wrapper
 * records only what crossed its seam.
 *
 * The pending events follow the engine's marks: a rollback to a mark drops
 * the events recorded after it, exactly as the projection drops the items,
 * so a turn that failed leaves neither in the record.
 */
export class RecordingContextEngine implements ContextEngine {
  readonly checkpointFormat: CheckpointFormat;
  readonly #engine: ContextEngine;
  readonly #now: () => number;
  #pending: TranscriptEvent[] = [];
  readonly #marks = new WeakMap<ContextMark, number>();

  constructor(engine: ContextEngine, now: () => number) {
    this.#engine = engine;
    this.#now = now;
    this.checkpointFormat = engine.checkpointFormat;
  }

  bootstrap(
    checkpoint: RuntimeCheckpoint | undefined,
    lostResult: UnknownActionResult,
    lifecycle?: ContextLifecycle,
  ): MaybePromise<ContextBootstrap> {
    return this.#engine.bootstrap(checkpoint, lostResult, lifecycle);
  }

  ingest(input: ContextInput, lifecycle?: ContextLifecycle): MaybePromise<void> {
    const result = this.#engine.ingest(input, lifecycle);
    const record = () => {
      this.#pending.push({
        kind: TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
        recordedAt: this.#now(),
        input,
      });
    };
    if (result instanceof Promise) return result.then(record);
    record();
    return result;
  }

  assemble(
    assembly: ContextAssembly,
    lifecycle?: ContextLifecycle,
  ): MaybePromise<readonly WireRecord[]> {
    return this.#engine.assemble(assembly, lifecycle);
  }

  /** Items adopted whole for a housekeeping copy are the private turn's own and enter no record. */
  adopt(items: readonly WireRecord[], lifecycle?: ContextLifecycle): MaybePromise<void> {
    return this.#engine.adopt(items, lifecycle);
  }

  /**
   * A forked child's first context: the requester's items adopted whole
   * before the child's first turn, recorded as a boundary of its own so the
   * transcript says where the inherited history ends and the child's begins.
   */
  adoptFork(items: readonly WireRecord[], lifecycle?: ContextLifecycle): MaybePromise<void> {
    const result = this.#engine.adopt(items, lifecycle);
    const record = () => this.#boundary(COMPACTION_SOURCE.FORK, 0);
    if (result instanceof Promise) return result.then(record);
    record();
    return result;
  }

  /** The fold, delegated to the engine beneath and recorded as a boundary when it folded anything. */
  async foldBehindSummary(
    summarize: (older: readonly WireRecord[]) => Promise<string | undefined>,
    keepRecentTokens: number,
    lifecycle?: ContextLifecycle,
  ): Promise<number> {
    if (!this.#engine.foldBehindSummary) return 0;
    const dropped = await this.#engine.foldBehindSummary(summarize, keepRecentTokens, lifecycle);
    if (dropped > 0) this.#boundary(COMPACTION_SOURCE.LOCAL_SUMMARY, dropped);
    return dropped;
  }

  afterTurn(lifecycle?: ContextLifecycle): MaybePromise<void> {
    return this.#engine.afterTurn(lifecycle);
  }

  mark(): ContextMark {
    const mark = this.#engine.mark();
    this.#marks.set(mark, this.#pending.length);
    return mark;
  }

  rollback(mark: ContextMark): void {
    this.#engine.rollback(mark);
    const kept = this.#marks.get(mark);
    if (kept !== undefined) this.#pending = this.#pending.slice(0, kept);
  }

  checkpoint(): RuntimeCheckpoint {
    return this.#engine.checkpoint();
  }

  dispose(): MaybePromise<void> {
    this.#pending = [];
    return this.#engine.dispose();
  }

  /** The events recorded and not yet carried by a landed checkpoint, in order. */
  pending(): readonly TranscriptEvent[] {
    return [...this.#pending];
  }

  /** The first `count` pending events have landed with a checkpoint and are the store's now. */
  retained(count: number): void {
    if (count > 0) this.#pending = this.#pending.slice(count);
  }

  #boundary(source: CompactionSource, dropped: number): void {
    this.#pending.push({
      kind: TRANSCRIPT_EVENT_KIND.COMPACTION,
      recordedAt: this.#now(),
      boundary: { source, dropped, checkpointFormat: checkpointFormatTag(this.checkpointFormat) },
    });
  }
}
