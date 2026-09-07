import { BRAIN_TURN_AUTHORITY } from "@sidecar/hosted";
import type { ScheduledTimer } from "@sidecar/realtime";
import {
  type AgentRuntime,
  CONTEXT_INPUT_KIND,
  type ContextEngine,
  type ContextMark,
  checkpointFormatTag,
  type ModelAdapter,
  type ReasoningEffort,
  RUN_END_REASON,
  RUNTIME_EVENT,
  type RuntimeEvent,
  type RuntimeRunEnd,
  type ToolExecutionContext,
  type ToolExecutor,
  type ToolInvocation,
  type ToolResult,
} from "@sidecar/runtime-contracts";
import {
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionIdentity,
} from "@sidecar/session";
import { ACT_RESULT_STATUS, text, type WireRecord } from "@sidecar/wire";
import {
  type Generation,
  generationFrom,
  identityFromRecord,
  parsedRecord,
  rejection,
  sameIdentity,
} from "./generation.js";
import {
  askInputText,
  holdReleasedInputText,
  standingContextText,
  wakeInputText,
} from "./input-items.js";
import { brainInstructions } from "./instructions.js";
import { journalActCounts, UNCONFIRMED_ACT_RESULT, UNKNOWN_ACT_RESULT } from "./journal.js";
import type { BrainActExecution, BrainActPerformer, BrainRoster } from "./performer.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestFailure,
  type BrainRequestRecord,
  type BrainSubmission,
  type BrainSubmissionResult,
  interruptedUnfinishedRequests,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import {
  type BrainPersistedState,
  type BrainStateStore,
  type BrainStoreLease,
  brainGenerationExpired,
} from "./state-store.js";
import {
  BRAIN_TOOL,
  brainToolAllowed,
  brainToolSchemas,
  isBrainOnlyTool,
  maximumBriefingLength,
} from "./tools.js";
import type { BrainToolCallTrace, BrainTurnTraceRecord } from "./trace.js";
import {
  attachTranscriptDeltas,
  readWholeTranscript,
  type TranscriptDeltasAttached,
} from "./transcript-reads.js";
import {
  BRAIN_TURN_TRIGGER,
  REFUSAL_REASON,
  type RunControl,
  TURN_OUTCOME,
  type TurnContext,
  type TurnPlan,
  type TurnResult,
} from "./turn.js";
import { BRAIN_WAKE_KIND, type BrainDelivery, type BrainWakeEvent } from "./wake-events.js";

/**
 * The brain: one long-lived agent that is woken by the agents' hooks and by
 * its own scheduled look at the roster, asked things by the developer, and
 * answers with briefings for the voice to speak and acts for the host to
 * carry. Nothing detects a change on its behalf: the roster look carries
 * what stands and what each transcript gained, and the brain notices what is
 * new against its own memory.
 *
 * It is the host of an execution, not the execution itself. What it owns is
 * the conversation's standing: accepting asks into runs with records,
 * queueing turns, revoking them on a cancel, a deadline, a stop, or the
 * store's generation changing, journaling every act before its effect and
 * its result before the next inference, moving the transcript cursors, and
 * checkpointing the context the runtime hands back. How a turn reaches a
 * model — which provider, which item shapes, how the loop between model and
 * tools runs — is the agent runtime's and the model adapter's, handed in,
 * and nothing here reads inside a provider's item. The same host runs over
 * any runtime whose checkpoints it can store, and refuses to open a turn over
 * a checkpoint written by a runtime it was not given.
 *
 * Every write the model can cause still runs the host's own validation: an
 * act tool call goes to the performer as a function call and nothing more, and
 * the host validates it against what it observed exactly as it would a spoken
 * one. And an act can leave a turn at all only when the developer opened it:
 * the turn's authority is fixed here from what invoked it — an ask is the
 * developer's, a wake, a roster look, or a hold release is observation — so
 * the toolset a model is offered and the gate every emitted call meets are
 * both decided before the model reads a word, and nothing it reads can move
 * them.
 *
 * A developer ask is a run with a record: accepted once its record is
 * checkpointed, queued behind the turns ahead of it, running under an
 * execution deadline and a cancellation the developer holds, and ended in one
 * of the terminal statuses the record vocabulary names. Every act the run
 * dispatches is journaled before the performer sees it and again with its
 * result before the model does, and the context's rollback point advances
 * past each answered act, so a reply the model then fails to produce cannot
 * erase an act that already happened.
 */

export const BRAIN_DEFAULTS = {
  MAXIMUM_OUTPUT_TOKENS: 16_000,
  /** Wakes inside this window open one turn together: a hook and the poll's edge for the same stop. */
  WAKE_COALESCE_MS: 3_000,
  /**
   * How long a caller waits on a run before being answered with the run still
   * pending. The run is not abandoned at this edge: it keeps going, and the
   * record answers the caller's next wait.
   */
  ASK_WAIT_MS: 30_000,
  /** How long a run may execute once it starts before it is timed out and its execution revoked. */
  EXECUTION_DEADLINE_MS: 48 * 60 * 60 * 1000,
  /** The most of one session's new transcript one wake carries, cut from the front. */
  DELTA_PER_SESSION_CHARS: 20_000,
  /** The most of a whole transcript one read answers with, cut from the front. */
  FULL_TRANSCRIPT_CHARS: 60_000,
} as const;

export interface BrainAgentOptions {
  /** The execution the host runs turns on; it decides how a model and its tools loop. */
  runtime: AgentRuntime;
  /** The transport the runtime infers on; the host reads only its quiet and its model name. */
  model: ModelAdapter;
  acts: BrainActPerformer;
  roster: () => BrainRoster;
  /** Everything the host renders beside the roster: projects, facts, recent conversation, guide. */
  standingContext: () => string;
  /** The standing instructions a turn runs under; the build's own unless a host prepares them. */
  instructions?: () => string;
  readTranscriptSince: (
    identity: SessionIdentity,
    cursor: string | undefined,
  ) => Promise<ProviderTranscriptSinceResult>;
  readTranscript: (identity: SessionIdentity) => Promise<ProviderTranscriptResult>;
  deliver: (delivery: BrainDelivery) => void | Promise<void>;
  /** The one writer of the brain's state, owned by the host and outliving any one agent. */
  store: BrainStateStore;
  createRunId: () => string;
  trace?: (record: BrainTurnTraceRecord) => void;
  report?: (message: string) => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
  maximumOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  wakeCoalesceMs?: number;
  executionDeadlineMs?: number;
  deltaPerSessionChars?: number;
  fullTranscriptChars?: number;
}

type RecordChanges = Partial<Omit<BrainRequestRecord, "runId" | "revision">>;

/**
 * What one save owns. A record scope changes one record's fields over the
 * committed record — or inserts the record, for its own acceptance. A working
 * scope commits the turn's context, cursors, and journal. The whole scope is
 * the restore's alone.
 */
interface SaveScope {
  working?: boolean;
  whole?: boolean;
  record?: { runId: string; changes: RecordChanges; insert?: BrainRequestRecord };
}

/** What a run's end carries into its record beyond the status. */
interface RunEnd {
  text?: string;
  failure?: BrainRequestFailure;
}

/** What one turn gathers as it runs, for its trace and its deliveries. */
interface TurnGathering {
  toolCalls: BrainToolCallTrace[];
  deliveries: BrainDelivery[];
  iterations: number;
  compacted: boolean;
  inputTokens?: number;
  outputText: string;
  error?: string;
}

/** A pending submission, held so a retry of the same id awaits the same durable answer. */
interface PendingSubmission {
  question: string;
  origin: BrainSubmission["origin"];
  result: Promise<BrainSubmissionResult>;
}

export type BrainRequestsListener = (records: readonly BrainRequestRecord[]) => void;

export class BrainAgent {
  readonly #options: BrainAgentOptions;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  readonly #report: (message: string) => void;
  readonly #instructions: () => string;
  readonly #maximumOutputTokens: number;
  readonly #wakeCoalesceMs: number;
  readonly #executionDeadlineMs: number;
  readonly #deltaPerSessionChars: number;
  readonly #fullTranscriptChars: number;
  #generation: Generation | undefined;
  readonly #lease: BrainStoreLease;
  readonly #runs = new Map<string, RunControl>();
  readonly #pendingSubmissions = new Map<string, PendingSubmission>();
  readonly #pendingMarks = new Map<string, Promise<boolean>>();
  readonly #listeners = new Set<BrainRequestsListener>();
  #turnInFlight = false;
  #restored: Promise<void> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #pending: BrainWakeEvent[] = [];
  #flushTimer: ScheduledTimer | undefined;
  #stopped = false;
  #unsubscribeStore: (() => void) | undefined;
  #observationTurns = 0;
  #incompatibleReported: string | undefined;

  constructor(options: BrainAgentOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#schedule =
      options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.#cancel =
      options.cancel ??
      ((timer) => {
        // SAFETY: a timer this agent scheduled itself came from setTimeout above.
        globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
    this.#instructions = options.instructions ?? brainInstructions;
    this.#maximumOutputTokens = options.maximumOutputTokens ?? BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS;
    this.#wakeCoalesceMs = options.wakeCoalesceMs ?? BRAIN_DEFAULTS.WAKE_COALESCE_MS;
    this.#executionDeadlineMs = options.executionDeadlineMs ?? BRAIN_DEFAULTS.EXECUTION_DEADLINE_MS;
    this.#deltaPerSessionChars =
      options.deltaPerSessionChars ?? BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS;
    this.#fullTranscriptChars = options.fullTranscriptChars ?? BRAIN_DEFAULTS.FULL_TRANSCRIPT_CHARS;
    this.#lease = options.store.lease();
    this.#unsubscribeStore = options.store.onReplaced((state) => this.#adoptGeneration(state));
  }

  /** The store lease this agent writes under, for a host to check who owns the store. */
  get lease(): BrainStoreLease {
    return this.#lease;
  }

  /** How many wakes are waiting for their turn to open. */
  pendingWakes(): number {
    return this.#pending.length;
  }

  /**
   * Settles once the stored state has been read: the last launch's unfinished
   * runs marked interrupted, dangling calls paired, and both checkpointed.
   * Every entry point awaits this itself; a host that wants the records
   * before its first ask awaits it here.
   */
  ready(): Promise<void> {
    this.#restored ??= this.#restore();
    return this.#restored;
  }

  /**
   * Why the standing generation cannot open a turn, when it cannot: its
   * checkpoint was written by a runtime other than the one this agent runs.
   * The checkpoint, the requests, and the journal are all kept as they are;
   * the way forward is a runtime that reads them or a Clear.
   */
  async incompatibility(): Promise<string | undefined> {
    await this.ready();
    const generation = this.#generation;
    if (!generation) return undefined;
    await generation.ready;
    return generation.incompatible;
  }

  /** Every acknowledged run this generation holds, oldest acceptance first. */
  requests(): readonly BrainRequestRecord[] {
    const generation = this.#generation;
    if (!generation) return [];
    return [...generation.requests.values()]
      .filter((record) => !generation.provisional.has(record.runId))
      .map((record) => ({ ...record }));
  }

  request(runId: string): BrainRequestRecord | undefined {
    const generation = this.#generation;
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
  async submitAsk(submission: BrainSubmission): Promise<BrainSubmissionResult> {
    await this.ready();
    this.#expireIfDue();
    const generation = this.#generation;
    if (this.#stopped || !generation) {
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
    const sameAsk = (held: { question: string; origin: BrainSubmission["origin"] }) =>
      held.question === question && held.origin === submission.origin;
    const conflict: BrainSubmissionResult = {
      outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
      reason: BRAIN_SUBMISSION_REJECTION.CONFLICT,
    };
    const pending = this.#pendingSubmissions.get(submission.submissionId);
    if (pending) return sameAsk(pending) ? pending.result : conflict;
    const existing = this.requests().find(
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
    await generation.ready;
    if (generation !== this.#generation || this.#stopped) {
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
      };
    }
    if (generation.incompatible !== undefined) {
      // The memory stands, whole, and nothing runs over it: an ask into it
      // would be a run this runtime cannot give a context to.
      this.#reportIncompatible(generation);
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.INCOMPATIBLE,
      };
    }
    if (!this.#options.store.admits(generation.id)) {
      // The record count is a hard bound on the file: a run the store could
      // not then write is refused at the door, in a word the host can say.
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.FULL,
      };
    }
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
    const acceptedAt = this.#now();
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
    const written = await this.#save(generation, {
      record: { runId: record.runId, changes: {}, insert: record },
    });
    generation.provisional.delete(record.runId);
    if (!written) {
      generation.requests.delete(record.runId);
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.PERSISTENCE,
      };
    }
    this.#notify();
    const accepted: BrainSubmissionResult = {
      outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED,
      runId: record.runId,
      acceptedAt,
    };
    if (this.#stopped || generation.abort.signal.aborted) {
      // Accepted durably, but into an agent that stopped while the write was
      // out: the run is the developer's to see, and it ends here rather than
      // being scheduled on an agent the host has already replaced.
      await this.#settleRun(generation, record.runId, BRAIN_REQUEST_STATUS.INTERRUPTED, {});
      return accepted;
    }
    const run: RunControl = {
      runId: record.runId,
      generation,
      abort: new AbortController(),
      cancelled: false,
      timedOut: false,
      checkpointFailed: false,
      performedActs: 0,
      unknownActs: 0,
    };
    this.#runs.set(run.runId, run);
    this.#cancelFlush();
    const events = this.#takePending();
    void this.#enqueue(() => this.#runAsk(run, submission.question, events));
    return accepted;
  }

  /**
   * Answers the record once the run ends, or as it stands when the wait runs
   * out first. A wait that runs out changes nothing about the run, and a run
   * this generation does not know answers nothing.
   */
  async waitAsk(runId: string, timeoutMs: number): Promise<BrainRequestRecord | undefined> {
    await this.ready();
    const record = this.request(runId);
    if (!record) return undefined;
    if (isTerminalBrainRequestStatus(record.status)) return record;
    return new Promise((resolve) => {
      let timer: ScheduledTimer | undefined;
      const finish = () => {
        unsubscribe();
        if (timer !== undefined) this.#cancel(timer);
        resolve(this.request(runId));
      };
      const unsubscribe = this.subscribe(() => {
        const current = this.request(runId);
        if (!current || isTerminalBrainRequestStatus(current.status)) finish();
      });
      timer = this.#schedule(finish, timeoutMs);
    });
  }

  /**
   * Cancels a run: a queued one never starts, a running one has its model and
   * read work aborted and every act not yet dispatched refused. An act whose
   * effect is already under way is neither retried nor aborted — its result
   * is kept, known or unknown — because cancelling cannot undo a message
   * already sent.
   */
  async cancelAsk(runId: string): Promise<BrainRequestRecord | undefined> {
    await this.ready();
    const record = this.request(runId);
    if (!record) return undefined;
    if (isTerminalBrainRequestStatus(record.status)) return record;
    const run = this.#runs.get(runId);
    if (run) {
      run.cancelled = true;
      run.abort.abort();
    }
    if (record.status === BRAIN_REQUEST_STATUS.QUEUED && this.#generation) {
      await this.#settleRun(this.#generation, runId, BRAIN_REQUEST_STATUS.CANCELLED, {});
    }
    return this.request(runId);
  }

  /**
   * Marks a run's end as written into the host's thread, so a later report,
   * a rebuilt follower, or the next launch never writes it a second time. The
   * host calls this only after its own write succeeded, and the mark stands
   * only once it is itself written: a mark the store refused is not held in
   * memory either, so the next report tries the whole step again.
   */
  markHistoryRecorded(runId: string, recordedAt: number): Promise<boolean> {
    return this.#mark(runId, "historyRecordedAt", recordedAt);
  }

  /** Marks a run's own ask as written into the host's thread, on the same terms. */
  markAskRecorded(runId: string, recordedAt: number): Promise<boolean> {
    return this.#mark(runId, "askRecordedAt", recordedAt);
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
  async #mark(
    runId: string,
    field: "askRecordedAt" | "historyRecordedAt",
    recordedAt: number,
  ): Promise<boolean> {
    const key = `${runId}:${field}`;
    const pending = this.#pendingMarks.get(key);
    if (pending) return pending;
    const marking = (async () => {
      await this.ready();
      const generation = this.#generation;
      const record = generation?.requests.get(runId);
      if (!generation || !record) return false;
      if (record[field] !== undefined) return true;
      return this.#commit(generation, runId, { [field]: recordedAt });
    })();
    this.#pendingMarks.set(key, marking);
    try {
      return await marking;
    } finally {
      this.#pendingMarks.delete(key);
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
  #commit(generation: Generation, runId: string, changes: RecordChanges): Promise<boolean> {
    return this.#save(generation, { record: { runId, changes } });
  }

  /**
   * Queues wake events. Nothing is sent yet: wakes inside the coalescing
   * window open one turn together, and wakes during a model's quiet wait for
   * it to end rather than being dropped.
   */
  wake(events: readonly BrainWakeEvent[]): void {
    if (this.#stopped || events.length === 0) return;
    this.#pending.push(...events);
    this.#scheduleFlush(this.#wakeCoalesceMs);
  }

  /**
   * Hands back briefings the host held while a meeting or a pause stood, for
   * one re-decision against the roster as it now stands. Pending wakes open
   * in the same turn, ahead of the held briefings, so the decision is made
   * knowing everything that happened during the hold.
   */
  releaseHeld(held: readonly BrainDelivery[]): void {
    if (this.#stopped || held.length === 0) return;
    const generation = this.#generation;
    if (!generation) {
      // The state is still loading: the briefings wait for the generation
      // they will be re-decided in.
      void this.ready().then(() => this.releaseHeld(held));
      return;
    }
    this.#cancelFlush();
    const events = this.#takePending();
    void this.#enqueue(() =>
      this.#turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED,
        authority: BRAIN_TURN_AUTHORITY.OBSERVATION,
        events,
        open: (attached, now) => [
          ...(attached.length > 0 ? [wakeInputText(attached, now)] : []),
          holdReleasedInputText(held, now),
        ],
      }),
    );
  }

  /**
   * Revokes every execution at once and takes nothing more: the generation's
   * signal fires, so every wait the agent holds — a model answer, a
   * transcript read, a run's own act preparation — settles, and the queue
   * drains behind it. Unfinished runs are recorded as interrupted: the agent
   * stopping — a key or account changing, the app quitting — is not the
   * developer's cancel, and the record says which. Synchronous up to the
   * revocation, so a host can withdraw the old agent's standing before its
   * first await of a transition.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#cancelFlush();
    this.#pending = [];
    this.#unsubscribeStore?.();
    this.#unsubscribeStore = undefined;
    this.#generation?.abort.abort();
    for (const run of this.#runs.values()) run.abort.abort();
    // An acceptance whose write is still out settles before the stop does:
    // its caller hears the durable answer, its run is recorded interrupted,
    // and nothing of it is left to land on the agent that comes next.
    await Promise.all(
      [...this.#pendingSubmissions.values()].map((pending) =>
        pending.result.catch(() => undefined),
      ),
    );
    const generation = this.#generation;
    if (generation) {
      for (const record of this.requests()) {
        if (record.status === BRAIN_REQUEST_STATUS.QUEUED) {
          await this.#settleRun(generation, record.runId, BRAIN_REQUEST_STATUS.INTERRUPTED, {});
        }
      }
    }
    await this.#queue;
    await this.#generation?.context?.dispose();
  }

  /**
   * One look at the whole roster, driven by the host's observation pass rather
   * than an internal timer. Carries the roster as `list_sessions` renders it
   * and, for every local session the brain has read before or that is working
   * or waiting now, what its transcript gained since — sessions with nothing
   * new are left out. Skipped while a turn is in flight or the model is
   * quiet, because the next look reads the same deltas; pending hook wakes
   * ride along rather than waiting for their own.
   */
  rosterLook(): void {
    if (this.#stopped || this.#turnInFlight) return;
    const generation = this.#generation;
    if (!generation) {
      void this.ready().then(() => this.rosterLook());
      return;
    }
    if (this.#options.model.quietUntil() !== undefined) return;
    const roster = this.#options.roster();
    const now = this.#now();
    const cursors = generation.cursors;
    const looks: BrainWakeEvent[] = (roster.sessions ?? []).flatMap((session) => {
      const identity: SessionIdentity = {
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      };
      const readBefore = cursors.cursor(identity) !== undefined;
      const live =
        session.status === SESSION_STATUS.WORKING || session.status === SESSION_STATUS.WAITING;
      if (session.location !== SESSION_LOCATION.LOCAL || !(readBefore || live)) return [];
      return [{ kind: BRAIN_WAKE_KIND.ROSTER, identity, session, atMs: now }];
    });
    this.#cancelFlush();
    const events = [...this.#takePending(), ...looks];
    void this.#enqueue(() =>
      this.#turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.ROSTER,
        authority: BRAIN_TURN_AUTHORITY.OBSERVATION,
        events,
        open: (attached, openedAt) => [wakeInputText(attached, openedAt, roster.text)],
        dropEmptyRosterDeltas: true,
      }),
    );
  }

  #scheduleFlush(delayMs: number): void {
    if (this.#flushTimer !== undefined) return;
    this.#flushTimer = this.#schedule(() => {
      this.#flushTimer = undefined;
      this.#flush();
    }, delayMs);
  }

  #cancelFlush(): void {
    if (this.#flushTimer === undefined) return;
    this.#cancel(this.#flushTimer);
    this.#flushTimer = undefined;
  }

  #flush(): void {
    if (this.#stopped) return;
    const quietUntil = this.#options.model.quietUntil();
    if (quietUntil !== undefined) {
      this.#scheduleFlush(Math.max(quietUntil - this.#now(), this.#wakeCoalesceMs));
      return;
    }
    const generation = this.#generation;
    if (!generation) {
      // Nothing to open a turn in yet: the wakes wait for the state to load.
      void this.ready().then(() => this.#scheduleFlush(0));
      return;
    }
    const events = this.#takePending();
    if (events.length === 0) return;
    void this.#enqueue(async () => {
      const result = await this.#turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.WAKE,
        authority: BRAIN_TURN_AUTHORITY.OBSERVATION,
        events,
        open: (attached, now) => [wakeInputText(attached, now)],
      });
      if (
        result.outcome === TURN_OUTCOME.QUIET &&
        !this.#stopped &&
        generation === this.#generation
      ) {
        // The turn sent nothing, so the wakes are still news: they go back
        // to the front of the queue and open together once the quiet ends.
        this.#pending.unshift(...events);
        this.#scheduleFlush(Math.max(result.until - this.#now(), this.#wakeCoalesceMs));
      }
    });
  }

  #takePending(): readonly BrainWakeEvent[] {
    const events = this.#pending;
    this.#pending = [];
    return events;
  }

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #notify(): void {
    const records = this.requests();
    for (const listener of [...this.#listeners]) listener(records);
  }

  #generationFrom(state: BrainPersistedState): Generation {
    return generationFrom(state, this.#options.runtime, JSON.stringify(UNKNOWN_ACT_RESULT));
  }

  async #restore(): Promise<void> {
    let state: BrainPersistedState;
    try {
      state = await this.#options.store.load();
    } catch (error) {
      this.#report(
        `Brain memory could not be restored: ${error instanceof Error ? error.name : "unknown error"}`,
      );
      return;
    }
    // A generation adopted from the store's announcement while the load was
    // out — a Clear or expiry pressed under a starting agent — is the one
    // that stands; the loaded copy is not built over it.
    const adopted = this.#generation;
    const current = this.#options.store.current() ?? state;
    if (adopted && adopted.id === current.generationId) return;
    state = current;
    const generation = this.#generationFrom(state);
    this.#generation = generation;
    await generation.ready;
    if (generation !== this.#generation) return;
    if (generation.incompatible !== undefined) this.#reportIncompatible(generation);
    const interrupted = interruptedUnfinishedRequests(state.requests, this.#now());
    // An act found started with no result may have happened: the runtime's
    // context paired it as unknown at load, and the interrupted run says so
    // in its count; neither is ever a call to make again.
    if (interrupted === state.requests && generation.repaired === 0) return;
    const unfinished = new Set(
      state.requests
        .filter((record) => !isTerminalBrainRequestStatus(record.status))
        .map((record) => record.runId),
    );
    // An interrupted run's accounting is what its journal established: acts
    // whose result was accepted went through, acts whose result says unknown
    // or never arrived may have. Counted from the journal alone, so a copy
    // taken mid-run and a copy taken after it both say the same.
    generation.requests = new Map(
      interrupted.map((record) => [
        record.runId,
        unfinished.has(record.runId)
          ? { ...record, ...journalActCounts(state.journal, record.runId) }
          : record,
      ]),
    );
    await this.#save(generation, { whole: true });
    this.#notify();
  }

  #reportIncompatible(generation: Generation): void {
    if (this.#incompatibleReported === generation.id) return;
    this.#incompatibleReported = generation.id;
    this.#report(
      `Brain memory is kept but cannot be run: ${generation.incompatible ?? "incompatible checkpoint"}`,
    );
  }

  /**
   * The store's generation changed under this agent — a reset or a
   * replacement. The old generation's signal fires, so every run and every
   * observation turn of it loses its execution at once, and whatever they
   * still do happens to the orphaned copy, whose checkpoints the store
   * fences. The agent then works from the new envelope, which holds no record
   * of those runs.
   */
  #adoptGeneration(state: BrainPersistedState): void {
    const previous = this.#generation;
    if (previous?.id === state.generationId) return;
    previous?.abort.abort();
    for (const run of this.#runs.values()) {
      run.cancelled = true;
      run.abort.abort();
    }
    this.#runs.clear();
    // Wakes coalesced against the old memory — including a quiet retry's —
    // are that generation's work, and go with it.
    this.#cancelFlush();
    this.#pending = [];
    this.#generation = this.#generationFrom(state);
    this.#notify();
  }

  /**
   * Asks the store to end the generation if its time has come: the door
   * check, for a generation that outlived its fortnight while nothing kept
   * its clock. The clock itself — a timer at the expiry instant — is the
   * host's, one per store, standing whether or not an agent does. The store's
   * fence is synchronous and its announcement adopts the successor here in
   * the same call, so by the time this returns the dead generation's signal
   * has fired and nothing of it can open, dispatch, or deliver.
   */
  #expireIfDue(): void {
    const generation = this.#generation;
    if (this.#stopped || !generation || !brainGenerationExpired(generation, this.#now())) return;
    this.#options.store.expireIfDue(this.#now());
  }

  /**
   * A turn's or an act's checkpoint: the working context, cursors, and journal
   * this turn owns become the committed ones, together with the run's own
   * accounting when a run owns the turn. Nothing else changes: every other
   * record stays as committed, so a request accepted or marked meanwhile is
   * untouched and a request still provisional is not published.
   */
  #checkpoint(generation: Generation, run?: RunControl): Promise<boolean> {
    return this.#save(generation, {
      working: true,
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

  /**
   * The one way a generation reaches the store, and the one place the scope
   * of a save is decided. Every envelope is composed inside the store's
   * serialized queue from the store's committed state — never from a copy
   * taken before entering the queue, and never from live state the save does
   * not own — so a save can only add what it owns to what the saves before it
   * kept. What a save may own: the working context, cursors, and journal,
   * when it is the checkpoint of the turn holding them; one record's fields,
   * when it is that record's acceptance, transition, accounting, end, or
   * mark; or the whole generation, when it is the restore that just loaded
   * it. Owned record fields land on the live record in the queue step that
   * keeps them. A generation whose checkpoint this runtime could not load
   * never has a working scope, and its whole scope carries the stored items
   * and stamp exactly as committed: the memory is kept, never rewritten by a
   * runtime that cannot read it.
   */
  async #save(generation: Generation, scope: SaveScope): Promise<boolean> {
    let owned: BrainRequestRecord | undefined;
    let missing = false;
    let pruned = false;
    const written = await this.#options.store.write(
      this.#lease,
      generation.id,
      (state) => {
        const context = generation.context;
        const working = (scope.working === true || scope.whole === true) && context !== undefined;
        const checkpoint = working && context ? context.checkpoint() : undefined;
        let requests: readonly BrainRequestRecord[];
        if (scope.whole) {
          requests = [...generation.requests.values()].map((record) => ({ ...record }));
        } else if (scope.record) {
          const { runId, changes } = scope.record;
          const committed = state.requests.find((record) => record.runId === runId);
          if (committed) {
            const changed: BrainRequestRecord = {
              ...committed,
              ...changes,
              revision: committed.revision + 1,
            };
            owned = changed;
            requests = state.requests.map((record) => (record.runId === runId ? changed : record));
          } else if (scope.record.insert) {
            owned = { ...scope.record.insert };
            requests = [...state.requests, owned];
          } else {
            missing = true;
            requests = state.requests;
          }
        } else {
          requests = state.requests;
        }
        const checkpointFormat = checkpoint
          ? checkpointFormatTag(checkpoint.format)
          : state.checkpointFormat;
        return {
          ...(checkpointFormat !== undefined ? { checkpointFormat } : undefined),
          items: checkpoint ? checkpoint.items : state.items,
          cursors: working ? generation.cursors.persisted() : state.cursors,
          journal: working ? generation.journal.entries() : state.journal,
          requests,
        };
      },
      (commit) => {
        // Retention decided inside the same queue step: the runs the store
        // let go of leave the working copy too, or the next checkpoint of
        // the journal would write them straight back.
        if (commit.prunedRunIds.length > 0) {
          for (const runId of commit.prunedRunIds) generation.requests.delete(runId);
          generation.journal.dropRuns(commit.prunedRunIds);
          pruned = true;
        }
        if (!owned || !scope.record) return;
        const live = generation.requests.get(owned.runId);
        if (live) {
          generation.requests.set(owned.runId, {
            ...live,
            ...scope.record.changes,
            revision: owned.revision,
          });
        }
      },
    );
    if (!written || missing) {
      this.#report("Brain memory could not be checkpointed");
      return false;
    }
    // Runs retention let go of are gone from the list every window draws,
    // and the windows hear it now rather than on the next unrelated change.
    if (pruned) this.#notify();
    return true;
  }

  #runRevoked(run: RunControl): boolean {
    return run.cancelled || run.timedOut || this.#stopped || run.generation.abort.signal.aborted;
  }

  async #runAsk(
    run: RunControl,
    question: string,
    events: readonly BrainWakeEvent[],
  ): Promise<void> {
    const generation = run.generation;
    const record = generation.requests.get(run.runId);
    if (!record || record.status !== BRAIN_REQUEST_STATUS.QUEUED || this.#runRevoked(run)) {
      if (record?.status === BRAIN_REQUEST_STATUS.QUEUED) {
        await this.#settleRun(
          generation,
          run.runId,
          run.cancelled ? BRAIN_REQUEST_STATUS.CANCELLED : BRAIN_REQUEST_STATUS.INTERRUPTED,
          {},
        );
      }
      this.#runs.delete(run.runId);
      return;
    }
    // The start is durable before any work opens: a run the file does not
    // show running is one a relaunch would find queued while its acts had
    // begun, and a cancel would settle on the queued path under a dispatched
    // effect. A start the store refuses ends the run as the persistence
    // failure it is, with nothing called; a revocation that landed while the
    // start was being written ends it on its own terms, likewise unopened.
    const started = await this.#commit(generation, run.runId, {
      status: BRAIN_REQUEST_STATUS.RUNNING,
      startedAt: this.#now(),
    });
    this.#notify();
    if (!started || this.#runRevoked(run)) {
      this.#runs.delete(run.runId);
      if (this.#runRevoked(run)) {
        await this.#settleRun(
          generation,
          run.runId,
          run.cancelled ? BRAIN_REQUEST_STATUS.CANCELLED : BRAIN_REQUEST_STATUS.INTERRUPTED,
          {},
        );
        return;
      }
      await this.#settleRun(
        generation,
        run.runId,
        BRAIN_REQUEST_STATUS.FAILED,
        { failure: BRAIN_REQUEST_FAILURE.PERSISTENCE },
        run,
      );
      return;
    }
    run.deadline = this.#schedule(() => {
      run.timedOut = true;
      run.abort.abort();
    }, this.#executionDeadlineMs);
    let result: TurnResult;
    try {
      result = await this.#turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        authority: BRAIN_TURN_AUTHORITY.DEVELOPER,
        events,
        open: (attached, now) => [askInputText(question, attached, now)],
        run,
      });
    } catch {
      result = { outcome: TURN_OUTCOME.FAILED };
    }
    if (run.deadline !== undefined) this.#cancel(run.deadline);
    this.#runs.delete(run.runId);
    const end: RunEnd = {};
    let status: BrainRequestRecord["status"];
    if (run.timedOut) {
      status = BRAIN_REQUEST_STATUS.TIMED_OUT;
      end.failure = BRAIN_REQUEST_FAILURE.DEADLINE;
    } else if (run.cancelled) {
      status = BRAIN_REQUEST_STATUS.CANCELLED;
    } else if (this.#stopped || generation.abort.signal.aborted) {
      status = BRAIN_REQUEST_STATUS.INTERRUPTED;
    } else if (run.checkpointFailed) {
      // What the run did may be unrecorded; that outranks whatever the model
      // did afterwards, and the reply, if one formed, still travels.
      status = BRAIN_REQUEST_STATUS.FAILED;
      end.failure = BRAIN_REQUEST_FAILURE.PERSISTENCE;
      if (result.outcome === TURN_OUTCOME.DONE && result.text) end.text = result.text;
    } else if (result.outcome === TURN_OUTCOME.INCOMPLETE) {
      status = BRAIN_REQUEST_STATUS.FAILED;
      end.failure = BRAIN_REQUEST_FAILURE.INCOMPLETE;
    } else if (result.outcome !== TURN_OUTCOME.DONE) {
      status = BRAIN_REQUEST_STATUS.FAILED;
      end.failure = BRAIN_REQUEST_FAILURE.MODEL;
    } else {
      status = BRAIN_REQUEST_STATUS.SUCCEEDED;
      if (result.text) end.text = result.text;
    }
    await this.#settleRun(generation, run.runId, status, end, run);
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
  async #settleRun(
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
    if (await this.#commit(generation, runId, settled)) {
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
    if (!(await this.#commit(generation, runId, fallback))) {
      this.#update(generation, runId, fallback);
    }
    this.#notify();
  }

  async #turn(plan: TurnPlan): Promise<TurnResult> {
    await this.ready();
    // The generation's death is checked at the door of every turn, so a
    // memory that outlived its fortnight while the app sat idle is not read
    // one more time on the way out.
    this.#expireIfDue();
    const generation = plan.generation;
    // Work queued in a generation since replaced opens nothing: its briefings
    // and its wakes described a memory that no longer exists.
    if (generation !== this.#generation || generation.abort.signal.aborted) {
      return { outcome: TURN_OUTCOME.REVOKED };
    }
    await generation.ready;
    if (generation !== this.#generation || generation.abort.signal.aborted) {
      return { outcome: TURN_OUTCOME.REVOKED };
    }
    const context = generation.context;
    if (!context) {
      // The memory is kept as it is and nothing is read or written over it.
      this.#reportIncompatible(generation);
      return { outcome: TURN_OUTCOME.INCOMPATIBLE };
    }
    const run = plan.run;
    const turnContext: TurnContext = {
      generation,
      ...(run ? { run } : undefined),
      signal: run
        ? AbortSignal.any([generation.abort.signal, run.abort.signal])
        : generation.abort.signal,
    };
    this.#turnInFlight = true;
    let ended = false;
    const execution: BrainActExecution = {
      authority: BRAIN_TURN_AUTHORITY.DEVELOPER,
      isRevoked: () => ended || this.#revoked(turnContext),
      signal: turnContext.signal,
    };
    try {
      return await this.#runTurn(plan, turnContext, context, execution);
    } finally {
      ended = true;
      this.#turnInFlight = false;
    }
  }

  #revoked(context: TurnContext): boolean {
    return this.#stopped || context.signal.aborted;
  }

  async #runTurn(
    plan: TurnPlan,
    turnContext: TurnContext,
    context: ContextEngine,
    execution: BrainActExecution,
  ): Promise<TurnResult> {
    const { generation, run } = turnContext;
    const startedAt = this.#now();
    let contextMark: ContextMark = context.mark();
    let cursorMark = generation.cursors.mark();
    const gathering: TurnGathering = {
      toolCalls: [],
      deliveries: [],
      iterations: 0,
      compacted: false,
      outputText: "",
    };
    const revocation = (): TurnResult => {
      gathering.error = run?.timedOut ? "execution deadline passed" : "turn revoked";
      return { outcome: TURN_OUTCOME.REVOKED };
    };
    if (this.#revoked(turnContext)) return revocation();

    const attachedDeltas = await this.#attachDeltas(plan.events, turnContext);
    const transcriptBytes = attachedDeltas.transcriptBytes;
    let failure: TurnResult | undefined;
    if (this.#revoked(turnContext)) {
      // Nothing the reads gained opens an inference the developer or the
      // host has already withdrawn; the cursors go back with the context.
      failure = revocation();
    } else {
      const events = plan.dropEmptyRosterDeltas
        ? attachedDeltas.events.filter(
            (event) =>
              event.kind !== BRAIN_WAKE_KIND.ROSTER || Boolean(event.transcriptDelta?.text),
          )
        : attachedDeltas.events;
      // Only a developer run advances its rollback point: each answered tool
      // is checkpointed and the mark moves past it, so a later failure
      // returns the context to the last paired state and never to before an
      // act that already happened. An observation turn still rolls back
      // whole, so the deltas it read are read again rather than skipped.
      const advanceMark = async () => {
        if (!run) return;
        if (!(await this.#checkpoint(generation, run))) run.checkpointFailed = true;
        contextMark = context.mark();
        cursorMark = generation.cursors.mark();
      };
      try {
        const end = await this.#execute(plan, turnContext, context, execution, gathering, {
          opening: plan.open(events, startedAt),
          advanceMark,
        });
        failure = this.#turnResultFrom(end, turnContext, gathering);
      } catch (runtimeError) {
        // A runtime that threw instead of ending: the turn fails like one
        // whose model failed, and rolls back to the last paired state.
        gathering.error = runtimeError instanceof Error ? runtimeError.name : "unknown error";
        failure = this.#revoked(turnContext) ? revocation() : { outcome: TURN_OUTCOME.FAILED };
      }
    }

    if (failure) {
      context.rollback(contextMark);
      generation.cursors.rollback(cursorMark);
      this.#report(`Brain ${plan.trigger} turn did not complete: ${gathering.error}`);
    } else {
      generation.cursors.retain(this.#options.roster().identities);
      const written = await this.#checkpoint(generation, run);
      if (!written && run) run.checkpointFailed = true;
      if (written) await context.afterTurn({ signal: turnContext.signal });
      // A briefing leaves only from a turn that still stands: the stop or the
      // replacement that landed during the write — or during an earlier
      // briefing — withdraws every one not yet handed over, and a checkpoint
      // the store refused is one such withdrawal made visible.
      for (const delivery of gathering.deliveries) {
        if (this.#revoked(turnContext) || !written) {
          gathering.error = "turn revoked before delivery";
          break;
        }
        try {
          await this.#options.deliver(delivery);
        } catch (deliverError) {
          this.#report(
            `Brain briefing could not be delivered: ${deliverError instanceof Error ? deliverError.name : "unknown error"}`,
          );
        }
      }
    }

    const model = this.#options.model.model;
    this.#options.trace?.({
      trigger: plan.trigger,
      authority: plan.authority,
      runtime: this.#options.runtime.descriptor.id,
      ...(gathering.inputTokens !== undefined ? { inputTokens: gathering.inputTokens } : undefined),
      transcriptBytes,
      toolCalls: gathering.toolCalls,
      ...(gathering.outputText ? { outputText: gathering.outputText } : undefined),
      deliveries: gathering.deliveries.map((delivery) => ({
        briefingChars: delivery.briefing.length,
      })),
      ...(model ? { model } : undefined),
      elapsedMs: this.#now() - startedAt,
      iterations: gathering.iterations,
      compacted: gathering.compacted,
      ...(gathering.error ? { error: gathering.error } : undefined),
    });

    return failure ?? { outcome: TURN_OUTCOME.DONE, text: gathering.outputText };
  }

  /**
   * One execution on the runtime: the opening words, the toolset the
   * authority fixes, the standing context rebuilt for every inference, and a
   * listener that keeps what the run gathers and checkpoints each answered
   * tool before the runtime asks the model again.
   */
  #execute(
    plan: TurnPlan,
    turnContext: TurnContext,
    context: ContextEngine,
    execution: BrainActExecution,
    gathering: TurnGathering,
    turn: { opening: readonly string[]; advanceMark: () => Promise<void> },
  ): Promise<RuntimeRunEnd> {
    const { run } = turnContext;
    const runId = run?.runId ?? `${plan.trigger}-${++this.#observationTurns}`;
    const tools = this.#executor(plan, turnContext, execution, gathering);
    const onEvent = async (event: RuntimeEvent) => {
      switch (event.kind) {
        case RUNTIME_EVENT.ANSWERED:
          if (event.toolCalls > 0) gathering.iterations += 1;
          return;
        case RUNTIME_EVENT.TEXT:
          gathering.outputText = event.text;
          return;
        case RUNTIME_EVENT.USAGE:
          if (event.usage.inputTokens !== undefined) {
            gathering.inputTokens = event.usage.inputTokens;
          }
          return;
        case RUNTIME_EVENT.COMPACTED:
          gathering.compacted = true;
          return;
        case RUNTIME_EVENT.TOOL_RESULT:
          gathering.toolCalls.push({
            name: event.invocation.name,
            argumentsChars: event.invocation.argumentsJson.length,
            outcomeStatus: event.result.status ?? "answered",
          });
          // The answered tool is in the context; a run keeps it before the
          // model is asked again, so a later failure cannot unpair it.
          await turn.advanceMark();
          return;
        default:
          return;
      }
    };
    const started = this.#options.runtime.start({
      runId,
      context,
      tools,
      toolSchemas: brainToolSchemas(plan.authority),
      prompt: this.#instructions(),
      input: turn.opening.map((text) => ({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text })),
      ephemeral: () => [
        standingContextText(
          this.#options.roster().text,
          this.#options.standingContext(),
          this.#now(),
        ),
      ],
      maximumOutputTokens: this.#maximumOutputTokens,
      ...(this.#options.reasoningEffort
        ? { reasoningEffort: this.#options.reasoningEffort }
        : undefined),
      signal: turnContext.signal,
      onEvent,
    });
    return started.done;
  }

  /** How a run's end reads as a turn's: an observation turn keeps what it read wherever a run would fall short. */
  #turnResultFrom(
    end: RuntimeRunEnd,
    turnContext: TurnContext,
    gathering: TurnGathering,
  ): TurnResult | undefined {
    if (this.#revoked(turnContext)) {
      gathering.error = turnContext.run?.timedOut ? "execution deadline passed" : "turn revoked";
      return { outcome: TURN_OUTCOME.REVOKED };
    }
    switch (end.reason) {
      case RUN_END_REASON.COMPLETED:
        return undefined;
      case RUN_END_REASON.THROTTLED:
        gathering.error = "quiet";
        return { outcome: TURN_OUTCOME.QUIET, until: end.until };
      case RUN_END_REASON.PROVIDER_FAILURE:
        gathering.error = end.detail;
        return { outcome: TURN_OUTCOME.FAILED };
      case RUN_END_REASON.INCOMPLETE:
      case RUN_END_REASON.LOOP_GUARD:
        // The model stopped short of any words. A run says it fell short
        // rather than claiming a reply; an observation turn has nobody to
        // answer, and keeps what it read so the deltas are not read twice.
        gathering.error = end.detail;
        return turnContext.run ? { outcome: TURN_OUTCOME.INCOMPLETE } : undefined;
      case RUN_END_REASON.CANCELLED:
      case RUN_END_REASON.DEADLINE:
        gathering.error =
          end.reason === RUN_END_REASON.DEADLINE ? "execution deadline passed" : "turn revoked";
        return { outcome: TURN_OUTCOME.REVOKED };
    }
  }

  /**
   * Reads what each woken session's transcript gained since the brain last
   * looked, once per session however many events name it, and moves the
   * cursor. The cursor moves with the context: a turn that fails rolls both
   * back, so the same delta is read again rather than skipped. A read still
   * out when the turn is revoked is left unread: the wait settles, and the
   * turn goes on to its rollback without it.
   */
  #attachDeltas(
    events: readonly BrainWakeEvent[],
    context: TurnContext,
  ): Promise<TranscriptDeltasAttached> {
    return attachTranscriptDeltas(events, {
      cursors: context.generation.cursors,
      read: (identity, cursor) => this.#options.readTranscriptSince(identity, cursor),
      signal: context.signal,
      maximumChars: this.#deltaPerSessionChars,
      revoked: () => this.#revoked(context),
    });
  }

  #refusalForAuthority(plan: TurnPlan, name: string): WireRecord | undefined {
    if (brainToolAllowed(plan.authority, name)) return undefined;
    if (name === BRAIN_TOOL.ANNOUNCE) return rejection(REFUSAL_REASON.ANNOUNCE_IN_ASK);
    if (plan.authority === BRAIN_TURN_AUTHORITY.OBSERVATION && !isBrainOnlyTool(name)) {
      return rejection(REFUSAL_REASON.ACT_IN_OBSERVATION);
    }
    return rejection(REFUSAL_REASON.NOT_OFFERED);
  }

  /**
   * The tool executor one turn hands its runtime: every call the model emits
   * lands here, is refused when the turn's authority never offered it, and
   * is otherwise the brain's own read, the briefing it decided to give, or
   * an act carried through the journal. The runtime's own standing joins the
   * turn's: an act prepared inside a run the runtime has ended is refused.
   */
  #executor(
    plan: TurnPlan,
    turnContext: TurnContext,
    execution: BrainActExecution,
    gathering: TurnGathering,
  ): ToolExecutor {
    const answer = (output: WireRecord): ToolResult => {
      const status = text(output.status);
      return { outputJson: JSON.stringify(output), ...(status ? { status } : undefined) };
    };
    return {
      execute: async (call: ToolInvocation, runtimeContext: ToolExecutionContext) => {
        const refused = this.#refusalForAuthority(plan, call.name);
        if (refused) return answer(refused);
        const roster = this.#options.roster();
        const args = parsedRecord(call.argumentsJson);
        const named = identityFromRecord(args);
        const observed = (identity: SessionIdentity) =>
          roster.identities.some((listed) => sameIdentity(listed, identity));
        if (!isBrainOnlyTool(call.name)) {
          if (plan.authority !== BRAIN_TURN_AUTHORITY.DEVELOPER || !turnContext.run) {
            return answer(rejection(REFUSAL_REASON.ACT_IN_OBSERVATION));
          }
          const joined: BrainActExecution = {
            authority: execution.authority,
            isRevoked: () => execution.isRevoked() || runtimeContext.isRevoked(),
            signal: execution.signal,
          };
          return answer(await this.#performJournaled(call, turnContext.run, joined));
        }
        switch (call.name) {
          case BRAIN_TOOL.LIST_SESSIONS:
            return answer({ roster: roster.text });
          case BRAIN_TOOL.READ_TRANSCRIPT: {
            if (!named || !observed(named)) {
              return answer(rejection(REFUSAL_REASON.UNOBSERVED_SESSION));
            }
            return answer(await this.#readWhole(named, turnContext));
          }
          case BRAIN_TOOL.ANNOUNCE: {
            const briefing = text(args.briefing)?.slice(0, maximumBriefingLength);
            if (!briefing) return answer(rejection(REFUSAL_REASON.EMPTY_BRIEFING));
            gathering.deliveries.push({ briefing, decidedAt: this.#now() });
            return answer({ status: ACT_RESULT_STATUS.ACCEPTED });
          }
        }
      },
    };
  }

  /**
   * One act through the journal. A call id the run already answered gets its
   * recorded result back rather than a second effect — or the honest unknown,
   * when the act started and its result was lost — and the same id with other
   * arguments is refused rather than guessed at. A fresh call is written as
   * started and checkpointed before the performer sees it, so a crash mid-act
   * is found as an act of unknown result and never replayed; a checkpoint
   * that will not land refuses the act instead, because an act nobody could
   * find afterwards is one the developer could not account for. A performer
   * that throws after dispatch has answered nothing about the effect: the
   * outcome is unknown, counted as such, and never a refusal.
   */
  async #performJournaled(
    call: ToolInvocation,
    run: RunControl,
    execution: BrainActExecution,
  ): Promise<WireRecord> {
    const { generation } = run;
    if (this.#runRevoked(run) || execution.isRevoked()) {
      return rejection(REFUSAL_REASON.RUN_REVOKED);
    }
    const recorded = generation.journal.get(run.runId, call.callId);
    if (recorded) {
      if (recorded.argumentsJson !== call.argumentsJson) {
        return rejection(REFUSAL_REASON.CALL_ID_REUSED);
      }
      return recorded.outputJson === undefined
        ? { ...UNKNOWN_ACT_RESULT }
        : parsedRecord(recorded.outputJson);
    }
    if (run.checkpointFailed) return rejection(REFUSAL_REASON.NOT_CHECKPOINTED);
    generation.journal.start({
      runId: run.runId,
      callId: call.callId,
      name: call.name,
      argumentsJson: call.argumentsJson,
      startedAt: this.#now(),
    });
    if (!(await this.#checkpoint(generation, run))) {
      generation.journal.forget(run.runId, call.callId);
      run.checkpointFailed = true;
      return rejection(REFUSAL_REASON.NOT_CHECKPOINTED);
    }
    let output: WireRecord;
    try {
      output = await this.#options.acts.perform(
        { name: call.name, argumentsJson: call.argumentsJson },
        execution,
      );
    } catch {
      output = { ...UNCONFIRMED_ACT_RESULT };
    }
    if (output.status === ACT_RESULT_STATUS.ACCEPTED) run.performedActs += 1;
    if (output.status === UNCONFIRMED_ACT_RESULT.status) run.unknownActs += 1;
    generation.journal.settle(run.runId, call.callId, JSON.stringify(output), this.#now());
    // The record's accounting travels with the checkpoint that follows the
    // result, owned by the run, so a copy taken before the next inference
    // already says what was done.
    return output;
  }

  #readWhole(identity: SessionIdentity, context: TurnContext): Promise<WireRecord> {
    return readWholeTranscript(identity, {
      read: (identity) => this.#options.readTranscript(identity),
      signal: context.signal,
      maximumChars: this.#fullTranscriptChars,
    });
  }
}
