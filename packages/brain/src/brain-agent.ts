import type { RealtimeFunctionCall } from "@sidecar/acts";
import { BRAIN_TURN_AUTHORITY, type BrainTurnAuthority } from "@sidecar/hosted";
import type { ScheduledTimer } from "@sidecar/realtime";
import {
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  SESSION_STATUS,
  type Session,
  type SessionIdentity,
} from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { BRAIN_CLIENT_OUTCOME, type BrainClient } from "./brain-client.js";
import {
  BRAIN_DELIVERY_SOURCE,
  BRAIN_WAKE_KIND,
  type BrainDelivery,
  type BrainDeliverySource,
  type BrainTranscriptDelta,
  type BrainWakeEvent,
} from "./brain-events.js";
import {
  askInputItem,
  holdReleasedInputItem,
  standingContextItem,
  wakeInputItem,
} from "./brain-input.js";
import { BrainJournal, type BrainJournalEntry, UNKNOWN_ACT_RESULT } from "./brain-journal.js";
import { BrainMemory, pairedDanglingCalls } from "./brain-memory.js";
import {
  type BrainFunctionCall,
  type BrainResponsesOutput,
  brainResponsesOutput,
  functionCallOutputItem,
  type ResponsesInputItem,
} from "./brain-openai.js";
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
} from "./brain-requests.js";
import type { BrainPersistedState, BrainStateStore } from "./brain-state.js";
import {
  BRAIN_TOOL,
  brainToolAllowed,
  isBrainOnlyTool,
  maximumBriefingLength,
} from "./brain-tools.js";

/**
 * The brain: one long-lived agent that is woken by the agents' hooks and by
 * its own scheduled look at the roster, asked things by the developer, and
 * answers with briefings for the voice to speak and acts for the host to
 * carry. Nothing detects a change on its behalf: the roster look carries
 * what stands and what each transcript gained, and the brain notices what is
 * new against its own memory. It is transport- and storage-agnostic on
 * purpose — the client, the roster rendering, the transcript reads, the
 * delivery, and the persistence are all handed in — so the same agent runs in
 * the desktop's main process and, later, behind a service request.
 *
 * Every write it can cause still runs the host's own validation: an act tool
 * call goes to the performer as a function call and nothing more, and the host
 * validates it against what it observed exactly as it would a spoken one. And
 * an act can leave a turn at all only when the developer opened it: the turn's
 * authority is fixed here from what invoked it — an ask is the developer's,
 * a wake, a roster look, or a hold release is observation — so the toolset a
 * model is offered and the gate every emitted call meets are both decided
 * before the model reads a word, and nothing it reads can move them.
 *
 * A developer ask is a run with a record: accepted once its record is
 * checkpointed, queued behind the turns ahead of it, running under an
 * execution deadline and a cancellation the developer holds, and ended in one
 * of the terminal statuses the record vocabulary names. Every act the run
 * dispatches is journaled before the performer sees it and again with its
 * result before the model does, and the memory's rollback point advances
 * past each answered act, so a reply the model then fails to produce cannot
 * erase an act that already happened.
 */

export const BRAIN_DEFAULTS = {
  MAXIMUM_OUTPUT_TOKENS: 16_000,
  MAX_TOOL_ITERATIONS: 8,
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

/** Stands where the front of a transcript was cut, so the model knows it is reading a tail. */
export const OMISSION_MARKER = "[… earlier transcript omitted …]";

export const BRAIN_TURN_TRIGGER = {
  WAKE: "wake",
  ROSTER: "roster",
  ASK: "ask",
  HOLD_RELEASED: "hold-released",
} as const;

export type BrainTurnTrigger = (typeof BRAIN_TURN_TRIGGER)[keyof typeof BRAIN_TURN_TRIGGER];

const REFUSAL_REASON = {
  UNOBSERVED_SESSION: "not an observed session",
  ANNOUNCE_IN_ASK: "reply in text: this is a developer ask, and your final text is the speech",
  ACT_IN_OBSERVATION:
    "not run: an act needs a turn the developer opened, and this one was opened by observation",
  NOT_OFFERED: "not run: no such tool in this turn",
  EMPTY_BRIEFING: "a briefing needs words",
  BUDGET_SPENT: "not run: this turn's tool budget is spent",
  ACT_FAILED: "the act did not complete",
  READ_FAILED: "the transcript could not be read",
  RUN_REVOKED: "not run: this ask was cancelled or its run ended",
  NOT_CHECKPOINTED: "not run: the act could not be recorded before running, so it was not run",
  CALL_ID_REUSED: "not run: this call id was already used with different arguments",
} as const;

/**
 * The roster as the host renders it, with the identities every tool argument
 * is validated against, and the sessions themselves for the scheduled look to
 * choose which transcripts to read.
 */
export interface BrainRoster {
  text: string;
  identities: readonly SessionIdentity[];
  sessions?: readonly Session[];
}

/**
 * The standing a developer-opened turn hands the performer with each act: its
 * authority, which can only ever be the developer's because no other turn
 * reaches a performer, and whether the turn it belongs to still stands. The
 * performer asks `isRevoked()` after each step it awaited and once more just
 * before the effect, so an act prepared inside a turn that has since ended
 * is refused rather than dispatched. Today a turn's execution is revoked when
 * the turn ends or the agent stops; a request lifecycle may bind it tighter.
 */
export interface BrainActExecution {
  readonly authority: typeof BRAIN_TURN_AUTHORITY.DEVELOPER;
  isRevoked(): boolean;
}

/** Carries one act for the host to validate and perform; answers what happened as a record. */
export interface BrainActPerformer {
  perform(call: RealtimeFunctionCall, execution: BrainActExecution): Promise<WireRecord>;
}

export interface BrainToolCallTrace {
  name: string;
  argumentsChars: number;
  outcomeStatus: string;
}

/**
 * One turn as the development trace records it: what woke it, the kinds of
 * item it appended, the input size the API counted, how many transcript
 * characters it read, each tool call by name and outcome, the text and
 * briefings it produced, and how it ran — never a transcript's text.
 */
export interface BrainTurnTraceRecord {
  trigger: BrainTurnTrigger;
  authority: BrainTurnAuthority;
  inputItemKinds: readonly string[];
  inputTokens?: number;
  transcriptBytes: number;
  toolCalls: readonly BrainToolCallTrace[];
  outputText?: string;
  deliveries: readonly { briefingChars: number }[];
  model?: string;
  elapsedMs: number;
  iterations: number;
  compacted: boolean;
  error?: string;
}

export interface BrainAgentOptions {
  client: BrainClient;
  acts: BrainActPerformer;
  roster: () => BrainRoster;
  /** Everything the host renders beside the roster: projects, facts, recent conversation, guide. */
  standingContext: () => string;
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
  maxToolIterations?: number;
  wakeCoalesceMs?: number;
  executionDeadlineMs?: number;
  deltaPerSessionChars?: number;
  fullTranscriptChars?: number;
}

const TURN_OUTCOME = {
  DONE: "done",
  QUIET: "quiet",
  FAILED: "failed",
  REVOKED: "revoked",
} as const;

type TurnResult =
  | { outcome: typeof TURN_OUTCOME.DONE; text: string }
  | { outcome: typeof TURN_OUTCOME.QUIET; until: number }
  | { outcome: typeof TURN_OUTCOME.FAILED }
  | { outcome: typeof TURN_OUTCOME.REVOKED };

/**
 * One developer run's live controls: the signal its model and read work are
 * aborted through, and the flags every `isRevoked` reads. A run's execution
 * is revoked by the developer's cancel, by the deadline, by the agent
 * stopping, and by the store's generation being replaced under it.
 */
interface RunControl {
  runId: string;
  generationId: string;
  abort: AbortController;
  cancelled: boolean;
  timedOut: boolean;
  deadline?: ScheduledTimer;
  /** Whether a checkpoint failed inside this run, after which no further act may be dispatched. */
  checkpointFailed: boolean;
  performedActs: number;
}

interface TurnPlan {
  trigger: BrainTurnTrigger;
  authority: BrainTurnAuthority;
  events: readonly BrainWakeEvent[];
  open: (events: readonly BrainWakeEvent[], now: number) => readonly ResponsesInputItem[];
  deliverySource?: BrainDeliverySource;
  /** Whether a roster look's events with nothing new in their transcript are left out. */
  dropEmptyRosterDeltas?: boolean;
  run?: RunControl;
}

interface DispatchOutcome {
  callId: string;
  output: WireRecord;
}

/** What a run's end carries into its record beyond the status. */
interface RunEnd {
  text?: string;
  failure?: BrainRequestFailure;
}

interface LoopHooks {
  append: (items: readonly ResponsesInputItem[]) => void;
  toolCalls: BrainToolCallTrace[];
  deliveries: BrainDelivery[];
  onIteration: () => void;
  onOutput: (output: BrainResponsesOutput) => void;
  onError: (reason: string) => void;
  advanceMark: () => Promise<void>;
  revoked: () => boolean;
  revocation: () => TurnResult;
}

/** A transcript held to a bound from the front, and whether anything was cut. */
interface FrontCut {
  text: string;
  cut: boolean;
}

function cutFront(value: string, maximumChars: number): FrontCut {
  if (value.length <= maximumChars) return { text: value, cut: false };
  const keep = Math.max(0, maximumChars - OMISSION_MARKER.length - 1);
  return { text: `${OMISSION_MARKER}\n${value.slice(value.length - keep)}`, cut: true };
}

function parsedRecord(json: string): WireRecord {
  try {
    // SAFETY: JSON.parse returns a wire value; the record check below is the validation.
    const parsed = JSON.parse(json) as UnparsedWireValue;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function identityFromRecord(value: UnparsedWireValue): SessionIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = text(value.provider_id);
  const providerSessionId = text(value.provider_session_id);
  return providerId && providerSessionId ? { providerId, providerSessionId } : undefined;
}

function sameIdentity(first: SessionIdentity, second: SessionIdentity): boolean {
  return (
    first.providerId === second.providerId && first.providerSessionId === second.providerSessionId
  );
}

function rejection(reason: string): WireRecord {
  return { status: ACT_RESULT_STATUS.REJECTED, reason };
}

/** Identities collected without a composite key: one list, membership by both fields. */
class IdentitySet {
  readonly #identities: SessionIdentity[] = [];

  add(identity: SessionIdentity): void {
    if (!this.#identities.some((held) => sameIdentity(held, identity))) {
      this.#identities.push({ ...identity });
    }
  }

  list(): readonly SessionIdentity[] {
    return [...this.#identities];
  }
}

export type BrainRequestsListener = (records: readonly BrainRequestRecord[]) => void;

export class BrainAgent {
  readonly #options: BrainAgentOptions;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  readonly #report: (message: string) => void;
  readonly #maximumOutputTokens: number;
  readonly #maxToolIterations: number;
  readonly #wakeCoalesceMs: number;
  readonly #executionDeadlineMs: number;
  readonly #deltaPerSessionChars: number;
  readonly #fullTranscriptChars: number;
  #memory = new BrainMemory();
  #journal = new BrainJournal();
  #requests = new Map<string, BrainRequestRecord>();
  readonly #runs = new Map<string, RunControl>();
  readonly #listeners = new Set<BrainRequestsListener>();
  #generationId: string | undefined;
  #turnInFlight = false;
  #restored: Promise<void> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #pending: BrainWakeEvent[] = [];
  #flushTimer: ScheduledTimer | undefined;
  #stopped = false;
  #unsubscribeStore: (() => void) | undefined;

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
    this.#maximumOutputTokens = options.maximumOutputTokens ?? BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS;
    this.#maxToolIterations = options.maxToolIterations ?? BRAIN_DEFAULTS.MAX_TOOL_ITERATIONS;
    this.#wakeCoalesceMs = options.wakeCoalesceMs ?? BRAIN_DEFAULTS.WAKE_COALESCE_MS;
    this.#executionDeadlineMs = options.executionDeadlineMs ?? BRAIN_DEFAULTS.EXECUTION_DEADLINE_MS;
    this.#deltaPerSessionChars =
      options.deltaPerSessionChars ?? BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS;
    this.#fullTranscriptChars = options.fullTranscriptChars ?? BRAIN_DEFAULTS.FULL_TRANSCRIPT_CHARS;
    this.#unsubscribeStore = options.store.onReplaced((state) => this.#adoptGeneration(state));
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

  /** Every run this generation holds, oldest acceptance first. */
  requests(): readonly BrainRequestRecord[] {
    return [...this.#requests.values()].map((record) => ({ ...record }));
  }

  request(runId: string): BrainRequestRecord | undefined {
    const record = this.#requests.get(runId);
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
   * submission asked twice — a transport retrying — finds the run it already
   * has; a new submission id is a new run, however alike the words. Acceptance
   * is answered only once the record is checkpointed, so a caller told
   * "accepted" can find the run again after a crash. Pending wakes ride in
   * the run's turn, so the reply knows what just changed.
   */
  async submitAsk(submission: BrainSubmission): Promise<BrainSubmissionResult> {
    await this.ready();
    const generationId = this.#generationId;
    if (this.#stopped || generationId === undefined) {
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
    const existing = [...this.#requests.values()].find(
      (record) => record.submissionId === submission.submissionId,
    );
    if (existing) {
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED,
        runId: existing.runId,
        acceptedAt: existing.acceptedAt,
      };
    }
    const acceptedAt = this.#now();
    const record: BrainRequestRecord = {
      runId: this.#options.createRunId(),
      submissionId: submission.submissionId,
      origin: submission.origin,
      question,
      status: BRAIN_REQUEST_STATUS.QUEUED,
      revision: 0,
      acceptedAt,
      performedActs: 0,
    };
    this.#requests.set(record.runId, record);
    if (!(await this.#checkpoint(generationId))) {
      this.#requests.delete(record.runId);
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.PERSISTENCE,
      };
    }
    this.#notify();
    const run: RunControl = {
      runId: record.runId,
      generationId,
      abort: new AbortController(),
      cancelled: false,
      timedOut: false,
      checkpointFailed: false,
      performedActs: 0,
    };
    this.#runs.set(run.runId, run);
    this.#cancelFlush();
    const events = this.#takePending();
    void this.#enqueue(() => this.#runAsk(run, question, events));
    return { outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED, runId: record.runId, acceptedAt };
  }

  /**
   * Answers the record once the run ends, or as it stands when the wait runs
   * out first. A wait that runs out changes nothing about the run, and a run
   * this generation does not know answers nothing.
   */
  async waitAsk(runId: string, timeoutMs: number): Promise<BrainRequestRecord | undefined> {
    await this.ready();
    const record = this.#requests.get(runId);
    if (!record) return undefined;
    if (isTerminalBrainRequestStatus(record.status)) return { ...record };
    return new Promise((resolve) => {
      let timer: ScheduledTimer | undefined;
      const finish = () => {
        unsubscribe();
        if (timer !== undefined) this.#cancel(timer);
        const current = this.#requests.get(runId);
        resolve(current ? { ...current } : undefined);
      };
      const unsubscribe = this.subscribe(() => {
        const current = this.#requests.get(runId);
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
    const record = this.#requests.get(runId);
    if (!record) return undefined;
    if (isTerminalBrainRequestStatus(record.status)) return { ...record };
    const run = this.#runs.get(runId);
    if (run) {
      run.cancelled = true;
      run.abort.abort();
    }
    if (record.status === BRAIN_REQUEST_STATUS.QUEUED) {
      await this.#settleRun(runId, BRAIN_REQUEST_STATUS.CANCELLED, {});
    }
    return this.request(runId);
  }

  /**
   * Queues wake events. Nothing is sent yet: wakes inside the coalescing
   * window open one turn together, and wakes during a client's quiet wait for
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
    this.#cancelFlush();
    const events = this.#takePending();
    void this.#enqueue(() =>
      this.#turn({
        trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED,
        authority: BRAIN_TURN_AUTHORITY.OBSERVATION,
        events,
        open: (attached, now) => [
          ...(attached.length > 0 ? [wakeInputItem(attached, now)] : []),
          holdReleasedInputItem(held, now),
        ],
        deliverySource: BRAIN_DELIVERY_SOURCE.HOLD_RELEASED,
      }),
    );
  }

  /**
   * Drops pending wakes, revokes every run's execution, lets the running turn
   * wind down, and takes nothing more. Unfinished runs are recorded as
   * interrupted: the agent stopping — a key or account changing, the app
   * quitting — is not the developer's cancel, and the record says which.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#cancelFlush();
    this.#pending = [];
    this.#unsubscribeStore?.();
    this.#unsubscribeStore = undefined;
    for (const run of this.#runs.values()) run.abort.abort();
    for (const record of this.requests()) {
      if (record.status === BRAIN_REQUEST_STATUS.QUEUED) {
        await this.#settleRun(record.runId, BRAIN_REQUEST_STATUS.INTERRUPTED, {});
      }
    }
    await this.#queue;
  }

  /**
   * One look at the whole roster, driven by the host's observation pass rather
   * than an internal timer. Carries the roster as `list_sessions` renders it
   * and, for every local session the brain has read before or that is working
   * or waiting now, what its transcript gained since — sessions with nothing
   * new are left out. Skipped while a turn is in flight or the client is
   * quiet, because the next look reads the same deltas; pending hook wakes
   * ride along rather than waiting for their own.
   */
  rosterLook(): void {
    if (this.#stopped || this.#turnInFlight) return;
    if (this.#options.client.quietUntil() !== undefined) return;
    const roster = this.#options.roster();
    const now = this.#now();
    const looks: BrainWakeEvent[] = (roster.sessions ?? []).flatMap((session) => {
      const identity: SessionIdentity = {
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      };
      const readBefore = this.#memory.cursor(identity) !== undefined;
      const live =
        session.status === SESSION_STATUS.WORKING || session.status === SESSION_STATUS.WAITING;
      if (session.location !== SESSION_LOCATION.LOCAL || !(readBefore || live)) return [];
      return [{ kind: BRAIN_WAKE_KIND.ROSTER, identity, session, atMs: now }];
    });
    this.#cancelFlush();
    const events = [...this.#takePending(), ...looks];
    void this.#enqueue(() =>
      this.#turn({
        trigger: BRAIN_TURN_TRIGGER.ROSTER,
        authority: BRAIN_TURN_AUTHORITY.OBSERVATION,
        events,
        open: (attached, openedAt) => [wakeInputItem(attached, openedAt, roster.text)],
        deliverySource: BRAIN_DELIVERY_SOURCE.WAKE,
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
    const quietUntil = this.#options.client.quietUntil();
    if (quietUntil !== undefined) {
      this.#scheduleFlush(Math.max(quietUntil - this.#now(), this.#wakeCoalesceMs));
      return;
    }
    const events = this.#takePending();
    if (events.length === 0) return;
    void this.#enqueue(async () => {
      const result = await this.#turn({
        trigger: BRAIN_TURN_TRIGGER.WAKE,
        authority: BRAIN_TURN_AUTHORITY.OBSERVATION,
        events,
        open: (attached, now) => [wakeInputItem(attached, now)],
        deliverySource: BRAIN_DELIVERY_SOURCE.WAKE,
      });
      if (result.outcome === TURN_OUTCOME.QUIET && !this.#stopped) {
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
    this.#adopt(state);
    const interrupted = interruptedUnfinishedRequests(state.requests, this.#now());
    const paired = pairedDanglingCalls(state.items, () => JSON.stringify(UNKNOWN_ACT_RESULT));
    if (interrupted === state.requests && paired === state.items) return;
    this.#requests = new Map(interrupted.map((record) => [record.runId, record]));
    this.#memory = new BrainMemory({ items: paired, cursors: state.cursors });
    await this.#checkpoint(state.generationId);
    this.#notify();
  }

  /** Takes an envelope as the agent's working copy: memory, journal, and records alike. */
  #adopt(state: BrainPersistedState): void {
    this.#generationId = state.generationId;
    this.#memory = new BrainMemory({ items: state.items, cursors: state.cursors });
    this.#journal = new BrainJournal(state.journal);
    this.#requests = new Map(state.requests.map((record) => [record.runId, { ...record }]));
  }

  /**
   * The store's generation changed under this agent — a reset or a
   * replacement. Every run of the old generation loses its execution at once:
   * its signal fires, its `isRevoked` answers true, and its late checkpoints
   * land nowhere because the store fences them by generation. The agent then
   * works from the new envelope, which holds no record of those runs.
   */
  #adoptGeneration(state: BrainPersistedState): void {
    if (state.generationId === this.#generationId) return;
    for (const run of this.#runs.values()) {
      run.cancelled = true;
      run.abort.abort();
    }
    this.#adopt(state);
    this.#notify();
  }

  /**
   * Writes the working copy through the store under the generation it belongs
   * to. False means the file does not hold what memory holds — refused by the
   * fence or by storage — and the caller decides what that forbids.
   */
  async #checkpoint(generationId: string): Promise<boolean> {
    const memory = this.#memory.persisted();
    const requests = this.requests();
    const journal: readonly BrainJournalEntry[] = this.#journal.entries();
    const written = await this.#options.store.write(generationId, () => ({
      items: memory.items,
      cursors: memory.cursors,
      requests,
      journal,
    }));
    if (!written) this.#report("Brain memory could not be checkpointed");
    return written;
  }

  #runRevoked(run: RunControl): boolean {
    return (
      run.cancelled || run.timedOut || this.#stopped || run.generationId !== this.#generationId
    );
  }

  async #runAsk(
    run: RunControl,
    question: string,
    events: readonly BrainWakeEvent[],
  ): Promise<void> {
    const record = this.#requests.get(run.runId);
    if (!record || record.status !== BRAIN_REQUEST_STATUS.QUEUED || this.#runRevoked(run)) {
      if (record?.status === BRAIN_REQUEST_STATUS.QUEUED) {
        await this.#settleRun(
          run.runId,
          this.#stopped ? BRAIN_REQUEST_STATUS.INTERRUPTED : BRAIN_REQUEST_STATUS.CANCELLED,
          {},
        );
      }
      this.#runs.delete(run.runId);
      return;
    }
    this.#update(run.runId, { status: BRAIN_REQUEST_STATUS.RUNNING, startedAt: this.#now() });
    await this.#checkpoint(run.generationId);
    this.#notify();
    run.deadline = this.#schedule(() => {
      run.timedOut = true;
      run.abort.abort();
    }, this.#executionDeadlineMs);
    let result: TurnResult;
    try {
      result = await this.#turn({
        trigger: BRAIN_TURN_TRIGGER.ASK,
        authority: BRAIN_TURN_AUTHORITY.DEVELOPER,
        events,
        open: (attached, now) => [askInputItem(question, attached, now)],
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
    } else if (this.#stopped || run.generationId !== this.#generationId) {
      status = BRAIN_REQUEST_STATUS.INTERRUPTED;
    } else if (result.outcome !== TURN_OUTCOME.DONE) {
      status = BRAIN_REQUEST_STATUS.FAILED;
      end.failure = BRAIN_REQUEST_FAILURE.MODEL;
    } else if (run.checkpointFailed) {
      status = BRAIN_REQUEST_STATUS.FAILED;
      end.failure = BRAIN_REQUEST_FAILURE.PERSISTENCE;
      if (result.text) end.text = result.text;
    } else {
      status = BRAIN_REQUEST_STATUS.SUCCEEDED;
      if (result.text) end.text = result.text;
    }
    await this.#settleRun(run.runId, status, end, run.performedActs, run.generationId);
  }

  #update(runId: string, changes: Partial<Omit<BrainRequestRecord, "runId" | "revision">>): void {
    const record = this.#requests.get(runId);
    if (!record) return;
    this.#requests.set(runId, { ...record, ...changes, revision: record.revision + 1 });
  }

  async #settleRun(
    runId: string,
    status: BrainRequestRecord["status"],
    end: RunEnd,
    performedActs?: number,
    generationId = this.#generationId,
  ): Promise<void> {
    const record = this.#requests.get(runId);
    if (!record || isTerminalBrainRequestStatus(record.status)) return;
    this.#update(runId, {
      status,
      settledAt: this.#now(),
      ...(end.text !== undefined ? { text: end.text } : undefined),
      ...(end.failure !== undefined ? { failure: end.failure } : undefined),
      ...(performedActs !== undefined ? { performedActs } : undefined),
    });
    if (generationId !== undefined) await this.#checkpoint(generationId);
    this.#notify();
  }

  async #turn(plan: TurnPlan): Promise<TurnResult> {
    this.#turnInFlight = true;
    let ended = false;
    const run = plan.run;
    const execution: BrainActExecution = {
      authority: BRAIN_TURN_AUTHORITY.DEVELOPER,
      isRevoked: () => ended || this.#stopped || (run !== undefined && this.#runRevoked(run)),
    };
    try {
      return await this.#runTurn(plan, execution);
    } finally {
      ended = true;
      this.#turnInFlight = false;
    }
  }

  async #runTurn(plan: TurnPlan, execution: BrainActExecution): Promise<TurnResult> {
    await this.ready();
    const run = plan.run;
    const startedAt = this.#now();
    let mark = this.#memory.mark();
    const appendedKinds: string[] = [];
    const toolCalls: BrainToolCallTrace[] = [];
    const deliveries: BrainDelivery[] = [];
    let iterations = 0;
    let compacted = false;
    let inputTokens: number | undefined;
    let outputText = "";
    let error: string | undefined;

    const revoked = () => run !== undefined && this.#runRevoked(run);
    const revocation = (): TurnResult => {
      error = run?.timedOut ? "execution deadline passed" : "run revoked";
      return { outcome: TURN_OUTCOME.REVOKED };
    };
    if (revoked()) return revocation();

    const attachedDeltas = await this.#attachDeltas(plan.events);
    const transcriptBytes = attachedDeltas.transcriptBytes;
    const events = plan.dropEmptyRosterDeltas
      ? attachedDeltas.events.filter(
          (event) => event.kind !== BRAIN_WAKE_KIND.ROSTER || Boolean(event.transcriptDelta?.text),
        )
      : attachedDeltas.events;
    const append = (items: readonly ResponsesInputItem[]) => {
      this.#memory.append(items);
      for (const item of items) appendedKinds.push(text(item.type) ?? "unknown");
    };
    append(plan.open(events, startedAt));

    let failure: TurnResult | undefined;
    try {
      failure = await this.#loop(plan, execution, {
        append,
        toolCalls,
        deliveries,
        onIteration: () => {
          iterations += 1;
        },
        onOutput: (output) => {
          if (output.compacted) {
            this.#memory.dropBeforeLatestCompaction();
            compacted = true;
          }
          if (output.inputTokens !== undefined) inputTokens = output.inputTokens;
          outputText = output.outputText;
        },
        onError: (reason) => {
          error = reason;
        },
        // Only a developer run advances its rollback point: each answered act
        // is checkpointed and the mark moves past it, so a later failure returns
        // the memory to the last paired state and never to before an act that
        // already happened. An observation turn still rolls back whole, so the
        // deltas it read are read again next time rather than skipped.
        advanceMark: async () => {
          if (!run) return;
          if (!(await this.#checkpoint(run.generationId))) run.checkpointFailed = true;
          mark = this.#memory.mark();
        },
        revoked,
        revocation,
      });
    } catch (loopError) {
      // A client or performer that threw instead of answering: the turn fails
      // like one whose model failed, and rolls back to the last paired state.
      error = loopError instanceof Error ? loopError.name : "unknown error";
      failure = revoked() ? revocation() : { outcome: TURN_OUTCOME.FAILED };
    }

    if (failure) {
      this.#memory.rollback(mark);
      this.#report(`Brain ${plan.trigger} turn did not complete: ${error}`);
    } else {
      this.#memory.retainCursors(this.#options.roster().identities);
      const generationId = run?.generationId ?? this.#generationId;
      const written = generationId !== undefined && (await this.#checkpoint(generationId));
      if (!written && run) run.checkpointFailed = true;
      for (const delivery of deliveries) {
        try {
          await this.#options.deliver(delivery);
        } catch (deliverError) {
          this.#report(
            `Brain briefing could not be delivered: ${deliverError instanceof Error ? deliverError.name : "unknown error"}`,
          );
        }
      }
    }

    this.#options.trace?.({
      trigger: plan.trigger,
      authority: plan.authority,
      inputItemKinds: appendedKinds,
      ...(inputTokens !== undefined ? { inputTokens } : undefined),
      transcriptBytes,
      toolCalls,
      ...(outputText ? { outputText } : undefined),
      deliveries: deliveries.map((delivery) => ({ briefingChars: delivery.briefing.length })),
      ...(this.#options.client.model ? { model: this.#options.client.model } : undefined),
      elapsedMs: this.#now() - startedAt,
      iterations,
      compacted,
      ...(error ? { error } : undefined),
    });

    return failure ?? { outcome: TURN_OUTCOME.DONE, text: outputText };
  }

  /** The model loop: answers a failure to roll back to, or nothing when the turn reached its text. */
  async #loop(
    plan: TurnPlan,
    execution: BrainActExecution,
    hooks: LoopHooks,
  ): Promise<TurnResult | undefined> {
    let iterations = 0;
    for (;;) {
      const roster = this.#options.roster();
      const context = standingContextItem(
        roster.text,
        this.#options.standingContext(),
        this.#now(),
      );
      const answer = await this.#options.client.respond([...this.#memory.items(), context], {
        authority: plan.authority,
        maximumOutputTokens: this.#maximumOutputTokens,
        ...(plan.run ? { signal: plan.run.abort.signal } : undefined),
      });
      if (hooks.revoked()) return hooks.revocation();
      if (answer.outcome === BRAIN_CLIENT_OUTCOME.QUIET) {
        hooks.onError("quiet");
        return { outcome: TURN_OUTCOME.QUIET, until: answer.until };
      }
      if (answer.outcome === BRAIN_CLIENT_OUTCOME.FAILED) {
        hooks.onError(answer.reason);
        return { outcome: TURN_OUTCOME.FAILED };
      }
      const output = brainResponsesOutput(answer.payload);
      if (!output) {
        hooks.onError("response carried no output");
        return { outcome: TURN_OUTCOME.FAILED };
      }
      hooks.append(output.items);
      hooks.onOutput(output);
      if (output.functionCalls.length === 0) {
        if (output.incompleteReason && !output.outputText) {
          hooks.onError(`${output.status ?? "incomplete"}: ${output.incompleteReason}`);
        }
        return undefined;
      }

      iterations += 1;
      hooks.onIteration();
      if (iterations > this.#maxToolIterations) {
        // Every call still gets its output so the memory never holds a
        // dangling function_call; the model reads the refusals next turn.
        hooks.append(
          output.functionCalls.map((call) => {
            hooks.toolCalls.push({
              name: call.name,
              argumentsChars: call.argumentsJson.length,
              outcomeStatus: ACT_RESULT_STATUS.REJECTED,
            });
            return functionCallOutputItem(
              call.callId,
              JSON.stringify(rejection(REFUSAL_REASON.BUDGET_SPENT)),
            );
          }),
        );
        hooks.onError("tool iteration budget spent");
        await hooks.advanceMark();
        return undefined;
      }

      // Calls run in the order the model emitted them, one at a time: an act
      // is journaled and checkpointed before the next one starts, and a
      // cancel landing between two refuses the second rather than racing it.
      for (const call of output.functionCalls) {
        const outcome = await this.#dispatch(call, roster, plan, execution, hooks.deliveries);
        hooks.toolCalls.push({
          name: call.name,
          argumentsChars: call.argumentsJson.length,
          outcomeStatus: text(outcome.output.status) ?? "answered",
        });
        hooks.append([functionCallOutputItem(outcome.callId, JSON.stringify(outcome.output))]);
        if (plan.run && this.#journal.get(plan.run.runId, call.callId)) await hooks.advanceMark();
      }
      await hooks.advanceMark();
      if (hooks.revoked()) return hooks.revocation();
    }
  }

  /**
   * Reads what each woken session's transcript gained since the brain last
   * looked, once per session however many events name it, and moves the
   * cursor. The cursor moves with the memory: a turn that fails rolls both
   * back, so the same delta is read again rather than skipped.
   */
  async #attachDeltas(
    events: readonly BrainWakeEvent[],
  ): Promise<{ events: readonly BrainWakeEvent[]; transcriptBytes: number }> {
    const read = new IdentitySet();
    let transcriptBytes = 0;
    const attached: BrainWakeEvent[] = [];
    for (const event of events) {
      if (read.list().some((identity) => sameIdentity(identity, event.identity))) {
        attached.push({ ...event });
        continue;
      }
      read.add(event.identity);
      const delta = await this.#readDelta(event.identity);
      transcriptBytes += delta.text.length;
      attached.push({ ...event, transcriptDelta: delta });
    }
    return { events: attached, transcriptBytes };
  }

  async #readDelta(identity: SessionIdentity): Promise<BrainTranscriptDelta> {
    let result: ProviderTranscriptSinceResult;
    try {
      result = await this.#options.readTranscriptSince(identity, this.#memory.cursor(identity));
    } catch {
      return { text: "", truncated: false, status: ACT_RESULT_STATUS.REJECTED };
    }
    if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
      return { text: "", truncated: false, status: result.status };
    }
    if (result.cursor !== undefined) this.#memory.setCursor(identity, result.cursor);
    const bounded = cutFront(result.text, this.#deltaPerSessionChars);
    return {
      text: bounded.text,
      truncated: result.truncated || bounded.cut,
      status: ACT_RESULT_STATUS.ACCEPTED,
    };
  }

  /**
   * The gate every emitted call meets, whatever the model was offered: a tool
   * outside the turn's authority is refused here before any performer or
   * delivery sees it, so a model that emits an omitted tool — because a
   * transcript, a standing ask, or a tool's answer read like an instruction —
   * changes nothing but the refusal it reads back.
   */
  #refusalForAuthority(plan: TurnPlan, name: string): WireRecord | undefined {
    if (brainToolAllowed(plan.authority, name)) return undefined;
    if (name === BRAIN_TOOL.ANNOUNCE) return rejection(REFUSAL_REASON.ANNOUNCE_IN_ASK);
    if (plan.authority === BRAIN_TURN_AUTHORITY.OBSERVATION && !isBrainOnlyTool(name)) {
      return rejection(REFUSAL_REASON.ACT_IN_OBSERVATION);
    }
    return rejection(REFUSAL_REASON.NOT_OFFERED);
  }

  async #dispatch(
    call: BrainFunctionCall,
    roster: BrainRoster,
    plan: TurnPlan,
    execution: BrainActExecution,
    deliveries: BrainDelivery[],
  ): Promise<DispatchOutcome> {
    const refused = this.#refusalForAuthority(plan, call.name);
    if (refused) return { callId: call.callId, output: refused };

    const args = parsedRecord(call.argumentsJson);
    const observed = (identity: SessionIdentity) =>
      roster.identities.some((listed) => sameIdentity(listed, identity));
    const named = identityFromRecord(args);

    if (!isBrainOnlyTool(call.name)) {
      if (plan.authority !== BRAIN_TURN_AUTHORITY.DEVELOPER || !plan.run) {
        return { callId: call.callId, output: rejection(REFUSAL_REASON.ACT_IN_OBSERVATION) };
      }
      return {
        callId: call.callId,
        output: await this.#performJournaled(call, plan.run, execution),
      };
    }

    switch (call.name) {
      case BRAIN_TOOL.LIST_SESSIONS:
        return { callId: call.callId, output: { roster: this.#options.roster().text } };
      case BRAIN_TOOL.READ_TRANSCRIPT: {
        if (!named || !observed(named)) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.UNOBSERVED_SESSION) };
        }
        if (plan.run && this.#runRevoked(plan.run)) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.RUN_REVOKED) };
        }
        return { callId: call.callId, output: await this.#readWhole(named) };
      }
      case BRAIN_TOOL.ANNOUNCE: {
        if (plan.deliverySource === undefined) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.NOT_OFFERED) };
        }
        const briefing = text(args.briefing)?.slice(0, maximumBriefingLength);
        if (!briefing) {
          return { callId: call.callId, output: rejection(REFUSAL_REASON.EMPTY_BRIEFING) };
        }
        deliveries.push({ briefing, decidedAt: this.#now(), source: plan.deliverySource });
        return { callId: call.callId, output: { status: ACT_RESULT_STATUS.ACCEPTED } };
      }
    }
  }

  /**
   * One act through the journal. A call id the run already answered gets its
   * recorded result back rather than a second effect — or the honest unknown,
   * when the act started and its result was lost — and the same id with other
   * arguments is refused rather than guessed at. A fresh call is written as
   * started and checkpointed before the performer sees it, so a crash mid-act
   * is found as an act of unknown result and never replayed; a checkpoint
   * that will not land refuses the act instead, because an act nobody could
   * find afterwards is one the developer could not account for.
   */
  async #performJournaled(
    call: BrainFunctionCall,
    run: RunControl,
    execution: BrainActExecution,
  ): Promise<WireRecord> {
    if (this.#runRevoked(run)) return rejection(REFUSAL_REASON.RUN_REVOKED);
    const recorded = this.#journal.get(run.runId, call.callId);
    if (recorded) {
      if (recorded.argumentsJson !== call.argumentsJson) {
        return rejection(REFUSAL_REASON.CALL_ID_REUSED);
      }
      return recorded.outputJson === undefined
        ? { ...UNKNOWN_ACT_RESULT }
        : parsedRecord(recorded.outputJson);
    }
    if (run.checkpointFailed) return rejection(REFUSAL_REASON.NOT_CHECKPOINTED);
    this.#journal.start({
      runId: run.runId,
      callId: call.callId,
      name: call.name,
      argumentsJson: call.argumentsJson,
      startedAt: this.#now(),
    });
    if (!(await this.#checkpoint(run.generationId))) {
      this.#journal.forget(run.runId, call.callId);
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
      output = rejection(REFUSAL_REASON.ACT_FAILED);
    }
    if (output.status === ACT_RESULT_STATUS.ACCEPTED) run.performedActs += 1;
    this.#journal.settle(run.runId, call.callId, JSON.stringify(output), this.#now());
    return output;
  }

  async #readWhole(identity: SessionIdentity): Promise<WireRecord> {
    let result: ProviderTranscriptResult;
    try {
      result = await this.#options.readTranscript(identity);
    } catch {
      return rejection(REFUSAL_REASON.READ_FAILED);
    }
    if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
      return { status: result.status, reason: result.reason };
    }
    const bounded = cutFront(result.transcript, this.#fullTranscriptChars);
    return {
      status: ACT_RESULT_STATUS.ACCEPTED,
      truncated: bounded.cut,
      transcript: bounded.text,
    };
  }
}
