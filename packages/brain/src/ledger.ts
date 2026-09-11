import type { BrainStoreLease } from "./envelope.js";
import type { Generation } from "./generation.js";
import type { BrainObservationEntry } from "./observation-inbox.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  type BrainRequestFailure,
  type BrainRequestRecord,
  isTerminalBrainRequestStatus,
  type RecordChanges,
} from "./requests.js";
import type { BrainSaveResult, BrainStateStore } from "./state-store.js";
import type { RecordingContextEngine } from "./transcript-recorder.js";
import type { RunControl, TurnContext } from "./turn.js";

/**
 * The host's ledger: the one way a generation reaches the store, and the one
 * place the kind of a save is named. What a save may own: the working
 * context, cursors, and journal, when it is the checkpoint of the turn
 * holding them; one record's fields, when it is that record's acceptance,
 * transition, accounting, end, or mark; the whole generation, when it is the
 * restore that just loaded it; or the inbox, when it is a capture. Each is a
 * method of the store, which composes the envelope inside its own queue and
 * applies what the save owns to live state in the same step; the ledger's own
 * work is deciding which save a caller means and what its answer says.
 */

/** What a run's inferences have cost and been answered under so far, as its record keeps them; nothing before the first answer. */
function runAccounting(run: RunControl): Pick<RecordChanges, "usage" | "responseIds"> {
  return {
    ...(run.usage !== undefined ? { usage: run.usage } : undefined),
    ...(run.responseIds.length > 0 ? { responseIds: [...run.responseIds] } : undefined),
  };
}

/** The markers a host may write onto a run, each once; the desktop writes only the end's. */
export const PENDING_MARK_FIELD = {
  ASK_RECORDED_AT: "askRecordedAt",
  CONVERSATION_RECORDED_AT: "conversationRecordedAt",
} as const;

export type PendingMarkField = (typeof PENDING_MARK_FIELD)[keyof typeof PENDING_MARK_FIELD];

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
  /** Hears each run's end exactly once, as the record stands after it settled. */
  runEnded?: (record: BrainRequestRecord) => void;
}

export class BrainRequestLedger {
  readonly #store: BrainStateStore;
  readonly #lease: BrainStoreLease;
  readonly #now: () => number;
  readonly #report: (message: string) => void;
  readonly #notify: () => void;
  readonly #runEnded: ((record: BrainRequestRecord) => void) | undefined;
  readonly #pendingMarks = new Map<string, Map<PendingMarkField, Promise<boolean>>>();

  constructor(options: BrainRequestLedgerOptions) {
    this.#store = options.store;
    this.#lease = options.lease;
    this.#now = options.now;
    this.#report = options.report;
    this.#notify = options.notify;
    this.#runEnded = options.runEnded;
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
    return this.#landed(this.#store.saveRecord(this.#lease, generation, { runId, changes }));
  }

  /** A record's own acceptance: the record itself, inserted into the committed list. */
  accept(generation: Generation, record: BrainRequestRecord): Promise<boolean> {
    return this.#landed(
      this.#store.saveRecord(this.#lease, generation, {
        runId: record.runId,
        changes: {},
        insert: record,
      }),
    );
  }

  /**
   * A turn's or an action's checkpoint: the working context, cursors, and journal
   * this turn owns become the committed ones, together with the run's own
   * accounting when a run owns the turn. Nothing else changes: every other
   * record stays as committed, so a request accepted or marked meanwhile is
   * untouched and a request still provisional is not published.
   */
  checkpoint(turnContext: Omit<TurnContext, "run"> & { run?: RunControl }): Promise<boolean> {
    const { generation, context, run, consumes } = turnContext;
    return this.#landed(
      this.#store.saveWorking(this.#lease, generation, {
        context,
        ...(consumes && consumes.length > 0 ? { consumes } : undefined),
        ...(run?.recorded
          ? {
              record: {
                runId: run.runId,
                changes: {
                  performedActions: run.performedActions,
                  unknownActions: run.unknownActions,
                  ...runAccounting(run),
                },
              },
            }
          : undefined),
      }),
    );
  }

  /**
   * The restore's own save: the working requests whole, carrying the context
   * only when the runtime loaded one.
   */
  restored(generation: Generation, context: RecordingContextEngine | undefined): Promise<boolean> {
    return this.#landed(this.#store.saveWhole(this.#lease, generation, context));
  }

  /** Observations captured into the inbox, with the capture cursors they advanced. */
  captured(generation: Generation, entries: readonly BrainObservationEntry[]): Promise<boolean> {
    return this.#landed(this.#store.saveCapture(this.#lease, generation, entries));
  }

  /**
   * Reads one save's outcome the way every caller here does: a save that did
   * not land whole is reported once and answered false, and runs retention
   * let go of are gone from the list every window draws, which hears it now
   * rather than on the next unrelated change.
   */
  async #landed(saving: Promise<BrainSaveResult>): Promise<boolean> {
    const result = await saving;
    if (!result.saved) {
      this.#report("Brain memory could not be checkpointed");
      return false;
    }
    if (result.prunedRunIds.length > 0) this.#notify();
    return true;
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
      ...(run
        ? {
            performedActions: run.performedActions,
            unknownActions: run.unknownActions,
            ...runAccounting(run),
          }
        : undefined),
    };
    if (await this.commit(generation, runId, settled)) {
      this.#notify();
      this.#ended(generation, runId);
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
    this.#ended(generation, runId);
  }

  #ended(generation: Generation, runId: string): void {
    const record = generation.requests.get(runId);
    if (record) this.#runEnded?.({ ...record });
  }
}
