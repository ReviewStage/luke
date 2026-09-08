import { checkpointFormatTag } from "@sidecar/runtime-contracts";
import type { Generation } from "./generation.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  type BrainRequestFailure,
  type BrainRequestRecord,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import type { BrainStateStore, BrainStoreLease } from "./state-store.js";
import type { RecordingContextEngine } from "./transcript-recorder.js";
import type { RunControl, TurnContext } from "./turn.js";

/**
 * The host's ledger: the one way a generation reaches the store, and the one
 * place the scope of a save is decided. Every envelope is composed inside the
 * store's serialized queue from the store's committed state — never from a
 * copy taken before entering the queue, and never from live state the save
 * does not own — so a save can only add what it owns to what the saves
 * before it kept. What a save may own: the working context, cursors, and
 * journal, when it is the checkpoint of the turn holding them; one record's
 * fields, when it is that record's acceptance, transition, accounting, end,
 * or mark; or the whole generation, when it is the restore that just loaded
 * it. Owned record fields land on the live record in the queue step that
 * keeps them. A generation whose checkpoint this runtime could not load never
 * has a working scope, and its whole scope carries the stored items and stamp
 * exactly as committed: the memory is kept, never rewritten by a runtime that
 * cannot read it.
 */

export type RecordChanges = Partial<Omit<BrainRequestRecord, "runId" | "revision">>;

/** The two markers the host's thread writes onto a run, each once. */
export const PENDING_MARK_FIELD = {
  ASK_RECORDED_AT: "askRecordedAt",
  HISTORY_RECORDED_AT: "historyRecordedAt",
} as const;

export type PendingMarkField = (typeof PENDING_MARK_FIELD)[keyof typeof PENDING_MARK_FIELD];

/** One record's fields over the committed record — or the record itself, for its own acceptance. */
export interface RecordChange {
  runId: string;
  changes: RecordChanges;
  insert?: BrainRequestRecord;
}

export const SAVE_SCOPE = {
  WORKING: "working",
  WHOLE: "whole",
  RECORD: "record",
} as const;

/**
 * What one save owns. A working scope commits the turn's context, cursors,
 * and journal, and the owning run's accounting beside them. A record scope
 * changes one record alone. The whole scope is the restore's alone, and
 * carries the context only when the runtime loaded one.
 */
export type SaveScope =
  | { kind: typeof SAVE_SCOPE.WORKING; context: RecordingContextEngine; record?: RecordChange }
  | { kind: typeof SAVE_SCOPE.WHOLE; context: RecordingContextEngine | undefined }
  | ({ kind: typeof SAVE_SCOPE.RECORD } & RecordChange);

/** What composing the requests of one save decided, read once the store has answered. */
interface SaveOutcome {
  requests: readonly BrainRequestRecord[];
  /** The record as written, when the scope owned one. */
  owned?: BrainRequestRecord;
  /** The scope named a record the committed state does not hold, and inserted none. */
  missing: boolean;
}

function recordChangeOf(
  scope: Exclude<SaveScope, { kind: typeof SAVE_SCOPE.WHOLE }>,
): RecordChange | undefined {
  return scope.kind === SAVE_SCOPE.RECORD ? scope : scope.record;
}

/** What a run's end carries into its record beyond the status. */
export interface RunEnd {
  text?: string;
  failure?: BrainRequestFailure;
}

export interface BrainRequestLedgerOptions {
  store: BrainStateStore;
  lease: BrainStoreLease;
  now: () => number;
  report: (message: string) => void;
  /** Hears every change the ledger lands on a record, so the host's listeners hear it too. */
  notify: () => void;
}

export class BrainRequestLedger {
  readonly #store: BrainStateStore;
  readonly #lease: BrainStoreLease;
  readonly #now: () => number;
  readonly #report: (message: string) => void;
  readonly #notify: () => void;
  readonly #pendingMarks = new Map<string, Map<PendingMarkField, Promise<boolean>>>();

  constructor(options: BrainRequestLedgerOptions) {
    this.#store = options.store;
    this.#lease = options.lease;
    this.#now = options.now;
    this.#report = options.report;
    this.#notify = options.notify;
  }

  /**
   * Writes one marker onto a run without the marker ever standing in memory
   * before it stands on disk: the write carries the record as it would read
   * with the marker, and only a write that landed puts the marker on the live
   * record — merged onto whatever else has advanced meanwhile, never a
   * captured copy rolled over it. Callers marking the same field of the same
   * run while a write is out share that write's answer, the way retried
   * submissions share one acceptance.
   */
  async mark(
    generation: Generation,
    runId: string,
    field: PendingMarkField,
    recordedAt: number,
  ): Promise<boolean> {
    const pending = this.#pendingMarks.get(runId)?.get(field);
    if (pending) return pending;
    const marking = (async () => {
      const record = generation.requests.get(runId);
      if (!record) return false;
      if (record[field] !== undefined) return true;
      return this.commit(generation, runId, { [field]: recordedAt });
    })();
    const marks = this.#pendingMarks.get(runId) ?? new Map<PendingMarkField, Promise<boolean>>();
    marks.set(field, marking);
    this.#pendingMarks.set(runId, marks);
    try {
      return await marking;
    } finally {
      marks.delete(field);
      if (marks.size === 0) this.#pendingMarks.delete(runId);
    }
  }

  /**
   * A staged write of some fields of one record, owning nothing else: the
   * envelope is the store's committed state with the fields applied to that
   * record alone, and the live record takes them in the same queue step once
   * the store has — so no save assembled from older state can follow and undo
   * them, nothing reads the fields before they are kept, and nothing of any
   * other record or of a turn still in flight rides along.
   */
  commit(generation: Generation, runId: string, changes: RecordChanges): Promise<boolean> {
    return this.save(generation, { kind: SAVE_SCOPE.RECORD, runId, changes });
  }

  /**
   * A turn's or an act's checkpoint: the working context, cursors, and journal
   * this turn owns become the committed ones, together with the run's own
   * accounting when a run owns the turn. Nothing else changes: every other
   * record stays as committed, so a request accepted or marked meanwhile is
   * untouched and a request still provisional is not published.
   */
  checkpoint(turnContext: TurnContext): Promise<boolean> {
    const { generation, context, run } = turnContext;
    return this.save(generation, {
      kind: SAVE_SCOPE.WORKING,
      context,
      ...(run
        ? {
            record: {
              runId: run.runId,
              changes: { performedActs: run.performedActs, unknownActs: run.unknownActs },
            },
          }
        : undefined),
    });
  }

  async save(generation: Generation, scope: SaveScope): Promise<boolean> {
    let outcome: SaveOutcome | undefined;
    let pruned = false;
    let carried = 0;
    const context = scope.kind === SAVE_SCOPE.RECORD ? undefined : scope.context;
    const written = await this.#store.write(
      this.#lease,
      generation.id,
      (state) => {
        const checkpoint = context?.checkpoint();
        outcome = this.#requestsOf(generation, scope, state.requests);
        const checkpointFormat = checkpoint
          ? checkpointFormatTag(checkpoint.format)
          : state.checkpointFormat;
        // The transcript events the checkpoint carries: everything recorded
        // since the last checkpoint landed, written in the same transaction
        // so the record and the projection cannot disagree about what entered.
        const transcript = context?.pending() ?? [];
        carried = transcript.length;
        return {
          ...(checkpointFormat !== undefined ? { checkpointFormat } : undefined),
          items: checkpoint ? checkpoint.items : state.items,
          cursors: context ? generation.cursors.persisted() : state.cursors,
          journal: context ? generation.journal.entries() : state.journal,
          requests: outcome.requests,
          ...(transcript.length > 0 ? { transcript } : undefined),
        };
      },
      (commit) => {
        if (carried > 0) context?.retained(carried);
        // Retention decided inside the same queue step: the runs the store
        // let go of leave the working copy too, or the next checkpoint of
        // the journal would write them straight back.
        if (commit.prunedRunIds.length > 0) {
          for (const runId of commit.prunedRunIds) generation.requests.delete(runId);
          generation.journal.dropRuns(commit.prunedRunIds);
          pruned = true;
        }
        const owned = outcome?.owned;
        const change = scope.kind === SAVE_SCOPE.WHOLE ? undefined : recordChangeOf(scope);
        if (!owned || !change) return;
        const live = generation.requests.get(owned.runId);
        if (live) {
          generation.requests.set(owned.runId, {
            ...live,
            ...change.changes,
            revision: owned.revision,
          });
        }
      },
    );
    if (!written || outcome?.missing) {
      this.#report("Brain memory could not be checkpointed");
      return false;
    }
    // Runs retention let go of are gone from the list every window draws,
    // and the windows hear it now rather than on the next unrelated change.
    if (pruned) this.#notify();
    return true;
  }

  /** The requests a save writes: the working copy whole, or the committed list with the scope's one record changed or inserted. */
  #requestsOf(
    generation: Generation,
    scope: SaveScope,
    committed: readonly BrainRequestRecord[],
  ): SaveOutcome {
    if (scope.kind === SAVE_SCOPE.WHOLE) {
      return {
        requests: [...generation.requests.values()].map((record) => ({ ...record })),
        missing: false,
      };
    }
    const change = recordChangeOf(scope);
    if (!change) return { requests: committed, missing: false };
    const existing = committed.find((record) => record.runId === change.runId);
    if (existing) {
      const changed: BrainRequestRecord = {
        ...existing,
        ...change.changes,
        revision: existing.revision + 1,
      };
      return {
        requests: committed.map((record) => (record.runId === change.runId ? changed : record)),
        owned: changed,
        missing: false,
      };
    }
    if (change.insert) {
      const owned = { ...change.insert };
      return { requests: [...committed, owned], owned, missing: false };
    }
    return { requests: committed, missing: true };
  }

  #update(generation: Generation, runId: string, changes: RecordChanges): void {
    const record = generation.requests.get(runId);
    if (!record) return;
    generation.requests.set(runId, { ...record, ...changes, revision: record.revision + 1 });
  }

  /**
   * Ends a run in its record, staged behind the write that keeps it: until
   * the store has answered, every reader — a wait, a snapshot, the follower —
   * still sees the run under way, so no success is spoken or written that the
   * file may yet refuse. A success the store refuses is downgraded to a
   * persistence failure, the reply kept, and written once more; an end the
   * store will not take at all stands in memory alone, as the failure it is,
   * so the run still finishes for everyone watching it.
   */
  async settleRun(
    generation: Generation,
    runId: string,
    status: BrainRequestRecord["status"],
    end: RunEnd,
    run?: RunControl,
  ): Promise<void> {
    const record = generation.requests.get(runId);
    if (!record || isTerminalBrainRequestStatus(record.status)) return;
    const settled: RecordChanges = {
      status,
      settledAt: this.#now(),
      ...(end.text !== undefined ? { text: end.text } : undefined),
      ...(end.failure !== undefined ? { failure: end.failure } : undefined),
      ...(run ? { performedActs: run.performedActs, unknownActs: run.unknownActs } : undefined),
    };
    if (await this.commit(generation, runId, settled)) {
      this.#notify();
      return;
    }
    const fallback =
      status === BRAIN_REQUEST_STATUS.SUCCEEDED
        ? {
            ...settled,
            status: BRAIN_REQUEST_STATUS.FAILED,
            failure: BRAIN_REQUEST_FAILURE.PERSISTENCE,
          }
        : settled;
    if (!(await this.commit(generation, runId, fallback))) {
      this.#update(generation, runId, fallback);
    }
    this.#notify();
  }
}
