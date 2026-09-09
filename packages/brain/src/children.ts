import type { ChildEnd } from "@sidecar/runtime";
import {
  type ChildCompletionRecord,
  type ChildRunRecord,
  CONTEXT_INPUT_KIND,
} from "@sidecar/runtime/vocabulary";
import { childRunEnd, RUN_FORGOTTEN } from "./child-records.js";
import { BRAIN_DEFAULTS } from "./defaults.js";
import { CONTEXT_OPENING } from "./generation.js";
import { childCompletionInputText, wakeInputText } from "./input-items.js";
import { inboxEvents } from "./observation-inbox.js";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  type BrainRequestRecord,
  type BrainSubmission,
  type BrainSubmissionResult,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import type { AgentSeam } from "./seam.js";
import { SteeredDeliveries } from "./steered-deliveries.js";
import { BRAIN_TURN_TRIGGER, TURN_OUTCOME, type TurnPlan, type TurnResult } from "./turn.js";
import type { ActiveExecution } from "./turn-runner.js";

/** Whether a completion reached this conversation, and how. */
export interface BrainCompletionDelivery {
  readonly delivered: boolean;
  readonly reason?: string;
}

export interface ChildRunsOptions {
  seam: AgentSeam;
  /** The facade's own `submitAsk`, so a child's task runs the whole ask gauntlet. */
  submit: (submission: BrainSubmission) => Promise<BrainSubmissionResult>;
  records: () => readonly BrainRequestRecord[];
  record: (runId: string) => BrainRequestRecord | undefined;
  wait: (runId: string, timeoutMs: number) => Promise<BrainRequestRecord | undefined>;
  cancel: (runId: string) => Promise<BrainRequestRecord | undefined>;
  active: () => ActiveExecution | undefined;
  turn: (plan: TurnPlan) => Promise<TurnResult>;
}

/**
 * The child runs this conversation holds: a delegated task run as a recorded
 * run of its own, its end read as the requester's service takes it, and a
 * completion delivered exactly once however many times its delivery is
 * retried. Nothing here decides whether a child may exist — that is the
 * host's — only what this conversation does with the one it was handed.
 */
export class ChildRuns {
  readonly #options: ChildRunsOptions;
  readonly #seam: AgentSeam;
  /** Completions this conversation has taken, by their stable id, so a retried delivery is one item. */
  readonly #delivered = new Set<string>();
  /** Deliveries still being decided, by completion id, so a retry that arrives meanwhile joins rather than repeats. */
  readonly #pending = new Map<string, Promise<BrainCompletionDelivery>>();

  constructor(options: ChildRunsOptions) {
    this.#options = options;
    this.#seam = options.seam;
  }

  /**
   * Runs a delegated task in this conversation, as the child it is: a
   * recorded run under the child origin, its submission id the child run's
   * id the requester's service minted, so the same child asked twice is one
   * run. Settles with the run's end, as the service takes it: a completed
   * run's final text is the result, an interrupted one — the run a relaunch
   * found unfinished — is the honest unknown with the actions its journal
   * established, and a run its generation forgot before it ended is the
   * same unknown, decided here rather than left to the requester to guess.
   */
  async runTask(
    task: string,
    childRunId: string,
  ): Promise<{ readonly runId: string; readonly done: Promise<ChildEnd> } | undefined> {
    const submitted = await this.#options.submit({
      submissionId: childRunId,
      question: task,
      origin: BRAIN_REQUEST_ORIGIN.CHILD,
    });
    if (submitted.outcome !== BRAIN_SUBMISSION_OUTCOME.ACCEPTED) return undefined;
    return { runId: submitted.runId, done: this.#end(submitted.runId) };
  }

  /** A child run's end once it is terminal, or the unknown end of a run its generation forgot first. */
  async #end(runId: string): Promise<ChildEnd> {
    const record = await this.#awaitTerminal(runId);
    return record ? childRunEnd(record) : RUN_FORGOTTEN;
  }

  /**
   * The end of a child run this conversation already holds — the one a
   * relaunch found and marked interrupted, or one that ended before the
   * requester's service asked — or nothing when no run stands for the id.
   * Nothing is run: a child whose record was never written is not started
   * again on the strength of its requester's receipt.
   */
  async adopt(childRunId: string): Promise<ChildEnd | undefined> {
    await this.#seam.ready();
    const record = this.#options
      .records()
      .find(
        (held) => held.submissionId === childRunId && held.origin === BRAIN_REQUEST_ORIGIN.CHILD,
      );
    if (!record) return undefined;
    return this.#end(record.runId);
  }

  /**
   * Cancels the run named as a child's, by the child run id its requester's
   * service minted, and answers only once the run has actually ended: a
   * cancellation is reported landed when the record says so, never on the
   * strength of having asked, so a reset that waits on it waits on the truth.
   */
  async cancelRun(childRunId: string): Promise<boolean> {
    await this.#seam.ready();
    const record = this.#options.records().find((held) => held.submissionId === childRunId);
    if (!record) return true;
    const cancelled = await this.#options.cancel(record.runId);
    if (cancelled === undefined) return true;
    if (isTerminalBrainRequestStatus(cancelled.status)) return true;
    const settled = await this.#awaitTerminal(record.runId);
    return settled === undefined || isTerminalBrainRequestStatus(settled.status);
  }

  async #awaitTerminal(runId: string): Promise<BrainRequestRecord | undefined> {
    for (;;) {
      const record = await this.#options.wait(runId, BRAIN_DEFAULTS.ASK_WAIT_MS);
      if (!record || isTerminalBrainRequestStatus(record.status)) return record;
      if (this.#seam.stopped()) return this.#options.record(runId);
    }
  }

  /**
   * A child's completion, handed to this conversation as the one that asked
   * for it. An execution under way takes it at its next model boundary, as an
   * ask would be steered; otherwise a turn of its own opens for it, offered
   * `announce`, so the requester reviews the result and decides whether the
   * developer hears anything. The same completion id is taken once however
   * many times delivery is retried. Answers whether the completion reached the
   * model, so a delivery this conversation could not take is retried later
   * rather than lost.
   */
  deliver(
    completion: ChildCompletionRecord,
    record: ChildRunRecord,
  ): Promise<BrainCompletionDelivery> {
    const pending = this.#pending.get(completion.completionId);
    if (pending) return pending;
    const deciding = this.#deliverCompletion(completion, record).finally(() => {
      this.#pending.delete(completion.completionId);
    });
    this.#pending.set(completion.completionId, deciding);
    return deciding;
  }

  async #deliverCompletion(
    completion: ChildCompletionRecord,
    record: ChildRunRecord,
  ): Promise<BrainCompletionDelivery> {
    await this.#seam.ready();
    this.#seam.expireIfDue();
    const generation = this.#seam.generation();
    if (this.#seam.stopped() || !generation)
      return { delivered: false, reason: "no conversation stands" };
    if (this.#delivered.has(completion.completionId)) return { delivered: true };
    const opened = await generation.opened;
    if (generation !== this.#seam.generation() || this.#seam.stopped()) {
      return { delivered: false, reason: "the conversation was replaced" };
    }
    if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      return { delivered: false, reason: "the conversation's memory cannot be run" };
    }
    const text = childCompletionInputText(completion, record, this.#seam.clock.now());
    const active = this.#options.active();
    if (
      active &&
      active.run.generation === generation &&
      !this.#seam.runRevoked(active.run) &&
      active.started.steer({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text })
    ) {
      // Steered words are delivered when a checkpoint carries them, not when
      // the run took them: a run that ends before that has rolled them back,
      // and the asker retries against a context that never held them.
      const delivered = await active.plan.deliveries.steered();
      if (delivered) this.#delivered.add(completion.completionId);
      return delivered
        ? { delivered: true }
        : {
            delivered: false,
            reason: "the run under way ended before its checkpoint carried the completion",
          };
    }
    const deliveries = new SteeredDeliveries();
    const result = await this.#seam.queueTurn(BRAIN_TURN_TRIGGER.CHILD_COMPLETION, () =>
      this.#options.turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.CHILD_COMPLETION,
        events: inboxEvents(generation.inbox),
        open: (attached, now) => [
          ...(attached.length > 0 ? [wakeInputText(attached, now)] : []),
          text,
        ],
        deliveries,
      }),
    );
    // Delivered is what the store holds, not how the turn ended: a turn that
    // failed after an action's checkpoint carried the completion has delivered
    // it, and a turn that answered but whose checkpoint the store refused has not.
    if (deliveries.openingPersisted) {
      this.#delivered.add(completion.completionId);
      return { delivered: true };
    }
    if (result.outcome === TURN_OUTCOME.QUIET) {
      return { delivered: false, reason: "the model is quiet" };
    }
    return {
      delivered: false,
      reason: `the completion turn ended ${result.outcome} before any checkpoint carried it`,
    };
  }
}
