import {
  PendingInputQueue,
  type QueueBatch,
  type QueuedInput,
  queueSummaryLine,
} from "@sidecar/runtime";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { CONTEXT_INPUT_KIND } from "@sidecar/runtime/vocabulary";
import { CONTEXT_OPENING, type Generation } from "./generation.js";
import { askInputText } from "./input-items.js";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestRecord,
  type BrainSubmission,
  type BrainSubmissionResult,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import type { AgentSeam } from "./seam.js";
import type { BrainStateStore } from "./state-store.js";
import { BRAIN_TURN_TRIGGER, type RunControl } from "./turn.js";
import { type ActiveExecution, type AskInput, newRunControl } from "./turn-runner.js";

export type BrainRequestsListener = (records: readonly BrainRequestRecord[]) => void;

/** A pending submission, held so a retry of the same id awaits the same durable answer. */
interface PendingSubmission {
  question: string;
  origin: BrainSubmission["origin"];
  result: Promise<BrainSubmissionResult>;
}

export interface AskLedgerOptions {
  seam: AgentSeam;
  store: BrainStateStore;
  createRunId: () => string;
  /** Opens one turn for the asks a drain handed over; the runner's own. */
  runAsk: (inputs: readonly AskInput[]) => Promise<void>;
  /** The execution under way, for steering and interrupt. */
  active: () => ActiveExecution | undefined;
  /** Disarms the wake window before an ask's turn opens with the inbox as it stands. */
  disarmWakes: () => void;
  /** A developer's ask outranks housekeeping still waiting its turn. */
  cancelMaintenance: () => void;
}

/**
 * The ask record's whole life: accepted into a run whose record is
 * checkpointed before anybody is told of it, admitted to the ported queue
 * that decides whether its words steer into the execution under way or wait
 * for a turn of their own, settled when the turn that carried them ends, and
 * answered to every reader through one list. It opens no turn itself: what a
 * drain hands over goes to the runner.
 */
export class AskLedger {
  readonly #options: AskLedgerOptions;
  readonly #seam: AgentSeam;
  readonly #runs = new Map<string, RunControl>();
  readonly #pendingSubmissions = new Map<string, PendingSubmission>();
  readonly #listeners = new Set<BrainRequestsListener>();
  /** Where an ask that arrives while this conversation is busy waits, under the queue's own mode and bounds. */
  readonly #queue: PendingInputQueue;
  /**
   * Asks the overflow folded into a summary line: their words reach the model
   * as that line, and their records settle with the turn that carries it.
   */
  #summarized: AskInput[] = [];

  constructor(options: AskLedgerOptions) {
    this.#options = options;
    this.#seam = options.seam;
    this.#queue = new PendingInputQueue({
      steer: (input) => this.#steer(input),
      interrupt: () => this.#interrupt(),
      flush: (batches) => this.#openBatches(batches),
      schedule: this.#seam.schedule,
      cancel: this.#seam.cancel,
    });
  }

  /** How many asks are waiting in the queue for a turn of their own. */
  size(): number {
    return this.#queue.size;
  }

  run(runId: string): RunControl | undefined {
    return this.#runs.get(runId);
  }

  forget(runId: string): void {
    this.#runs.delete(runId);
  }

  /** Opens the queue's own drain now: what the waiting asks waited for has ended. */
  flushQueue(): void {
    this.#queue.flush();
  }

  /** Aborts and forgets every run this agent holds; the generation being replaced is not a cancel. */
  revokeAll(): void {
    for (const run of this.#runs.values()) {
      run.cancelled = true;
      run.abort.abort();
    }
    this.#runs.clear();
  }

  /** Aborts every run without cancelling it: the agent is stopping, not the developer. */
  abortAll(): void {
    for (const run of this.#runs.values()) run.abort.abort();
  }

  /** Settles once every acceptance still being written has landed or been refused. */
  async drainPendingSubmissions(): Promise<void> {
    await Promise.all(
      [...this.#pendingSubmissions.values()].map((pending) =>
        pending.result.catch(() => undefined),
      ),
    );
  }

  /** Hears the whole list on every change to any record. */
  notify(): void {
    const records = this.records();
    for (const listener of [...this.#listeners]) listener(records);
  }

  /** Every acknowledged run this generation holds, oldest acceptance first. */
  records(): readonly BrainRequestRecord[] {
    const generation = this.#seam.generation();
    if (!generation) return [];
    return [...generation.requests.values()]
      .filter((record) => !generation.provisional.has(record.runId))
      .map((record) => ({ ...record }));
  }

  record(runId: string): BrainRequestRecord | undefined {
    const generation = this.#seam.generation();
    if (!generation || generation.provisional.has(runId)) return undefined;
    const record = generation.requests.get(runId);
    return record ? { ...record } : undefined;
  }

  /** Hears the whole list on every change to any record. */
  subscribe(listener: BrainRequestsListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Accepts a developer ask into a run, or answers why not. The same
   * submission asked twice — a transport retrying — awaits the same durable
   * answer as the first: an acceptance is acknowledged to nobody until its
   * record is checkpointed, so no caller is told of a run that a failed write
   * then takes away, and a retry that arrives while the write is out is given
   * the write's own outcome. A new submission id is a new run, however alike
   * the words; the same id with other words or another origin is refused as a
   * conflict rather than guessed at. Pending wakes ride in the run's turn.
   */
  async submit(submission: BrainSubmission): Promise<BrainSubmissionResult> {
    this.#seam.expireIfDue();
    const generation = this.#seam.generation();
    if (this.#seam.stopped() || !generation) {
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
      };
    }
    const question = submission.question.trim();
    if (!question) {
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.EMPTY,
      };
    }
    // The generation's context is awaited before the pending checks below, so
    // that from the check to the registration nothing is awaited and two
    // retries of one id cannot both slip past each other into two runs.
    const opened = await generation.opened;
    if (generation !== this.#seam.generation() || this.#seam.stopped()) {
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
      };
    }
    if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      // The memory stands, whole, and nothing runs over it: an ask into it
      // would be a run this runtime cannot give a context to.
      this.#seam.reportIncompatible(generation, opened.reason);
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.INCOMPATIBLE,
      };
    }
    const sameAsk = (held: { question: string; origin: BrainSubmission["origin"] }) =>
      held.question === question && held.origin === submission.origin;
    const conflict: BrainSubmissionResult = {
      outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
      reason: BRAIN_SUBMISSION_REJECTION.CONFLICT,
    };
    const pending = this.#pendingSubmissions.get(submission.submissionId);
    if (pending) return sameAsk(pending) ? pending.result : conflict;
    const existing = this.records().find(
      (record) => record.submissionId === submission.submissionId,
    );
    if (existing) {
      return sameAsk(existing)
        ? {
            outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED,
            runId: existing.runId,
            acceptedAt: existing.acceptedAt,
          }
        : conflict;
    }
    if (!this.#options.store.admits(generation.id)) {
      // The record count is a hard bound on the file: a run the store could
      // not then write is refused at the door, in a word the host can say.
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.FULL,
      };
    }
    // A developer's ask outranks housekeeping: maintenance still waiting its
    // turn is cancelled so the ask does not queue behind a compaction.
    this.#options.cancelMaintenance();
    const result = this.#accept(generation, { ...submission, question });
    this.#pendingSubmissions.set(submission.submissionId, {
      question,
      origin: submission.origin,
      result,
    });
    try {
      return await result;
    } finally {
      this.#pendingSubmissions.delete(submission.submissionId);
    }
  }

  async #accept(
    generation: Generation,
    submission: BrainSubmission,
  ): Promise<BrainSubmissionResult> {
    const acceptedAt = this.#seam.now();
    const record: BrainRequestRecord = {
      runId: this.#options.createRunId(),
      submissionId: submission.submissionId,
      origin: submission.origin,
      question: submission.question,
      status: BRAIN_REQUEST_STATUS.QUEUED,
      revision: 0,
      acceptedAt,
      performedActs: 0,
      unknownActs: 0,
    };
    generation.provisional.add(record.runId);
    generation.requests.set(record.runId, record);
    const written = await this.#seam.ledger.accept(generation, record);
    generation.provisional.delete(record.runId);
    if (!written) {
      generation.requests.delete(record.runId);
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.PERSISTENCE,
      };
    }
    this.notify();
    const accepted: BrainSubmissionResult = {
      outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED,
      runId: record.runId,
      acceptedAt,
    };
    if (this.#seam.stopped() || generation.abort.signal.aborted) {
      // Accepted durably, but into an agent that stopped while the write was
      // out: the run is the developer's to see, and it ends here rather than
      // being scheduled on an agent the host has already replaced.
      await this.#seam.ledger.settleRun(
        generation,
        record.runId,
        BRAIN_REQUEST_STATUS.INTERRUPTED,
        {},
      );
      return accepted;
    }
    const run = newRunControl(record.runId, generation, true);
    this.#runs.set(run.runId, run);
    this.#admit(run, submission.question);
    return accepted;
  }

  /**
   * Where an accepted ask goes. An idle conversation opens it at once: the
   * queue exists for a conversation that is busy, and a debounce on an idle
   * one is only delay. Everything else is admitted to the ported queue, which
   * decides whether the words steer into the execution under way or wait for
   * a turn of their own, and under its bounds what the overflow folds into a
   * summary.
   */
  #admit(run: RunControl, question: string): void {
    if (!this.#options.active() && this.#queue.size === 0) {
      this.#open([{ run, text: question, folded: false }]);
      return;
    }
    const held = this.#queue.state.entries;
    const admitted = this.#queue.push({ id: run.runId, text: question, atMs: this.#seam.now() });
    this.#foldEvicted(held);
    if (!admitted && !held.some((entry) => entry.id === run.runId)) {
      // The overflow refused these words outright: no turn will carry them,
      // and the record ends here rather than waiting for one that never opens.
      void this.settleWaiting([run]);
    }
  }

  /**
   * Moves the runs the overflow just let go of out of the queue's accounting
   * and into this agent's: one folded into a summary rides the next drained
   * turn as a rider, and one dropped outright settles now, because nothing
   * will carry its words.
   */
  #foldEvicted(held: readonly QueuedInput[]): void {
    const state = this.#queue.state;
    const evicted = held.filter((entry) => !state.entries.some((kept) => kept.id === entry.id));
    if (evicted.length === 0) return;
    const folded = state.summaryLines.length >= evicted.length;
    const dropped: RunControl[] = [];
    for (const entry of evicted) {
      const run = this.#runs.get(entry.id);
      if (!run) continue;
      if (folded) this.#summarized.push({ run, text: queueSummaryLine(entry), folded: true });
      else dropped.push(run);
    }
    if (dropped.length > 0) void this.settleWaiting(dropped);
  }

  /** Hands an ask to the execution under way at its next model boundary; answers whether it took them. */
  #steer(input: QueuedInput): boolean {
    const active = this.#options.active();
    const run = this.#runs.get(input.id);
    if (!active || !run || this.#seam.runRevoked(active.run)) return false;
    // Only another ask's turn can take the words: a heartbeat, a wake, or a
    // hold's release runs under its own prompt and origin, and a reply
    // formed inside it would be that turn's, not the developer's answer. The
    // ask waits in the queue instead and opens its own turn when this one ends.
    if (active.plan.trigger !== BRAIN_TURN_TRIGGER.ASK) return false;
    const text = askInputText(input.text, [], this.#seam.now());
    if (!active.started.steer({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text })) return false;
    active.riders.push(run);
    // The one place a rider is committed running: its words are in the model's
    // hands, and the run it rides is the run it ends with.
    void this.#seam.ledger
      .commit(run.generation, run.runId, {
        status: BRAIN_REQUEST_STATUS.RUNNING,
        startedAt: this.#seam.now(),
      })
      .then(() => this.notify());
    return true;
  }

  /** Cancels the execution under way so the ask that interrupted it opens next. */
  #interrupt(): void {
    const active = this.#options.active();
    if (!active || this.#seam.runRevoked(active.run)) return;
    active.run.cancelled = true;
    active.run.abort.abort();
  }

  /**
   * Opens the turns the queue drained, in order. The batch that carries the
   * overflow's summary carries the summarized runs with it, so an ask whose
   * words reached the model only as a summary line still settles with the
   * turn that read it. Each ask travels with its own words rather than in a
   * question joined here: what the model reads is composed when the turn
   * opens, from the asks that still open it, so an ask cancelled between the
   * drain and the turn takes its words with it.
   */
  #openBatches(batches: readonly QueueBatch[]): void {
    for (const batch of batches) {
      const inputs = batch.inputs.flatMap((input) => {
        const run = this.#runs.get(input.id);
        return run ? [{ run, text: input.text, folded: false }] : [];
      });
      const riders = batch.summary === undefined ? [] : this.#summarized.splice(0);
      this.#open([...inputs, ...riders]);
    }
  }

  /** Queues one turn for the asks given, the first that can open it standing as its run. */
  #open(inputs: readonly AskInput[]): void {
    if (inputs.length === 0) return;
    // The ask's turn opens with the inbox as it stands, so the window a wake
    // armed has nothing left to open and is disarmed.
    this.#options.disarmWakes();
    void this.#options.runAsk(inputs);
  }

  /**
   * Settles asks no turn will carry — the queue emptied by a Clear, a reset,
   * an expiry, or a stop, and anything the overflow dropped — as the run
   * itself says: cancelled when the developer cancelled it, interrupted when
   * this conversation's standing was taken away under it.
   */
  async settleWaiting(runs: readonly RunControl[]): Promise<void> {
    // How each ask ends is read now, before anything is awaited: a generation
    // being replaced revokes every run it holds, and a blanket revocation is
    // not the developer's cancel.
    const ends = runs.map((run) => ({
      run,
      status: run.cancelled ? BRAIN_REQUEST_STATUS.CANCELLED : BRAIN_REQUEST_STATUS.INTERRUPTED,
    }));
    for (const { run, status } of ends) {
      this.#runs.delete(run.runId);
      await this.#seam.ledger.settleRun(run.generation, run.runId, status, {});
    }
  }

  /** Everything waiting for a turn, queued or summarized, forgotten by the queue as it is taken. */
  takeWaiting(): readonly RunControl[] {
    const waiting = [
      ...this.#queue.state.entries.flatMap((entry) => this.#runs.get(entry.id) ?? []),
      ...this.#summarized.splice(0).map((input) => input.run),
    ];
    this.#queue.clear();
    return waiting;
  }

  /**
   * Answers the record once the run ends, or as it stands when the wait runs
   * out first. A wait that runs out changes nothing about the run, and a run
   * this generation does not know answers nothing.
   */
  async wait(runId: string, timeoutMs: number): Promise<BrainRequestRecord | undefined> {
    const record = this.record(runId);
    if (!record) return undefined;
    if (isTerminalBrainRequestStatus(record.status)) return record;
    return new Promise((resolve) => {
      let timer: ScheduledTimer | undefined;
      const finish = () => {
        unsubscribe();
        if (timer !== undefined) this.#seam.cancel(timer);
        resolve(this.record(runId));
      };
      const unsubscribe = this.subscribe(() => {
        const current = this.record(runId);
        if (!current || isTerminalBrainRequestStatus(current.status)) finish();
      });
      timer = this.#seam.schedule(finish, timeoutMs);
    });
  }

  /**
   * Cancels a run: a queued one never starts, a running one has its model and
   * read work aborted and every act not yet dispatched refused. An act whose
   * effect is already under way is neither retried nor aborted — its result
   * is kept, known or unknown — because cancelling cannot undo a message
   * already sent.
   */
  async cancel(runId: string): Promise<BrainRequestRecord | undefined> {
    const record = this.record(runId);
    if (!record) return undefined;
    if (isTerminalBrainRequestStatus(record.status)) return record;
    const run = this.#runs.get(runId);
    if (run) {
      run.cancelled = true;
      run.abort.abort();
    }
    const active = this.#options.active();
    const riding = run ? (active?.riders.indexOf(run) ?? -1) : -1;
    if (run && active && riding >= 0) {
      // An ask steered into another run has said its words to the model
      // already; what cancelling withdraws is its record's claim on that
      // run's reply, which it no longer waits for.
      active.riders.splice(riding, 1);
      this.#runs.delete(runId);
      await this.#seam.ledger.settleRun(run.generation, runId, BRAIN_REQUEST_STATUS.CANCELLED, {});
      return this.record(runId);
    }
    const generation = this.#seam.generation();
    if (record.status === BRAIN_REQUEST_STATUS.QUEUED && generation) {
      // Words still waiting for a turn are withdrawn before any turn composes
      // its question from them; words already steered were said to the model
      // and cannot be unsaid. The record keeps the ask as accepted either way.
      if (!this.#queue.withdraw(runId)) {
        // The summarized list and the queue's summary are kept in one fold
        // order, so the ask's place in one is its place in the other.
        const folded = this.#summarized.findIndex((input) => input.run.runId === runId);
        if (folded >= 0) {
          this.#summarized.splice(folded, 1);
          this.#queue.withdrawSummarized(folded);
        }
      }
      await this.#seam.ledger.settleRun(generation, runId, BRAIN_REQUEST_STATUS.CANCELLED, {});
    }
    return this.record(runId);
  }

  /**
   * Whether a waiting ask may still open a turn: its record queued and its
   * execution not revoked. One that may not is settled and forgotten here,
   * as the record's own end rather than as anything the turn did.
   */
  async opens(run: RunControl): Promise<boolean> {
    const record = run.generation.requests.get(run.runId);
    if (record?.status === BRAIN_REQUEST_STATUS.QUEUED && !this.#seam.runRevoked(run)) return true;
    if (record?.status === BRAIN_REQUEST_STATUS.QUEUED) {
      await this.#seam.ledger.settleRun(
        run.generation,
        run.runId,
        run.cancelled ? BRAIN_REQUEST_STATUS.CANCELLED : BRAIN_REQUEST_STATUS.INTERRUPTED,
        {},
      );
    }
    this.#runs.delete(run.runId);
    return false;
  }
}
