import { HOSTED_BRAIN_OPTION_BOUNDS } from "@sidecar/hosted";
import {
  failedHousekeeping,
  housekeepingCompleted,
  MEMORY_FLUSH_DEFAULTS,
  type MemoryHousekeepingResult,
  shouldRunMemoryFlush,
} from "@sidecar/memory";
import type { ScheduledTimer } from "@sidecar/realtime";
import {
  type ChildEnd,
  type ChildPolicyContext,
  type EffectiveToolPolicy,
  PendingInputQueue,
  QUEUE_DEFAULTS,
  QUEUE_MODE,
  type QueueBatch,
  type QueuedInput,
  type QueueMode,
  queueSummaryLine,
  queueSummaryText,
} from "@sidecar/runtime";
import {
  type AgentRuntime,
  CHILD_RUN_STATUS,
  type ChildCompletionRecord,
  type ChildRunRecord,
  CONTEXT_INPUT_KIND,
  type ContextMark,
  type ReasoningEffort,
  RUN_END_REASON,
  RUN_ORIGIN,
  RUNTIME_EVENT,
  type RuntimeEvent,
  type RuntimeRun,
  type RuntimeRunEnd,
} from "@sidecar/runtime-contracts";
import {
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionIdentity,
} from "@sidecar/session";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import {
  assessCompaction,
  COMPACTION_NEED,
  type CompactionAssessment,
  reserveTokens,
} from "./compaction.js";
import type { TranscriptCursors } from "./cursors.js";
import {
  CONTEXT_OPENING,
  claimOpenedContext,
  type Generation,
  generationFrom,
  retireContext,
  retireOpenedContext,
  sameIdentity,
} from "./generation.js";
import {
  activityNoticesInputText,
  askInputText,
  childCompletionInputText,
  heartbeatInputText,
  holdReleasedInputText,
  primedNotesInputText,
  standingContextText,
  subagentTaskInputText,
  wakeInputText,
} from "./input-items.js";
import { journalActCounts, UNKNOWN_ACT_RESULT } from "./journal.js";
import {
  BrainRequestLedger,
  INBOX_CAPACITY,
  PENDING_MARK_FIELD,
  type PendingMarkField,
  type RunEnd,
  SAVE_SCOPE,
} from "./ledger.js";
import {
  type BrainObservationEntry,
  entryFromEvent,
  eventFromEntry,
  sameObservation,
} from "./observation-inbox.js";
import type { BrainActExecution, BrainActPerformer, BrainRoster } from "./performer.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestRecord,
  type BrainSubmission,
  type BrainSubmissionResult,
  interruptedUnfinishedRequests,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import { incompleteDetail, TOOL_RESULT_STATUS } from "./runtime.js";
import { claimedUnlessAborted, type Settled, settledUnlessAborted } from "./settled.js";
import {
  type BrainPersistedState,
  type BrainStateStore,
  type BrainStoreLease,
  brainGenerationExpired,
} from "./state-store.js";
import { SteeredDeliveries } from "./steered-deliveries.js";
import {
  type BrainChildAccess,
  type BrainMemoryAccess,
  type BrainWorkspaceAccess,
  createTurnToolExecutor,
  journaledEffect,
} from "./tool-executor.js";
import { brainToolCatalog, brainToolSchemas, resolveTurnToolPolicy } from "./tools.js";
import type { BrainToolCallTrace, BrainTurnTraceRecord } from "./trace.js";
import {
  attachTranscriptDeltas,
  readTranscriptDelta,
  readWholeTranscript,
  type TranscriptDeltasAttached,
} from "./transcript-reads.js";
import {
  BRAIN_TURN_KIND,
  BRAIN_TURN_TRIGGER,
  type BrainTurnDescription,
  type BrainTurnPreparation,
  type BrainTurnTrigger,
  REPORTED_OUTCOMES,
  type RunControl,
  runOriginOf,
  TURN_OUTCOME,
  type TurnContext,
  type TurnPlan,
  type TurnResult,
} from "./turn.js";
import {
  BRAIN_WAKE_KIND,
  type BrainDelivery,
  type BrainTranscriptDelta,
  type BrainTurnNotice,
  type BrainTurnReport,
  type BrainWakeEvent,
} from "./wake-events.js";
import { WakeQueue } from "./wake-queue.js";

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
 * one. What a turn may call is the effective tool policy's decision, prepared
 * before the model reads a word: the same policy fixes the schemas the model
 * is offered and the gate every emitted call meets, so nothing the model
 * reads can widen either. Who opened the turn — the developer's ask, a wake,
 * a roster look, a hold release — is recorded as its origin, and an act taken
 * in a turn the developer did not open is journaled and narrated as Luke's
 * own rather than as anything the developer asked for.
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
  MAXIMUM_OUTPUT_TOKENS: HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS,
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
  /**
   * The most wakes held for one turn; past it the oldest go, since the delta
   * read covers what they said. The wake buffer is not the ask queue, whose
   * capacity and overflow are the port's own.
   */
  PENDING_WAKE_CAPACITY: 20,
} as const;

/**
 * Which sessions a conversation's own roster look reads. It is a fact of the
 * conversation, fixed when its agent is built: an observed conversation names
 * its one session and can read no other's transcript, main's ordinary
 * conversation reads none on a look at all, and the whole local roster is
 * what a conversation with no host to narrow it reads.
 */
export const LOOK_SUBJECT = {
  ROSTER: "roster",
  NONE: "none",
  SESSION: "session",
} as const;

export type LookSubjectKind = (typeof LOOK_SUBJECT)[keyof typeof LOOK_SUBJECT];

export type LookSubject =
  | { readonly kind: typeof LOOK_SUBJECT.ROSTER }
  | { readonly kind: typeof LOOK_SUBJECT.NONE }
  | { readonly kind: typeof LOOK_SUBJECT.SESSION; readonly identity: SessionIdentity };

/** Runs a turn's work under the host's lane for its trigger, so conversations share the lanes' budgets and nothing wider. */
export type BrainLane = <T>(trigger: BrainTurnTrigger, work: () => Promise<T>) => Promise<T>;

/**
 * Words the host owes this conversation's next turn — the compact notices of
 * what sibling conversations did — taken when a turn opens and handed back
 * when that turn fails, so nothing is consumed by a turn that never ran.
 */
export interface BrainOpeningNotes {
  take(): readonly BrainTurnNotice[];
  restore(notes: readonly BrainTurnNotice[]): void;
}

/**
 * What a run's end is read from: the flags its own execution set and the
 * generation it ran in. A rider's end is the primary's flags with its own
 * record, so nothing has to fabricate a control to reuse the reading.
 */
type RunEndFlags = Pick<
  RunControl,
  "generation" | "cancelled" | "timedOut" | "checkpointFailed" | "compactionFailed"
>;

/** How a run ended, as its record takes it: the status and what rides beside it. */
/** What a turn came to and the run it ran under, read by the settlement that follows every exit. */
interface OpenedTurn {
  result: TurnResult;
  run: RunControl | undefined;
}

interface RunOutcome {
  status: BrainRequestRecord["status"];
  end: RunEnd;
}

export interface BrainAgentOptions {
  /** The execution the host runs turns on; it decides how a model and its tools loop, and it alone reaches the model. */
  runtime: AgentRuntime;
  acts: BrainActPerformer;
  roster: () => BrainRoster;
  /** Everything the host renders beside the roster: projects, facts, recent conversation, guide. */
  standingContext: () => string;
  /**
   * Prepares a turn: the prompt it runs under and the configured policy
   * layers that fix its tools, which the agent resolves once over the
   * catalog with the turn's own layer added. A host builds the prompt from
   * its configuration and the agent's workspace; there is no prompt without
   * one.
   */
  prepareTurn: (turn: BrainTurnDescription) => BrainTurnPreparation | Promise<BrainTurnPreparation>;
  /** The agent's own workspace files and skills, for the workspace tools; absent means those tools refuse. */
  workspace?: BrainWorkspaceAccess;
  /**
   * Words to prime a conversation that just started fresh with — the recent
   * daily notes, rendered — read once, when the first turn of an empty
   * context opens, and never on an ordinary turn.
   */
  primeFreshContext?: () => Promise<string | undefined>;
  /**
   * The memory lifecycle hook run before a compaction: handed a private copy
   * of the context and the counts the flush gate read, once per compaction
   * cycle, a soft margin before the context would fold or once the retained
   * transcript crosses the byte trigger. What it writes stands whatever it
   * answers; only an answer that says it ran to its end marks the cycle
   * flushed, so an interrupted flush runs again at the next assessment.
   */
  beforeCompaction?: (input: BrainFlushInput) => Promise<MemoryHousekeepingResult>;
  /**
   * Where the flush marker outlives this process: read once per generation
   * before the first assessment, written after each completed flush, keyed
   * by the generation so a marker from an earlier lifetime is never read as
   * this cycle's. Absent, the marker stands in memory alone.
   */
  flushMarker?: BrainFlushMarkerStore;
  readTranscriptSince: (
    identity: SessionIdentity,
    cursor: string | undefined,
  ) => Promise<ProviderTranscriptSinceResult>;
  readTranscript: (identity: SessionIdentity) => Promise<ProviderTranscriptResult>;
  deliver: (delivery: BrainDelivery) => void | Promise<void>;
  /** Hears what each observation, hold-release, or heartbeat turn amounted to, in the host's own counts. */
  notice?: (report: BrainTurnReport) => void;
  /** The lane each turn runs under; absent, turns are bounded only by this conversation's own serial queue. */
  lane?: BrainLane;
  openingNotes?: BrainOpeningNotes;
  /**
   * Which sessions this conversation's roster look reads, so two
   * conversations never read each other's transcript. Absent, the look reads
   * every local session that is working, waiting, or read before.
   */
  observes?: LookSubject;
  /** How an ask arriving while a turn is under way is taken; steer by default, as OpenClaw has it. */
  queueMode?: QueueMode;
  /** How long collect mode waits for more asks before opening one turn for them all. */
  queueDebounceMs?: number;
  /**
   * Set when this conversation is a child's: how deep it is. Every turn is
   * then prepared as a child's — the minimal profile, the child restriction
   * on top of the configured layers — and a spawn from it counts one deeper.
   */
  child?: ChildPolicyContext;
  /** Delegation, supplied by the host that owns the conversations; absent, the session tools refuse. */
  children?: BrainChildAccess;
  /** The notebook's search and read, supplied by the host that owns the index; absent, the memory tools refuse. */
  memory?: BrainMemoryAccess;
  /**
   * The requester's active context a forked child starts over, adopted
   * whole into this conversation's empty context on its first turn and
   * recorded as a fork boundary; never read once the context holds anything.
   */
  inheritedContext?: readonly WireRecord[];
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

/** What the pre-compaction flush is handed: a copy of the context, never the engine itself, and the counts its gate read. */
export interface BrainFlushInput {
  readonly items: readonly WireRecord[];
  readonly contextTokens: number;
  readonly contextWindowTokens: number;
  readonly transcriptBytes: number;
  readonly compactionCount: number;
  readonly signal: AbortSignal;
}

/** Where a conversation stands in its compaction cycles, and the cycle its last completed flush ran under. */
export interface BrainFlushCycle {
  readonly compactionCount: number;
  readonly lastFlushCompactionCount?: number;
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

export type { BrainWorkspaceAccess } from "./tool-executor.js";

/** A run's live controls as every run starts: nothing revoked, nothing failed, nothing yet done. */
function newRunControl(runId: string, generation: Generation, recorded: boolean): RunControl {
  return {
    runId,
    generation,
    recorded,
    abort: new AbortController(),
    cancelled: false,
    timedOut: false,
    checkpointFailed: false,
    performedActs: 0,
    unknownActs: 0,
  };
}

/** Whether a completion reached this conversation, and how. */
export interface BrainCompletionDelivery {
  readonly delivered: boolean;
  readonly reason?: string;
}

/** The execution under way: for an ask to steer into or interrupt, and for a steered delivery to be answered through its plan's deliveries. */
interface ActiveExecution {
  run: RunControl;
  started: RuntimeRun;
  plan: TurnPlan;
  /** The asks riding inside the run, settled with its end. */
  riders: RunControl[];
}

/** What one turn gathers as it runs, for its trace and its deliveries. */
interface TurnGathering {
  toolCalls: BrainToolCallTrace[];
  deliveries: BrainDelivery[];
  iterations: number;
  compacted: boolean;
  inputTokens?: number;
  outputText: string;
  /** The final answer's shortfall, when it stopped short with words still delivered. */
  incomplete?: string;
  error?: string;
}

/** A pending submission, held so a retry of the same id awaits the same durable answer. */
interface PendingSubmission {
  question: string;
  origin: BrainSubmission["origin"];
  result: Promise<BrainSubmissionResult>;
}

export type BrainRequestsListener = (records: readonly BrainRequestRecord[]) => void;

/**
 * One ask as its turn reads it: the run that records it and the words the
 * model is shown for it, its question or, once the overflow folded it, the
 * one summary line the queue cut it to.
 */
interface AskInput {
  readonly run: RunControl;
  readonly text: string;
  readonly folded: boolean;
}

/** The question one turn opens with for the asks that opened it: the overflow's summary first, then each ask's words. */
function askQuestion(opened: readonly AskInput[]): string {
  const summaryLines = opened.filter((input) => input.folded).map((input) => input.text);
  const summary = queueSummaryText({
    entries: [],
    summaryLines,
    summarizedCount: summaryLines.length,
  });
  return [
    ...(summary === undefined ? [] : [summary]),
    ...opened.filter((input) => !input.folded).map((input) => input.text),
  ].join("\n\n");
}

export class BrainAgent {
  readonly #options: BrainAgentOptions;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  readonly #report: (message: string) => void;
  readonly #prepareTurn: (
    turn: BrainTurnDescription,
  ) => BrainTurnPreparation | Promise<BrainTurnPreparation>;
  readonly #maximumOutputTokens: number;
  readonly #wakeCoalesceMs: number;
  readonly #executionDeadlineMs: number;
  readonly #deltaPerSessionChars: number;
  readonly #fullTranscriptChars: number;
  #generation: Generation | undefined;
  readonly #lease: BrainStoreLease;
  readonly #ledger: BrainRequestLedger;
  readonly #runs = new Map<string, RunControl>();
  readonly #pendingSubmissions = new Map<string, PendingSubmission>();
  readonly #listeners = new Set<BrainRequestsListener>();
  #turnInFlight = false;
  /** The execution under way, for an ask to steer into or interrupt, and the asks riding inside it. */
  #active: ActiveExecution | undefined;
  /** Where an ask that arrives while this conversation is busy waits, under the queue's own mode and bounds. */
  readonly #asks: PendingInputQueue;
  /**
   * Asks the overflow folded into a summary line: their words reach the model
   * as that line, and their records settle with the turn that carries it.
   */
  #summarized: AskInput[] = [];
  readonly #subject: LookSubject;
  /**
   * Each session as it last looked when an observation was captured, for the
   * unchanged-look suppression. Held in memory alone: the first look after a
   * launch is captured even with no transcript gained, because a status that
   * changed while Luke was closed is still a change worth one look.
   */
  readonly #lastLook = new BySession<string>();
  /** Captures run one after another, so two reads of one session never race each other's cursor. */
  #capturing: Promise<unknown> = Promise.resolve();
  #capturesInFlight = 0;
  #turnsQueued = 0;
  /** The review's retry, armed while the model is quiet and the scheduler's occurrence already taken. */
  #heartbeatRetry: ScheduledTimer | undefined;
  #restored: Promise<void> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #wakes: WakeQueue;
  #stopped = false;
  #unsubscribeStore: (() => void) | undefined;
  #incompatibleReported: string | undefined;
  /** The optional compaction queued after the last turn; a new ask, a stop, or a replacement cancels it. */
  #maintenance: AbortController | undefined;
  /** Completions this conversation has taken, by their stable id, so a retried delivery is one item. */
  readonly #deliveredCompletions = new Set<string>();
  /** Deliveries still being decided, by completion id, so a retry that arrives meanwhile joins rather than repeats. */
  readonly #pendingCompletions = new Map<string, Promise<BrainCompletionDelivery>>();

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
    this.#prepareTurn = options.prepareTurn;
    this.#maximumOutputTokens = options.maximumOutputTokens ?? BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS;
    this.#wakeCoalesceMs = options.wakeCoalesceMs ?? BRAIN_DEFAULTS.WAKE_COALESCE_MS;
    this.#executionDeadlineMs = options.executionDeadlineMs ?? BRAIN_DEFAULTS.EXECUTION_DEADLINE_MS;
    this.#deltaPerSessionChars =
      options.deltaPerSessionChars ?? BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS;
    this.#fullTranscriptChars = options.fullTranscriptChars ?? BRAIN_DEFAULTS.FULL_TRANSCRIPT_CHARS;
    this.#subject = options.observes ?? { kind: LOOK_SUBJECT.ROSTER };
    this.#lease = options.store.lease();
    this.#ledger = new BrainRequestLedger({
      store: options.store,
      lease: this.#lease,
      now: this.#now,
      report: this.#report,
      notify: () => this.#notify(),
    });
    this.#wakes = new WakeQueue({
      coalesceMs: this.#wakeCoalesceMs,
      capacity: BRAIN_DEFAULTS.PENDING_WAKE_CAPACITY,
      now: this.#now,
      schedule: this.#schedule,
      cancel: this.#cancel,
      quietUntil: () => this.#options.runtime.quietUntil(),
      flush: (events) => this.#flushWakes(events),
    });
    this.#asks = new PendingInputQueue({
      settings: {
        mode: options.queueMode ?? QUEUE_DEFAULTS.MODE,
        debounceMs: options.queueDebounceMs ?? QUEUE_DEFAULTS.DEBOUNCE_MS,
      },
      steer: (input) => this.#steerAsk(input),
      interrupt: () => this.#interruptActive(),
      flush: (batches) => this.#openBatches(batches),
      schedule: this.#schedule,
      cancel: this.#cancel,
    });
    this.#unsubscribeStore = options.store.onReplaced((state) => this.#adoptGeneration(state));
  }

  /** The store lease this agent writes under, for a host to check who owns the store. */
  get lease(): BrainStoreLease {
    return this.#lease;
  }

  /** How many captured observations are waiting for a turn to consume them. */
  pendingWakes(): number {
    return this.#generation?.inbox.length ?? this.#wakes.size();
  }

  /**
   * Whether anything is under way or owed: a turn running or queued, a
   * capture still landing, an observation captured and not yet consumed, or
   * an ask waiting in the queue. A host stands a conversation down only when
   * this answers false, so an analysis in flight is never cut mid-thought
   * because its session left the roster.
   */
  busy(): boolean {
    return (
      this.#turnInFlight ||
      this.#turnsQueued > 0 ||
      this.#capturesInFlight > 0 ||
      this.#active !== undefined ||
      this.#asks.size > 0 ||
      (this.#generation?.inbox.length ?? 0) > 0 ||
      this.#wakes.size() > 0
    );
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
    const opened = await generation.opened;
    return opened.kind === CONTEXT_OPENING.INCOMPATIBLE ? opened.reason : undefined;
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
    // The generation's context is awaited before the pending checks below, so
    // that from the check to the registration nothing is awaited and two
    // retries of one id cannot both slip past each other into two runs.
    const opened = await generation.opened;
    if (generation !== this.#generation || this.#stopped) {
      return {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
      };
    }
    if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      // The memory stands, whole, and nothing runs over it: an ask into it
      // would be a run this runtime cannot give a context to.
      this.#reportIncompatible(generation, opened.reason);
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
    this.#cancelMaintenance();
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
    const written = await this.#ledger.save(generation, {
      kind: SAVE_SCOPE.RECORD,
      runId: record.runId,
      changes: {},
      insert: record,
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
      await this.#ledger.settleRun(generation, record.runId, BRAIN_REQUEST_STATUS.INTERRUPTED, {});
      return accepted;
    }
    const run = newRunControl(record.runId, generation, true);
    this.#runs.set(run.runId, run);
    this.#admitAsk(run, submission.question);
    return accepted;
  }

  /**
   * Where an accepted ask goes. An idle conversation opens it at once: the
   * queue exists for a conversation that is busy, and a debounce on an idle
   * one is only delay — except in collect mode, whose window is its whole
   * contract. Everything else is admitted to the ported queue, which decides
   * under its mode whether the words steer into the execution under way,
   * interrupt it, or wait for a turn of their own, and under its bounds what
   * the overflow folds into a summary.
   */
  #admitAsk(run: RunControl, question: string): void {
    const mode = this.#asks.settings.mode;
    if (!this.#active && this.#asks.size === 0 && mode !== QUEUE_MODE.COLLECT) {
      this.#openAsks([{ run, text: question, folded: false }]);
      return;
    }
    const held = this.#asks.state.entries;
    const admitted = this.#asks.push({ id: run.runId, text: question, atMs: this.#now() });
    this.#foldEvicted(held);
    if (!admitted && !held.some((entry) => entry.id === run.runId)) {
      // The overflow refused these words outright: no turn will carry them,
      // and the record ends here rather than waiting for one that never opens.
      void this.#settleWaiting([run]);
    }
  }

  /**
   * Moves the runs the overflow just let go of out of the queue's accounting
   * and into this agent's: one folded into a summary rides the next drained
   * turn as a rider, and one dropped outright settles now, because nothing
   * will carry its words.
   */
  #foldEvicted(held: readonly QueuedInput[]): void {
    const state = this.#asks.state;
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
    if (dropped.length > 0) void this.#settleWaiting(dropped);
  }

  /** Hands an ask to the execution under way at its next model boundary; answers whether it took them. */
  #steerAsk(input: QueuedInput): boolean {
    const active = this.#active;
    const run = this.#runs.get(input.id);
    if (!active || !run || this.#runRevoked(active.run)) return false;
    // Only another ask's turn can take the words: a heartbeat, a wake, or a
    // hold's release runs under its own prompt and origin, and a reply
    // formed inside it would be that turn's, not the developer's answer. The
    // ask waits in the queue instead and opens its own turn when this one ends.
    if (active.plan.trigger !== BRAIN_TURN_TRIGGER.ASK) return false;
    const text = askInputText(input.text, [], this.#now());
    if (!active.started.steer({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text })) return false;
    active.riders.push(run);
    // The one place a rider is committed running: its words are in the model's
    // hands, and the run it rides is the run it ends with.
    void this.#ledger
      .commit(run.generation, run.runId, {
        status: BRAIN_REQUEST_STATUS.RUNNING,
        startedAt: this.#now(),
      })
      .then(() => this.#notify());
    return true;
  }

  /** Cancels the execution under way so the ask that interrupted it opens next. */
  #interruptActive(): void {
    const active = this.#active;
    if (!active || this.#runRevoked(active.run)) return;
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
      this.#openAsks([...inputs, ...riders]);
    }
  }

  /** Queues one turn for the asks given, the first that can open it standing as its run. */
  #openAsks(inputs: readonly AskInput[]): void {
    if (inputs.length === 0) return;
    // The ask's turn opens with the inbox as it stands, so the window a wake
    // armed has nothing left to open and is disarmed.
    this.#wakes.take();
    void this.#queueTurn(BRAIN_TURN_TRIGGER.ASK, () => this.#runAsk(inputs));
  }

  /**
   * Settles asks no turn will carry — the queue emptied by a Clear, a reset,
   * an expiry, or a stop, and anything the overflow dropped — as the run
   * itself says: cancelled when the developer cancelled it, interrupted when
   * this conversation's standing was taken away under it.
   */
  async #settleWaiting(runs: readonly RunControl[]): Promise<void> {
    // How each ask ends is read now, before anything is awaited: a generation
    // being replaced revokes every run it holds, and a blanket revocation is
    // not the developer's cancel.
    const ends = runs.map((run) => ({
      run,
      status: run.cancelled ? BRAIN_REQUEST_STATUS.CANCELLED : BRAIN_REQUEST_STATUS.INTERRUPTED,
    }));
    for (const { run, status } of ends) {
      this.#runs.delete(run.runId);
      await this.#ledger.settleRun(run.generation, run.runId, status, {});
    }
  }

  /** Everything waiting for a turn, queued or summarized, forgotten by the queue as it is taken. */
  #takeWaiting(): readonly RunControl[] {
    const waiting = [
      ...this.#asks.state.entries.flatMap((entry) => this.#runs.get(entry.id) ?? []),
      ...this.#summarized.splice(0).map((input) => input.run),
    ];
    this.#asks.clear();
    return waiting;
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
    const active = this.#active;
    const riding = run ? (active?.riders.indexOf(run) ?? -1) : -1;
    if (run && active && riding >= 0) {
      // An ask steered into another run has said its words to the model
      // already; what cancelling withdraws is its record's claim on that
      // run's reply, which it no longer waits for.
      active.riders.splice(riding, 1);
      this.#runs.delete(runId);
      await this.#ledger.settleRun(run.generation, runId, BRAIN_REQUEST_STATUS.CANCELLED, {});
      return this.request(runId);
    }
    if (record.status === BRAIN_REQUEST_STATUS.QUEUED && this.#generation) {
      // Words still waiting for a turn are withdrawn before any turn composes
      // its question from them; words already steered were said to the model
      // and cannot be unsaid. The record keeps the ask as accepted either way.
      if (!this.#asks.withdraw(runId)) {
        // The summarized list and the queue's summary are kept in one fold
        // order, so the ask's place in one is its place in the other.
        const folded = this.#summarized.findIndex((input) => input.run.runId === runId);
        if (folded >= 0) {
          this.#summarized.splice(folded, 1);
          this.#asks.withdrawSummarized(folded);
        }
      }
      await this.#ledger.settleRun(this.#generation, runId, BRAIN_REQUEST_STATUS.CANCELLED, {});
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
    return this.#mark(runId, PENDING_MARK_FIELD.HISTORY_RECORDED_AT, recordedAt);
  }

  /** Marks a run's own ask as written into the host's thread, on the same terms. */
  markAskRecorded(runId: string, recordedAt: number): Promise<boolean> {
    return this.#mark(runId, PENDING_MARK_FIELD.ASK_RECORDED_AT, recordedAt);
  }

  async #mark(runId: string, field: PendingMarkField, recordedAt: number): Promise<boolean> {
    await this.ready();
    const generation = this.#generation;
    return generation ? this.#ledger.mark(generation, runId, field, recordedAt) : false;
  }

  /**
   * Captures wake events into the durable inbox and arms the coalescing
   * window. Nothing is sent yet, and nothing opens until the capture has
   * landed: each session's transcript is read from its capture cursor, the
   * entry and the moved cursor are written in one save, and only then does
   * the window arm — so a turn is scheduled over input that already stands
   * on disk. Wakes inside the window open one turn together, and wakes
   * during a model's quiet wait for it to end rather than being dropped.
   * Settles once the capture has landed or been refused.
   */
  wake(events: readonly BrainWakeEvent[]): Promise<void> {
    if (this.#stopped || events.length === 0) return Promise.resolve();
    return this.#capture(events).then((captured) => {
      if (this.#stopped) return;
      const generation = this.#generation;
      if (!generation) return;
      if (captured > 0 || generation.inbox.length > 0) {
        this.#wakes.push(this.#inboxEvents(generation));
      }
    });
  }

  /**
   * The capture itself, one batch at a time. Each distinct session in the
   * batch is read once from its capture cursor; an event that names a hook
   * the inbox already holds — the same hook, session, and instant delivered
   * twice — is not captured again; a roster edge that gained nothing over a
   * session standing exactly as it last stood is not captured at all. What
   * remains is written with the advanced capture cursors in one save, and a
   * save the store refuses moves no cursor in memory either. Answers how many
   * entries were captured.
   */
  #capture(events: readonly BrainWakeEvent[]): Promise<number> {
    const work = async (): Promise<number> => {
      await this.ready();
      const generation = this.#generation;
      if (!generation || this.#stopped || generation.abort.signal.aborted) return 0;
      const fresh = events.filter(
        (event, index) =>
          !generation.inbox.some((entry) => sameObservation(entry, event)) &&
          !events.slice(0, index).some((earlier) => sameWake(earlier, event)),
      );
      if (fresh.length === 0) return 0;
      const mark = generation.captureCursors.persisted();
      const reads = new BySession<{
        delta: BrainTranscriptDelta | undefined;
        cursor: string | undefined;
      }>();
      const entries: BrainObservationEntry[] = [];
      const now = this.#now();
      for (const event of fresh) {
        let read = reads.get(event.identity);
        if (!read) {
          const delta = await readTranscriptDelta(event.identity, {
            cursors: generation.captureCursors,
            read: (identity, cursor) => this.#options.readTranscriptSince(identity, cursor),
            signal: generation.abort.signal,
            maximumChars: this.#deltaPerSessionChars,
          });
          if (!delta) {
            generation.captureCursors.rollback(mark);
            return 0;
          }
          read = { delta, cursor: generation.captureCursors.cursor(event.identity) };
          reads.set(event.identity, read);
        } else {
          // A second event for the same session in one batch carries no
          // second delta: the first read covers both.
          read = {
            delta: {
              text: "",
              truncated: false,
              status: read.delta?.status ?? ACT_RESULT_STATUS.ACCEPTED,
            },
            cursor: read.cursor,
          };
        }
        if (
          event.kind === BRAIN_WAKE_KIND.ROSTER &&
          !read.delta?.text &&
          this.#lastLook.get(event.identity) === lookFingerprint(event)
        ) {
          continue;
        }
        entries.push(
          entryFromEvent(event, this.#options.createRunId(), now, read.delta, read.cursor),
        );
      }
      if (entries.length === 0) {
        generation.captureCursors.rollback(mark);
        return 0;
      }
      const written = await this.#ledger.save(generation, { kind: SAVE_SCOPE.CAPTURE, entries });
      if (!written) {
        generation.captureCursors.rollback(mark);
        this.#report("Brain observation could not be captured");
        return 0;
      }
      for (const event of fresh) {
        if (event.kind === BRAIN_WAKE_KIND.ROSTER) {
          this.#lastLook.set(event.identity, lookFingerprint(event));
        }
      }
      return entries.length;
    };
    this.#capturesInFlight += 1;
    const settled = () => {
      this.#capturesInFlight -= 1;
    };
    const run = this.#capturing.then(work, work);
    this.#capturing = run.then(settled, settled);
    return run;
  }

  /**
   * The captured observations a turn opens with, oldest first and at most
   * the inbox's turn depth. What stands beyond it waits, whole, for the next
   * wake or look, which opens a turn whenever the inbox holds anything: the
   * store keeps every capture until a turn has consumed it.
   */
  #inboxEvents(generation: Generation): readonly BrainWakeEvent[] {
    return generation.inbox.slice(0, INBOX_CAPACITY).map(eventFromEntry);
  }

  /**
   * The scheduled review: a turn under the full prompt whose instructions are
   * the workspace's HEARTBEAT.md, opened on no signal at all. Pending
   * observations ride along. The ordinary outcome is a turn that briefs
   * nothing. Settles when the turn this occurrence opened has, so the
   * scheduler's tick is over when the work it started is, and a review the
   * quiet postponed settles at once with its retry armed rather than holding
   * the tick open for as long as the quiet lasts.
   */
  heartbeat(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    const generation = this.#generation;
    if (!generation) return this.ready().then(() => this.heartbeat());
    // The scheduler has recorded this occurrence as taken: a model that is
    // quiet now does not lose it, the review opens once the quiet ends.
    const quietUntil = this.#options.runtime.quietUntil();
    if (quietUntil !== undefined) {
      this.#retryHeartbeat(quietUntil);
      return Promise.resolve();
    }
    this.#cancelHeartbeatRetry();
    this.#wakes.take();
    return this.#queueTurn(BRAIN_TURN_TRIGGER.HEARTBEAT, async () => {
      const result = await this.#turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.HEARTBEAT,
        deliveries: new SteeredDeliveries(),
        events: this.#inboxEvents(generation),
        open: (attached, now) => [
          ...(attached.length > 0 ? [wakeInputText(attached, now)] : []),
          heartbeatInputText(now),
        ],
      });
      if (result.outcome === TURN_OUTCOME.QUIET && generation === this.#generation) {
        this.#retryHeartbeat(result.until);
      }
    });
  }

  /** Arms one retry of the review for when the quiet ends; a retry already armed stands. */
  #retryHeartbeat(until: number): void {
    if (this.#stopped || this.#heartbeatRetry !== undefined) return;
    this.#heartbeatRetry = this.#schedule(
      () => {
        this.#heartbeatRetry = undefined;
        void this.heartbeat();
      },
      Math.max(until - this.#now(), this.#wakeCoalesceMs),
    );
  }

  #cancelHeartbeatRetry(): void {
    if (this.#heartbeatRetry === undefined) return;
    this.#cancel(this.#heartbeatRetry);
    this.#heartbeatRetry = undefined;
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
    this.#wakes.take();
    void this.#queueTurn(BRAIN_TURN_TRIGGER.HOLD_RELEASED, () =>
      this.#turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED,
        deliveries: new SteeredDeliveries(),
        events: this.#inboxEvents(generation),
        open: (attached, now) => [
          ...(attached.length > 0 ? [wakeInputText(attached, now)] : []),
          holdReleasedInputText(held, now),
        ],
      }),
    );
  }

  /**
   * Runs a delegated task in this conversation, as the child it is: a
   * recorded run under the child origin, its submission id the child run's
   * id the requester's service minted, so the same child asked twice is one
   * run. Settles with the run's end, as the service takes it: a completed
   * run's final text is the result, an interrupted one — the run a relaunch
   * found unfinished — is the honest unknown with the acts its journal
   * established, and a run its generation forgot before it ended is the
   * same unknown, decided here rather than left to the requester to guess.
   */
  async runChildTask(
    task: string,
    childRunId: string,
  ): Promise<{ readonly runId: string; readonly done: Promise<ChildEnd> } | undefined> {
    const submitted = await this.submitAsk({
      submissionId: childRunId,
      question: task,
      origin: BRAIN_REQUEST_ORIGIN.CHILD,
    });
    if (submitted.outcome !== BRAIN_SUBMISSION_OUTCOME.ACCEPTED) return undefined;
    return { runId: submitted.runId, done: this.#childRunEnd(submitted.runId) };
  }

  /** A child run's end once it is terminal, or the unknown end of a run its generation forgot first. */
  async #childRunEnd(runId: string): Promise<ChildEnd> {
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
  async adoptChildRun(childRunId: string): Promise<ChildEnd | undefined> {
    await this.ready();
    const record = this.requests().find(
      (held) => held.submissionId === childRunId && held.origin === BRAIN_REQUEST_ORIGIN.CHILD,
    );
    if (!record) return undefined;
    return this.#childRunEnd(record.runId);
  }

  /**
   * Cancels the run named as a child's, by the child run id its requester's
   * service minted, and answers only once the run has actually ended: a
   * cancellation is reported landed when the record says so, never on the
   * strength of having asked, so a reset that waits on it waits on the truth.
   */
  async cancelChildRun(childRunId: string): Promise<boolean> {
    await this.ready();
    const record = this.requests().find((held) => held.submissionId === childRunId);
    if (!record) return true;
    const cancelled = await this.cancelAsk(record.runId);
    if (cancelled === undefined) return true;
    if (isTerminalBrainRequestStatus(cancelled.status)) return true;
    const settled = await this.#awaitTerminal(record.runId);
    return settled === undefined || isTerminalBrainRequestStatus(settled.status);
  }

  async #awaitTerminal(runId: string): Promise<BrainRequestRecord | undefined> {
    for (;;) {
      const record = await this.waitAsk(runId, BRAIN_DEFAULTS.ASK_WAIT_MS);
      if (!record || isTerminalBrainRequestStatus(record.status)) return record;
      if (this.#stopped) return this.request(runId);
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
  deliverChildCompletion(
    completion: ChildCompletionRecord,
    record: ChildRunRecord,
  ): Promise<BrainCompletionDelivery> {
    const pending = this.#pendingCompletions.get(completion.completionId);
    if (pending) return pending;
    const deciding = this.#deliverCompletion(completion, record).finally(() => {
      this.#pendingCompletions.delete(completion.completionId);
    });
    this.#pendingCompletions.set(completion.completionId, deciding);
    return deciding;
  }

  async #deliverCompletion(
    completion: ChildCompletionRecord,
    record: ChildRunRecord,
  ): Promise<BrainCompletionDelivery> {
    await this.ready();
    this.#expireIfDue();
    const generation = this.#generation;
    if (this.#stopped || !generation) return { delivered: false, reason: "no conversation stands" };
    if (this.#deliveredCompletions.has(completion.completionId)) return { delivered: true };
    const opened = await generation.opened;
    if (generation !== this.#generation || this.#stopped) {
      return { delivered: false, reason: "the conversation was replaced" };
    }
    if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      return { delivered: false, reason: "the conversation's memory cannot be run" };
    }
    const text = childCompletionInputText(completion, record, this.#now());
    const active = this.#active;
    if (
      active &&
      active.run.generation === generation &&
      !this.#runRevoked(active.run) &&
      active.started.steer({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text })
    ) {
      // Steered words are delivered when a checkpoint carries them, not when
      // the run took them: a run that ends before that has rolled them back,
      // and the asker retries against a context that never held them.
      const delivered = await active.plan.deliveries.steered();
      if (delivered) this.#deliveredCompletions.add(completion.completionId);
      return delivered
        ? { delivered: true }
        : {
            delivered: false,
            reason: "the run under way ended before its checkpoint carried the completion",
          };
    }
    const deliveries = new SteeredDeliveries();
    const result = await this.#queueTurn(BRAIN_TURN_TRIGGER.CHILD_COMPLETION, () =>
      this.#turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.CHILD_COMPLETION,
        events: this.#inboxEvents(generation),
        open: (attached, now) => [
          ...(attached.length > 0 ? [wakeInputText(attached, now)] : []),
          text,
        ],
        deliveries,
      }),
    );
    // Delivered is what the store holds, not how the turn ended: a turn that
    // failed after an act's checkpoint carried the completion has delivered
    // it, and a turn that answered but whose checkpoint the store refused has not.
    if (deliveries.openingPersisted) {
      this.#deliveredCompletions.add(completion.completionId);
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
    this.#cancelMaintenance();
    this.#wakes.clear();
    const waiting = this.#takeWaiting();
    this.#cancelHeartbeatRetry();
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
    await this.#settleWaiting(waiting);
    const generation = this.#generation;
    if (generation) {
      for (const record of this.requests()) {
        if (record.status === BRAIN_REQUEST_STATUS.QUEUED) {
          await this.#ledger.settleRun(
            generation,
            record.runId,
            BRAIN_REQUEST_STATUS.INTERRUPTED,
            {},
          );
        }
      }
    }
    await this.#queue;
    if (this.#generation) retireOpenedContext(this.#generation);
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
  rosterLook(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    const generation = this.#generation;
    if (!generation) return this.ready().then(() => this.rosterLook());
    const roster = this.#options.roster();
    const looks = this.#ownLooks(roster, generation.captureCursors, this.#now());
    // The look is captured before anything opens, like a hook: what each
    // session gained stands in the inbox with its cursor, and the turn that
    // follows — now, or the next one if the model is quiet or a turn is in
    // flight — consumes it from there.
    return this.#capture(looks).then((captured) => {
      if (this.#stopped || this.#turnInFlight || generation !== this.#generation) return;
      if (this.#options.runtime.quietUntil() !== undefined) return;
      // A conversation looking at everything still opens its look with no
      // events, as the scheduled roster look it is; one looking at its own
      // session opens nothing when nothing was captured and nothing waits.
      if (
        this.#subject.kind !== LOOK_SUBJECT.ROSTER &&
        captured === 0 &&
        generation.inbox.length === 0
      ) {
        return;
      }
      this.#wakes.take();
      void this.#queueTurn(BRAIN_TURN_TRIGGER.ROSTER, () =>
        this.#turn({
          generation,
          trigger: BRAIN_TURN_TRIGGER.ROSTER,
          deliveries: new SteeredDeliveries(),
          events: this.#inboxEvents(generation),
          open: (attached, openedAt) => [wakeInputText(attached, openedAt, roster.text)],
        }),
      );
    });
  }

  /**
   * The sessions this conversation's own look reads, by its subject: its one
   * observed session, every local session it has read before or that is live
   * now, or nothing at all. A session another conversation observes is never
   * among them, whatever the roster holds.
   */
  #ownLooks(
    roster: BrainRoster,
    cursors: TranscriptCursors,
    now: number,
  ): readonly BrainWakeEvent[] {
    const subject = this.#subject;
    if (subject.kind === LOOK_SUBJECT.NONE) return [];
    return (roster.sessions ?? []).flatMap((session) => {
      const identity: SessionIdentity = {
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      };
      if (subject.kind === LOOK_SUBJECT.SESSION && !sameIdentity(subject.identity, identity)) {
        return [];
      }
      const readBefore = cursors.cursor(identity) !== undefined;
      const live =
        session.status === SESSION_STATUS.WORKING || session.status === SESSION_STATUS.WAITING;
      if (session.location !== SESSION_LOCATION.LOCAL || !(readBefore || live)) return [];
      return [{ kind: BRAIN_WAKE_KIND.ROSTER, identity, session, atMs: now }];
    });
  }

  /** Queues a turn behind this conversation's own, and runs it under the host's lane for its trigger. */
  #queueTurn<T>(trigger: BrainTurnTrigger, work: () => Promise<T>): Promise<T> {
    const lane = this.#options.lane;
    return this.#enqueue(() => (lane ? lane(trigger, work) : work()));
  }

  /**
   * Opens the turn a flush of the wake queue asks for. A generation not yet
   * loaded sends the wakes back to wait for it; a turn that sent nothing
   * because the model was quiet sends them back too, to open together once
   * the quiet ends.
   */
  #flushWakes(events: readonly BrainWakeEvent[]): void {
    if (this.#stopped) return;
    const generation = this.#generation;
    if (!generation) {
      void this.ready().then(() => this.#wakes.requeue(events, 0));
      return;
    }
    void this.#queueTurn(BRAIN_TURN_TRIGGER.WAKE, async () => {
      // The turn opens with the inbox as it stands, not the wakes that armed
      // the window: a capture that landed since rides along, and one a
      // failed turn left standing is tried again.
      const inbox = this.#inboxEvents(generation);
      if (inbox.length === 0) return;
      const result = await this.#turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.WAKE,
        deliveries: new SteeredDeliveries(),
        events: inbox,
        open: (attached, now) => [wakeInputText(attached, now)],
      });
      if (
        result.outcome === TURN_OUTCOME.QUIET &&
        !this.#stopped &&
        generation === this.#generation
      ) {
        this.#wakes.requeue(inbox, this.#wakes.quietDelay(result.until));
      }
    });
  }

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.#turnsQueued += 1;
    const settled = () => {
      this.#turnsQueued -= 1;
    };
    const run = this.#queue.then(work, work);
    this.#queue = run.then(settled, settled);
    return run;
  }

  #notify(): void {
    const records = this.requests();
    for (const listener of [...this.#listeners]) listener(records);
  }

  #generationFrom(state: BrainPersistedState): Generation {
    return generationFrom(
      state,
      this.#options.runtime,
      JSON.stringify(UNKNOWN_ACT_RESULT),
      this.#now,
    );
  }

  #cancelMaintenance(): void {
    this.#maintenance?.abort();
    this.#maintenance = undefined;
  }

  /**
   * Queues the one optional maintenance a turn may leave behind: a compaction
   * of the context, decided against the window once the turn's reply is
   * persisted and its deliveries have settled. It runs behind every turn
   * already queued, under a signal a new ask cancels, so housekeeping never
   * delays the developer and never folds a context a new turn is reading.
   */
  #scheduleMaintenance(turnContext: TurnContext, countedTokens: number | undefined): void {
    this.#cancelMaintenance();
    const abort = new AbortController();
    this.#maintenance = abort;
    void this.#enqueue(() => this.#maintain(turnContext, countedTokens, abort));
  }

  async #maintain(
    turnContext: TurnContext,
    countedTokens: number | undefined,
    abort: AbortController,
  ): Promise<void> {
    const { generation, context } = turnContext;
    if (
      abort.signal.aborted ||
      this.#stopped ||
      generation !== this.#generation ||
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
    this.#turnInFlight = true;
    try {
      const prepared = await this.#prepareTurn({ kind: BRAIN_TURN_KIND.MAINTENANCE });
      if (signal.aborted || generation !== this.#generation) return;
      const compacted = await this.#compactIfNeeded(
        { generation, context, signal },
        prepared.prompt,
        countedTokens,
      );
      if (!compacted.ok) this.#report(`Brain compaction did not complete: ${compacted.reason}`);
    } finally {
      this.#turnInFlight = false;
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
  async #compactIfNeeded(
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
    if (!(await this.#ledger.checkpoint(turnContext))) {
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
      this.#report(
        `Memory flush did not complete (${settled.value.outcome}${settled.value.reason ? `: ${settled.value.reason}` : ""}); it runs again at the next assessment`,
      );
      return;
    }
    const marked = await this.#writeFlushMarker(turnContext, cycle);
    if (marked.aborted || this.#revoked(turnContext)) return;
    if (!marked.value.ok) {
      this.#report(
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
      this.#report(
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

  /** Where the standing generation is in its compaction cycles, and the cycle the last completed flush ran under, as read so far. */
  flushCycle(): BrainFlushCycle {
    const generation = this.#generation;
    if (!generation) return { compactionCount: 0 };
    return {
      compactionCount: generation.compactionCount,
      ...(generation.flush.lastCompactionCount !== undefined
        ? { lastFlushCompactionCount: generation.flush.lastCompactionCount }
        : undefined),
    };
  }

  /**
   * A copy of the conversation's context items as they stand, for the host's
   * reset capture; nothing when no context is loaded. The engine itself is
   * never handed out.
   */
  async contextSnapshot(): Promise<readonly WireRecord[] | undefined> {
    const generation = this.#generation;
    if (!generation) return undefined;
    const standing = await generation.opened;
    if (standing.kind !== CONTEXT_OPENING.LOADED) return undefined;
    return [...standing.context.checkpoint().items];
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
    const opened = await generation.opened;
    if (generation !== this.#generation) return;
    this.#armInbox(generation);
    if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      this.#reportIncompatible(generation, opened.reason);
    }
    const interrupted = interruptedUnfinishedRequests(state.requests, this.#now());
    // An act found started with no result may have happened: the runtime's
    // context paired it as unknown at load, and the interrupted run says so
    // in its count; neither is ever a call to make again.
    const repaired = opened.kind === CONTEXT_OPENING.LOADED ? opened.repaired : 0;
    // A journal row under a run no record names is what an observation turn
    // that died mid-act left behind. Its result already stands in the context,
    // paired at load, and no record waits for its count, so it goes here
    // rather than standing where a later turn's call could be matched to it.
    const recorded = new Set(state.requests.map((record) => record.runId));
    const orphaned = state.journal.filter((entry) => !recorded.has(entry.runId));
    if (orphaned.length > 0) {
      generation.journal.dropRuns(new Set(orphaned.map((entry) => entry.runId)));
    }
    if (interrupted === state.requests && repaired === 0 && orphaned.length === 0) return;
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
    await this.#ledger.save(generation, {
      kind: SAVE_SCOPE.WHOLE,
      context: opened.kind === CONTEXT_OPENING.LOADED ? opened.context : undefined,
    });
    this.#notify();
  }

  /**
   * Observations captured before the last launch ended, or left standing by a
   * turn that failed, open a turn once the state is read: they were written
   * down to be read, and a relaunch reads them without touching a transcript.
   */
  #armInbox(generation: Generation): void {
    if (this.#stopped || generation.inbox.length === 0) return;
    this.#wakes.push(this.#inboxEvents(generation));
  }

  #reportIncompatible(generation: Generation, reason: string): void {
    if (this.#incompatibleReported === generation.id) return;
    this.#incompatibleReported = generation.id;
    this.#report(`Brain memory is kept but cannot be run: ${reason}`);
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
    this.#cancelMaintenance();
    // Asks that only ever waited belong to the memory being replaced: nothing
    // opens for them, and each record ends as the replacement leaves it.
    void this.#settleWaiting(this.#takeWaiting());
    previous?.abort.abort();
    for (const run of this.#runs.values()) {
      run.cancelled = true;
      run.abort.abort();
    }
    this.#runs.clear();
    if (previous) retireOpenedContext(previous);
    // Wakes coalesced against the old memory — including a quiet retry's —
    // are that generation's work, and go with it.
    this.#wakes.clear();
    this.#cancelHeartbeatRetry();
    this.#generation = this.#generationFrom(state);
    this.#armInbox(this.#generation);
    this.#notify();
  }

  /**
   * Asks the store to end the generation if its time has come: the door
   * check, for a store whose automatic reset is enabled and whose generation
   * outlived its deadline while nothing kept its clock. Under the default
   * policy of no automatic reset the store declines and the generation
   * stands. The clock itself — a timer at the expiry instant — is the host's,
   * one per store, standing whether or not an agent does. The store's fence
   * is synchronous and its announcement adopts the successor here in the
   * same call, so by the time this returns the dead generation's signal has
   * fired and nothing of it can open, dispatch, or deliver.
   */
  #expireIfDue(): void {
    const generation = this.#generation;
    if (this.#stopped || !generation || !brainGenerationExpired(generation, this.#now())) return;
    this.#options.store.expireIfDue(this.#now());
  }

  #runRevoked(run: RunControl): boolean {
    return run.cancelled || run.timedOut || this.#stopped || run.generation.abort.signal.aborted;
  }

  /**
   * Opens one turn for the asks a drain handed over. The first of them that
   * can still open stands as the turn's run and the rest ride inside it; an
   * ask already revoked, or one whose start the store refuses, settles here
   * and leaves the turn to the next, so asks behind a run that never opened
   * are not lost. The question the model reads is composed here from the
   * asks that opened, and from no other: the overflow's summary from the
   * folded ones, then each ask's own words.
   */
  async #runAsk(inputs: readonly AskInput[]): Promise<void> {
    const waiting = [...inputs];
    while (waiting.length > 0) {
      const primary = waiting.shift();
      if (!primary || !(await this.#opens(primary.run))) continue;
      const run = primary.run;
      const generation = run.generation;
      // The start is durable before any work opens: a run the file does not
      // show running is one a relaunch would find queued while its acts had
      // begun, and a cancel would settle on the queued path under a dispatched
      // effect. A start the store refuses ends the run as the persistence
      // failure it is, with nothing called; a revocation that landed while the
      // start was being written ends it on its own terms, likewise unopened.
      const started = await this.#ledger.commit(generation, run.runId, {
        status: BRAIN_REQUEST_STATUS.RUNNING,
        startedAt: this.#now(),
      });
      this.#notify();
      if (!started || this.#runRevoked(run)) {
        this.#runs.delete(run.runId);
        if (this.#runRevoked(run)) {
          await this.#ledger.settleRun(
            generation,
            run.runId,
            run.cancelled ? BRAIN_REQUEST_STATUS.CANCELLED : BRAIN_REQUEST_STATUS.INTERRUPTED,
            {},
          );
        } else {
          await this.#ledger.settleRun(
            generation,
            run.runId,
            BRAIN_REQUEST_STATUS.FAILED,
            { failure: BRAIN_REQUEST_FAILURE.PERSISTENCE },
            run,
          );
        }
        continue;
      }
      const riders: RunControl[] = [];
      const opened: AskInput[] = [primary];
      for (const rider of waiting.splice(0)) {
        if (!(await this.#opens(rider.run))) continue;
        riders.push(rider.run);
        opened.push(rider);
        await this.#ledger.commit(rider.run.generation, rider.run.runId, {
          status: BRAIN_REQUEST_STATUS.RUNNING,
          startedAt: this.#now(),
        });
      }
      if (riders.length > 0) this.#notify();
      const question = askQuestion(opened);
      run.deadline = this.#schedule(() => {
        run.timedOut = true;
        run.abort.abort();
      }, this.#executionDeadlineMs);
      // A child's task runs under its own trigger: the words open as the
      // delegated task rather than the developer's ask, and the final text is
      // the result its requester is handed rather than speech.
      const childTask = generation.requests.get(run.runId)?.origin === BRAIN_REQUEST_ORIGIN.CHILD;
      let result: TurnResult;
      try {
        const opened = {
          generation,
          deliveries: new SteeredDeliveries(),
          events: this.#inboxEvents(generation),
          run,
        };
        result = await this.#turn(
          childTask
            ? {
                ...opened,
                trigger: BRAIN_TURN_TRIGGER.CHILD_TASK,
                open: (_attached, now) => [subagentTaskInputText(question, now)],
              }
            : {
                ...opened,
                trigger: BRAIN_TURN_TRIGGER.ASK,
                open: (attached, now) => [askInputText(question, attached, now)],
              },
          riders,
        );
      } catch {
        result = { outcome: TURN_OUTCOME.FAILED };
      }
      if (run.deadline !== undefined) this.#cancel(run.deadline);
      this.#runs.delete(run.runId);
      const { status, end } = this.#endOf(run, result);
      await this.#ledger.settleRun(generation, run.runId, status, end, run);
      return;
    }
  }

  /**
   * Whether a waiting ask may still open a turn: its record queued and its
   * execution not revoked. One that may not is settled and forgotten here,
   * as the record's own end rather than as anything the turn did.
   */
  async #opens(run: RunControl): Promise<boolean> {
    const record = run.generation.requests.get(run.runId);
    if (record?.status === BRAIN_REQUEST_STATUS.QUEUED && !this.#runRevoked(run)) return true;
    if (record?.status === BRAIN_REQUEST_STATUS.QUEUED) {
      await this.#ledger.settleRun(
        run.generation,
        run.runId,
        run.cancelled ? BRAIN_REQUEST_STATUS.CANCELLED : BRAIN_REQUEST_STATUS.INTERRUPTED,
        {},
      );
    }
    this.#runs.delete(run.runId);
    return false;
  }

  /** How a run's turn result reads as its record's end. */
  #endOf(flags: RunEndFlags, result: TurnResult): RunOutcome {
    const end: RunEnd = {};
    let status: BrainRequestRecord["status"];
    if (flags.timedOut) {
      status = BRAIN_REQUEST_STATUS.TIMED_OUT;
      end.failure = BRAIN_REQUEST_FAILURE.DEADLINE;
    } else if (flags.cancelled) {
      status = BRAIN_REQUEST_STATUS.CANCELLED;
    } else if (this.#stopped || flags.generation.abort.signal.aborted) {
      status = BRAIN_REQUEST_STATUS.INTERRUPTED;
    } else if (flags.checkpointFailed) {
      // What the run did may be unrecorded; that outranks whatever the model
      // did afterwards, and the reply, if one formed, still travels.
      status = BRAIN_REQUEST_STATUS.FAILED;
      end.failure = BRAIN_REQUEST_FAILURE.PERSISTENCE;
      if (result.outcome === TURN_OUTCOME.DONE && result.text) end.text = result.text;
    } else if (flags.compactionFailed) {
      status = BRAIN_REQUEST_STATUS.FAILED;
      end.failure = BRAIN_REQUEST_FAILURE.COMPACTION;
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
    return { status, end };
  }

  /**
   * Settles the asks that rode inside another turn — steered into it, or
   * drained with it — with that turn's own end: the reply the turn reached is
   * their reply, and its failure is theirs, a final write that failed
   * included. Each keeps its own record and its own acceptance; only the
   * execution was shared.
   */
  async #settleRiders(
    riders: readonly RunControl[],
    primary: RunControl,
    result: TurnResult,
  ): Promise<void> {
    for (const rider of riders) {
      this.#runs.delete(rider.runId);
      const { status, end } = this.#endOf(primary, result);
      await this.#ledger.settleRun(primary.generation, rider.runId, status, end);
    }
  }

  /**
   * One turn, settled whole: however it ends — at the door, by a thrown
   * hook, or by the model — the asks riding in it end with it, the asks that
   * waited behind it open, and an observation turn leaves its notice.
   */
  async #turn(plan: TurnPlan, riders: RunControl[] = []): Promise<TurnResult> {
    let outcome: OpenedTurn;
    try {
      outcome = await this.#openTurn(plan, riders);
    } catch {
      outcome = { result: { outcome: TURN_OUTCOME.FAILED }, run: plan.run };
    }
    const { result, run } = outcome;
    // Riders ride an ask's turn alone, and an ask always brings its run.
    if (plan.run) await this.#settleRiders(riders, plan.run, result);
    // Asks that arrived while this turn ran open now rather than waiting out
    // the queue's debounce: what they were waiting for has ended.
    this.#asks.flush();
    if (
      run &&
      runOriginOf(plan.trigger) !== RUN_ORIGIN.USER &&
      REPORTED_OUTCOMES.has(result.outcome)
    ) {
      this.#options.notice?.({
        trigger: plan.trigger,
        identities: uniqueIdentities(plan.events),
        briefings: result.outcome === TURN_OUTCOME.DONE ? result.briefings : [],
        performedActs: run.performedActs,
        at: this.#now(),
      });
    }
    return result;
  }

  /** The turn itself, answering its result and the run it ran under; the door's refusals answer the plan's own. */
  async #openTurn(plan: TurnPlan, riders: RunControl[]): Promise<OpenedTurn> {
    await this.ready();
    // The generation's death is checked at the door of every turn, so a
    // memory that outlived its fortnight while the app sat idle is not read
    // one more time on the way out.
    this.#expireIfDue();
    const generation = plan.generation;
    // Work queued in a generation since replaced opens nothing: its briefings
    // and its wakes described a memory that no longer exists.
    if (generation !== this.#generation || generation.abort.signal.aborted) {
      return { result: { outcome: TURN_OUTCOME.REVOKED }, run: plan.run };
    }
    const opened = await generation.opened;
    if (generation !== this.#generation || generation.abort.signal.aborted) {
      return { result: { outcome: TURN_OUTCOME.REVOKED }, run: plan.run };
    }
    if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      // The memory is kept as it is and nothing is read or written over it.
      this.#reportIncompatible(generation, opened.reason);
      return { result: { outcome: TURN_OUTCOME.INCOMPATIBLE }, run: plan.run };
    }
    const context = opened.context;
    // An observation turn runs under an unrecorded run of its own, so an act
    // it takes is journaled, checkpointed, and revoked exactly as an ask's.
    // Its id comes from the same minter as an ask's, never a counter: a
    // counter starts over with every agent, and a journal row a crashed turn
    // left under the same id would be answered as this turn's own act.
    const run =
      plan.run ??
      newRunControl(`${plan.trigger}:${this.#options.createRunId()}`, generation, false);
    // An observation turn holds the queue as an ask does, so it ends at the
    // same deadline: a model that never answers cannot stall every turn
    // behind it.
    if (!plan.run) {
      run.deadline = this.#schedule(() => {
        run.timedOut = true;
        run.abort.abort();
      }, this.#executionDeadlineMs);
    }
    const consumes = plan.events.flatMap((event) => (event.entryId ? [event.entryId] : []));
    const turnContext: TurnContext = {
      generation,
      context,
      run,
      signal: AbortSignal.any([generation.abort.signal, run.abort.signal]),
      ...(consumes.length > 0 ? { consumes } : undefined),
    };
    this.#turnInFlight = true;
    let ended = false;
    const execution: BrainActExecution = {
      runId: run.runId,
      origin: runOriginOf(plan.trigger),
      isRevoked: () => ended || this.#revoked(turnContext),
      signal: turnContext.signal,
    };
    try {
      return { result: await this.#runTurn(plan, turnContext, execution, riders), run };
    } finally {
      ended = true;
      if (!plan.run && run.deadline !== undefined) this.#cancel(run.deadline);
      this.#turnInFlight = false;
      // Steered words no checkpoint of the turn carried are owed still.
      plan.deliveries.turnEnded();
      this.#active = undefined;
    }
  }

  #revoked(context: Pick<TurnContext, "signal">): boolean {
    return this.#stopped || context.signal.aborted;
  }

  async #runTurn(
    plan: TurnPlan,
    turnContext: TurnContext,
    execution: BrainActExecution,
    riders: RunControl[],
  ): Promise<TurnResult> {
    const { generation, context, run } = turnContext;
    const startedAt = this.#now();
    let contextMark: ContextMark = context.mark();
    let cursorMark = generation.cursors.persisted();
    const gathering: TurnGathering = {
      toolCalls: [],
      deliveries: [],
      iterations: 0,
      compacted: false,
      outputText: "",
    };
    let preparation: BrainTurnPreparation | undefined;
    let policy: EffectiveToolPolicy | undefined;
    let notes: readonly BrainTurnNotice[] = [];
    const revocation = (): TurnResult => {
      gathering.error = run.timedOut ? "execution deadline passed" : "turn revoked";
      return { outcome: TURN_OUTCOME.REVOKED };
    };
    if (this.#revoked(turnContext)) return revocation();

    // The consumed cursor moves to where each entry's capture read, in
    // memory now and on disk with the checkpoint; a turn that fails rolls it
    // back with the context, and the entries stand for the next one.
    for (const entry of generation.inbox) {
      if (entry.cursor !== undefined && turnContext.consumes?.includes(entry.id)) {
        generation.cursors.setCursor(
          { providerId: entry.providerId, providerSessionId: entry.providerSessionId },
          entry.cursor,
        );
      }
    }
    const attachedDeltas = await this.#attachDeltas(plan.events, turnContext);
    const transcriptBytes = attachedDeltas.transcriptBytes;
    let failure: TurnResult | undefined;
    if (this.#revoked(turnContext)) {
      // Nothing the reads gained opens an inference the developer or the
      // host has already withdrawn; the cursors go back with the context.
      failure = revocation();
    } else {
      // A scheduled look carries the whole roster in its own words, so a
      // session whose transcript gained nothing is left out of the events
      // rather than repeated as an empty delta.
      const events =
        plan.trigger === BRAIN_TURN_TRIGGER.ROSTER
          ? attachedDeltas.events.filter(
              (event) =>
                event.kind !== BRAIN_WAKE_KIND.ROSTER || Boolean(event.transcriptDelta?.text),
            )
          : attachedDeltas.events;
      // Every turn advances its rollback point: each answered effect is
      // checkpointed and the mark moves past it, so a later failure returns
      // the context to the last paired state and never to before an act that
      // already happened. A turn that fails before its first effect still
      // rolls back whole, and the deltas it read are read again.
      const advanceMark = async () => {
        if (await this.#ledger.checkpoint(turnContext)) plan.deliveries.persisted();
        else run.checkpointFailed = true;
        contextMark = context.mark();
        cursorMark = generation.cursors.persisted();
      };
      try {
        preparation = await this.#prepareTurn({
          kind: BRAIN_TURN_KIND.TURN,
          trigger: plan.trigger,
        });
        policy = this.#resolvePolicy(preparation, plan.trigger);
        const prepared = this.#revoked(turnContext)
          ? { ok: true as const }
          : await this.#compactIfNeeded(turnContext, preparation.prompt);
        if (this.#revoked(turnContext)) {
          failure = revocation();
        } else if (!prepared.ok) {
          // The request would not fit and the context could not be folded:
          // the run fails recoverably, and what stands is exactly what stood.
          run.compactionFailed = true;
          gathering.error = `compaction required: ${prepared.reason}`;
          failure = { outcome: TURN_OUTCOME.FAILED };
        } else {
          // The admission's compaction, if any, is the new rollback point: a
          // turn that then fails returns to the folded context, not before it.
          // The cursors keep their mark from before the deltas were read, so
          // a failed turn still reads them again.
          contextMark = context.mark();
          const primed = await this.#primeIfFresh(turnContext);
          notes = this.#options.openingNotes?.take() ?? [];
          const end = await this.#execute(turnContext, execution, gathering, {
            prompt: preparation.prompt,
            policy,
            plan,
            riders,
            opening: [
              ...primed,
              ...(notes.length > 0 ? [activityNoticesInputText(notes, startedAt)] : []),
              ...plan.open(events, startedAt),
            ],
            advanceMark,
          });
          failure = this.#turnResultFrom(end, turnContext, gathering);
        }
      } catch (runtimeError) {
        // A runtime that threw instead of ending: the turn fails like one
        // whose model failed, and rolls back to the last paired state.
        gathering.error = runtimeError instanceof Error ? runtimeError.name : "unknown error";
        failure = this.#revoked(turnContext) ? revocation() : { outcome: TURN_OUTCOME.FAILED };
      }
    }

    // An unrecorded run's journal has done its work once the turn's acts have
    // settled: their results stand in the context, and no record waits for
    // their count. It goes before the final checkpoint so the store never
    // accumulates the journals of every observation turn.
    if (!run.recorded) generation.journal.dropRuns([run.runId]);
    if (failure) {
      await this.#restoreContext(turnContext, contextMark);
      generation.cursors.rollback(cursorMark);
      if (notes.length > 0) this.#options.openingNotes?.restore(notes);
      this.#report(`Brain ${plan.trigger} turn did not complete: ${gathering.error}`);
    } else {
      generation.cursors.retain(this.#options.roster().identities);
      generation.captureCursors.retain(this.#options.roster().identities);
      const written = await this.#ledger.checkpoint(turnContext);
      if (!written) run.checkpointFailed = true;
      if (written) {
        plan.deliveries.persisted();
        await context.afterTurn({ signal: turnContext.signal });
      }
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
      // Housekeeping waits for the reply to be persisted and its deliveries
      // to settle, then decides against the window the turn's own count says.
      if (written && !this.#revoked(turnContext)) {
        this.#scheduleMaintenance(turnContext, gathering.inputTokens);
      }
    }

    const { id: runtime, model } = this.#options.runtime.descriptor;
    this.#options.trace?.({
      trigger: plan.trigger,
      origin: runOriginOf(plan.trigger),
      runtime,
      tools: policy?.allowed.map((tool) => tool.id) ?? [],
      promptChars: preparation?.prompt.length ?? 0,
      ...(gathering.inputTokens !== undefined ? { inputTokens: gathering.inputTokens } : undefined),
      transcriptBytes,
      toolCalls: gathering.toolCalls,
      ...(gathering.outputText ? { outputText: gathering.outputText } : undefined),
      ...(gathering.incomplete ? { incomplete: gathering.incomplete } : undefined),
      deliveries: gathering.deliveries.map((delivery) => ({
        briefingChars: delivery.briefing.length,
      })),
      ...(model ? { model } : undefined),
      elapsedMs: this.#now() - startedAt,
      iterations: gathering.iterations,
      compacted: gathering.compacted,
      ...(gathering.error ? { error: gathering.error } : undefined),
    });

    return (
      failure ?? {
        outcome: TURN_OUTCOME.DONE,
        text: gathering.outputText,
        briefings: gathering.deliveries.map((delivery) => delivery.briefing),
      }
    );
  }

  /**
   * Stands the generation's context back at the mark the turn last committed
   * past — the start of the turn for an observation, the last checkpointed
   * tool result for a run — on a fresh engine, because a late hook of the
   * old engine may still apply to it. A reopen the runtime refuses leaves the
   * generation standing without a context, its stored checkpoint untouched.
   */
  async #restoreContext(turnContext: TurnContext, mark: ContextMark): Promise<void> {
    const { generation, context } = turnContext;
    const reopened = await claimOpenedContext(
      this.#options.runtime.openContext(
        { format: context.checkpointFormat, items: mark.items },
        JSON.stringify(UNKNOWN_ACT_RESULT),
        { signal: generation.abort.signal },
      ),
      generation.abort.signal,
      "the runtime could not reopen its own checkpoint",
      this.#now,
    );
    if (reopened.aborted) return;
    const standing = await generation.opened;
    const stillUsed = standing.kind === CONTEXT_OPENING.LOADED && standing.context === context;
    if (generation !== this.#generation || !stillUsed) {
      if (reopened.value.kind === CONTEXT_OPENING.LOADED) retireContext(reopened.value.context);
      return;
    }
    // The engine the turn used is not re-admitted either way: it may hold
    // what a late hook applied. A refused reopen leaves the generation
    // standing without a context, every turn over it refused as incompatible.
    generation.opened = Promise.resolve(reopened.value);
    retireContext(context);
    if (reopened.value.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      this.#reportIncompatible(generation, reopened.value.reason);
    }
  }

  /**
   * The one-shot priming of a conversation that just started fresh: a
   * context with nothing in it yet is handed the host's primer — the recent
   * daily notes — as the first words of its first turn, behind a marker that
   * says it is data. An ordinary turn over a context with items reads none.
   */
  async #primeIfFresh(turnContext: TurnContext): Promise<readonly string[]> {
    const context = turnContext.context;
    if (context.checkpoint().items.length > 0) return [];
    const inherited = this.#options.inheritedContext;
    if (inherited && inherited.length > 0) {
      // A forked child: the requester's context is the child's opening
      // history, adopted whole and recorded as a fork boundary, and the task
      // then follows it as the first words of the child's own.
      await settledUnlessAborted(
        Promise.resolve(context.adoptFork(inherited, { signal: turnContext.signal })),
        turnContext.signal,
      );
      return [];
    }
    const primer = this.#options.primeFreshContext;
    if (!primer) return [];
    const settled = await settledUnlessAborted(primer(), turnContext.signal);
    if (settled.aborted || !settled.value) return [];
    return [primedNotesInputText(settled.value)];
  }

  /**
   * The one resolution of a turn's tools: the host's configured layers over
   * the catalog it named, then the turn's own layer. The same policy fixes
   * the schemas the model is offered and the gate every dispatch meets.
   */
  #resolvePolicy(
    preparation: BrainTurnPreparation,
    trigger: BrainTurnTrigger,
  ): EffectiveToolPolicy {
    return resolveTurnToolPolicy(
      preparation.catalog ?? brainToolCatalog(),
      preparation.layers,
      trigger,
      this.#options.child,
    );
  }

  /**
   * One execution on the runtime: the opening words, the toolset the
   * effective policy fixes, the standing context rebuilt for every
   * inference, and a listener that keeps what the run gathers and
   * checkpoints each answered effect before the runtime asks the model again.
   */
  #execute(
    turnContext: TurnContext,
    execution: BrainActExecution,
    gathering: TurnGathering,
    turn: {
      prompt: string;
      policy: EffectiveToolPolicy;
      plan: TurnPlan;
      riders: RunControl[];
      opening: readonly string[];
      advanceMark: () => Promise<void>;
    },
  ): Promise<RuntimeRunEnd> {
    const { context, run } = turnContext;
    const runId = run.runId;
    const tools = createTurnToolExecutor(
      {
        roster: this.#options.roster,
        acts: this.#options.acts,
        workspace: this.#options.workspace,
        children: this.#options.children,
        memory: this.#options.memory,
        readWhole: (identity, readContext) => this.#readWhole(identity, readContext),
        checkpoint: (checkpointContext) => this.#ledger.checkpoint(checkpointContext),
        runRevoked: (checked) => this.#runRevoked(checked),
        now: this.#now,
      },
      {
        policy: turn.policy,
        context: turnContext,
        execution,
        onBriefing: (delivery) => gathering.deliveries.push(delivery),
      },
    );
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
          turnContext.generation.compactionCount += 1;
          return;
        case RUNTIME_EVENT.STEERED:
          turn.plan.deliveries.ingested();
          return;
        case RUNTIME_EVENT.TOOL_RESULT:
          gathering.toolCalls.push({
            name: event.invocation.name,
            argumentsChars: event.invocation.argumentsJson.length,
            outcomeStatus: event.result.status ?? TOOL_RESULT_STATUS.ANSWERED,
          });
          // The answered tool is in the context. A recorded run keeps every
          // answer before the model is asked again; an unrecorded turn keeps
          // only an effect, so a turn that merely read and failed still rolls
          // back whole and reads its deltas again, while an act that happened
          // is never reverted.
          if (run.recorded || journaledEffect(turn.policy, event.invocation.name)) {
            await turn.advanceMark();
          }
          return;
        default:
          return;
      }
    };
    const started = this.#options.runtime.start({
      runId,
      context,
      tools,
      toolSchemas: brainToolSchemas(turn.policy),
      prompt: turn.prompt,
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
    this.#active = { run, started, plan: turn.plan, riders: turn.riders };
    // Steered words the runtime never ingested are not delivered; words it
    // did ingest wait for the turn's final checkpoint, which decides them.
    return started.done.finally(() => turn.plan.deliveries.runEnded());
  }

  /** How a run's end reads as a turn's: an observation turn keeps what it read wherever a run would fall short. */
  #turnResultFrom(
    end: RuntimeRunEnd,
    turnContext: TurnContext,
    gathering: TurnGathering,
  ): TurnResult | undefined {
    if (this.#revoked(turnContext)) {
      gathering.error = turnContext.run.timedOut ? "execution deadline passed" : "turn revoked";
      return { outcome: TURN_OUTCOME.REVOKED };
    }
    switch (end.reason) {
      case RUN_END_REASON.COMPLETED:
        // The end's text is the reply: an earlier answer's words that preceded
        // a tool call are not the answer when the final answer said nothing.
        gathering.outputText = end.text;
        if (end.incomplete) gathering.incomplete = incompleteDetail(end.incomplete);
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
        return turnContext.run.recorded ? { outcome: TURN_OUTCOME.INCOMPLETE } : undefined;
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

  #readWhole(identity: SessionIdentity, context: TurnContext): Promise<WireRecord> {
    return readWholeTranscript(identity, {
      read: (identity) => this.#options.readTranscript(identity),
      signal: context.signal,
      maximumChars: this.#fullTranscriptChars,
    });
  }
}

/**
 * The end of a child run whose record its generation no longer holds — a
 * wait that returned nothing because the generation was replaced under it.
 * What the run did is unknown; nothing about it can be vouched for.
 */
const RUN_FORGOTTEN: ChildEnd = {
  status: CHILD_RUN_STATUS.UNKNOWN,
  failureDetail: "the child's run was forgotten by its generation before it ended",
};

/** A child's run record as its requester's service reads its end. */
function childRunEnd(record: BrainRequestRecord): ChildEnd {
  const counts = { performedActs: record.performedActs, unknownActs: record.unknownActs };
  switch (record.status) {
    case BRAIN_REQUEST_STATUS.SUCCEEDED:
      return {
        status: CHILD_RUN_STATUS.COMPLETED,
        ...(record.text !== undefined ? { resultText: record.text } : undefined),
        ...counts,
      };
    case BRAIN_REQUEST_STATUS.CANCELLED:
      return { status: CHILD_RUN_STATUS.CANCELLED, ...counts };
    case BRAIN_REQUEST_STATUS.TIMED_OUT:
      return { status: CHILD_RUN_STATUS.TIMED_OUT, ...counts };
    case BRAIN_REQUEST_STATUS.INTERRUPTED:
      return {
        status: CHILD_RUN_STATUS.UNKNOWN,
        failureDetail:
          "the child's run was interrupted; what it did before is what its journal kept",
        ...counts,
      };
    case BRAIN_REQUEST_STATUS.FAILED:
      return {
        status: CHILD_RUN_STATUS.FAILED,
        ...(record.failure !== undefined ? { failureDetail: record.failure } : undefined),
        ...(record.text !== undefined ? { resultText: record.text } : undefined),
        ...counts,
      };
    case BRAIN_REQUEST_STATUS.QUEUED:
    case BRAIN_REQUEST_STATUS.RUNNING:
      return {
        status: CHILD_RUN_STATUS.UNKNOWN,
        failureDetail: "the child's run has not ended",
        ...counts,
      };
  }
}

function uniqueIdentities(events: readonly BrainWakeEvent[]): readonly SessionIdentity[] {
  const seen: SessionIdentity[] = [];
  for (const event of events) {
    if (!seen.some((identity) => sameIdentity(identity, event.identity))) {
      seen.push({ ...event.identity });
    }
  }
  return seen;
}

function sameWake(first: BrainWakeEvent, second: BrainWakeEvent): boolean {
  return (
    first.kind === second.kind &&
    first.hookEvent === second.hookEvent &&
    first.atMs === second.atMs &&
    sameIdentity(first.identity, second.identity)
  );
}

/**
 * A value per observed session, keyed by provider and then by the provider's
 * own session id, the way the cursors are: two identifiers, never one string
 * composed of both.
 */
class BySession<T> {
  readonly #providers = new Map<string, Map<string, T>>();

  get(identity: SessionIdentity): T | undefined {
    return this.#providers.get(identity.providerId)?.get(identity.providerSessionId);
  }

  set(identity: SessionIdentity, value: T): void {
    let sessions = this.#providers.get(identity.providerId);
    if (!sessions) {
      sessions = new Map();
      this.#providers.set(identity.providerId, sessions);
    }
    sessions.set(identity.providerSessionId, value);
  }
}

/** A session as the roster showed it at a look, in the fields a change would move; never a transcript. */
function lookFingerprint(event: BrainWakeEvent): string {
  const session = event.session;
  return JSON.stringify(
    session
      ? [
          session.status,
          session.lastActivityAt,
          session.detail.activity ?? null,
          session.detail.error ?? null,
        ]
      : null,
  );
}
