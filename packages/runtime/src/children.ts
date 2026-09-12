import type { WireRecord } from "@sidecar/wire";
import {
  CHILD_CLEANUP,
  CHILD_CONTEXT_MODE,
  CHILD_RUN_STATUS,
  type ChildCleanup,
  type ChildCompletionRecord,
  type ChildContextMode,
  type ChildPolicyMetadata,
  type ChildRunRecord,
  type ChildRunStatus,
  type ChildSpawnReceipt,
  COMPLETION_DELIVERY_STATUS,
  completionIdFor,
  isTerminalChildRunStatus,
} from "./child-records.js";
import { type AgentId, childSessionKey, type SessionKey } from "./identifiers.js";
import type { ScheduledTimer } from "./scheduled-timer.js";
import { CHILD_DEPTH_CAP } from "./tool-policy.js";

export type { ScheduledTimer } from "./scheduled-timer.js";

/**
 * Delegation's own lifecycle, ported from OpenClaw `b7528507`'s sub-agent
 * service. A spawn is recorded before it is acknowledged and started only
 * after; the child runs in a conversation of its own, on the child lane,
 * and the requester's turn ends as it always would — a parent waiting for
 * a result yields its execution rather than holding it. A child's end is
 * persisted as a completion before anyone is told of it, and delivered to
 * the conversation that asked, whichever kind it is, by steering its active
 * run or opening a turn there; a delivery that cannot land is retried on
 * OpenClaw's backoff and retained as blocked once the window is spent.
 * Ordinary parent completion never ends a child; an explicit cancellation
 * cascades through every descendant; and a reset of a conversation cancels
 * its descendants first and refuses to report success while any remains.
 *
 * Nothing here runs a model or opens a conversation: the executor does, and
 * the deliverer hands completions over. What the service owns is the record,
 * the limits, the retry schedule, and the recovery of what a launch finds.
 */

export const CHILD_DEFAULTS = {
  /** Active children one requesting conversation may hold at once. */
  MAXIMUM_ACTIVE_PER_REQUESTER: 5,
  /** Active children across every conversation, the child lane's width. */
  MAXIMUM_ACTIVE_GLOBAL: 8,
  DEPTH_CAP: CHILD_DEPTH_CAP,
  /** No child-specific deadline: the child's run keeps the ordinary run deadline alone. */
  TIMEOUT_MS: 0,
  /** A requested fork over this many tokens starts isolated instead, and the receipt says so. */
  FORK_CAP_TOKENS: 100_000,
  /** How long a completed child's conversation stands before it is archived under `keep`. */
  ARCHIVE_AFTER_MS: 60 * 60 * 1000,
  DELIVERY_INITIAL_BACKOFF_MS: 15_000,
  DELIVERY_MAXIMUM_BACKOFF_MS: 5 * 60 * 1000,
  DELIVERY_WINDOW_MS: 30 * 60 * 1000,
  BLOCKED_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,
  /** Retained blocked completions at which the host is warned. */
  BLOCKED_WARNING: 25,
  /** Retained blocked completions at which spawning is refused. */
  BLOCKED_REFUSAL: 50,
  /** How many backend starts may fail during recovery before the rest is marked unknown without a try. */
  RECOVERY_FAILURE_BUDGET: 3,
} as const;

/** Where child records and completions stand between launches; the service is their only writer. */
export interface ChildStore {
  listChildren(): Promise<readonly ChildRunRecord[]>;
  putChild(record: ChildRunRecord): Promise<boolean>;
  deleteChild(childId: string): Promise<boolean>;
  listCompletions(): Promise<readonly ChildCompletionRecord[]>;
  putCompletion(record: ChildCompletionRecord): Promise<boolean>;
  deleteCompletion(completionId: string): Promise<boolean>;
}

/** A store that forgets at exit: the non-persistent run's, and every test's. */
export function memoryChildStore(): ChildStore {
  const children = new Map<string, ChildRunRecord>();
  const completions = new Map<string, ChildCompletionRecord>();
  return {
    listChildren: async () => [...children.values()],
    putChild: async (record) => {
      children.set(record.childId, record);
      return true;
    },
    deleteChild: async (childId) => children.delete(childId),
    listCompletions: async () => [...completions.values()],
    putCompletion: async (record) => {
      completions.set(record.completionId, record);
      return true;
    },
    deleteCompletion: async (completionId) => completions.delete(completionId),
  };
}

/** How a child's run ended, as the executor reports it. */
export interface ChildEnd {
  readonly status: ChildRunStatus;
  readonly resultText?: string;
  readonly failureDetail?: string;
  readonly performedActions?: number;
  readonly unknownActions?: number;
}

/** A child's run accepted by its backend, with the promise of its end; or refused, with why. */
export type ChildStart =
  | { readonly started: true; readonly done: Promise<ChildEnd> }
  | { readonly started: false; readonly reason: string };

/**
 * What runs a child: opens its conversation and its run, adopts one a launch
 * found unfinished, cancels it, archives it, and reads its lines. Every
 * method belongs to the host that owns the conversations; the service knows
 * only the record it hands over.
 */
export interface ChildExecutor {
  /** Opens the child's conversation and its run; settles once the run is durably accepted or refused. */
  start(record: ChildRunRecord, fork: readonly WireRecord[] | undefined): Promise<ChildStart>;
  /**
   * Adopts a child a launch found unfinished, using the runtime's own
   * recovery: what the child's journal kept stands, nothing is replayed, and
   * the answer is the end the runtime can vouch for or a refusal.
   */
  resume(record: ChildRunRecord): Promise<ChildStart>;
  /** Cancels the child's run; answers whether the cancellation landed. */
  cancel(record: ChildRunRecord): Promise<boolean>;
  /** Archives the child's conversation, its lines kept. */
  archive(record: ChildRunRecord): Promise<boolean>;
  /** The child's own conversation lines, most recent last, bounded. */
  lines(record: ChildRunRecord, limit: number): Promise<readonly string[]>;
}

export interface CompletionDeliveryOutcome {
  readonly delivered: boolean;
  readonly reason?: string;
}

/** Hands a completion to the conversation it is for; the host decides whether to steer or open a turn. */
export interface CompletionDeliverer {
  deliver(
    completion: ChildCompletionRecord,
    record: ChildRunRecord,
  ): Promise<CompletionDeliveryOutcome>;
}

/** The requester's active context, offered for a fork: the items and their estimated size. */
export interface ForkSnapshot {
  readonly items: readonly WireRecord[];
  readonly estimatedTokens: number;
}

export interface ChildSpawnRequest {
  readonly agentId: AgentId;
  readonly requesterSessionKey: SessionKey;
  readonly requesterRunId?: string;
  /** How deep the requester itself is: zero for main, a thread, or an observed conversation. */
  readonly requesterDepth: number;
  readonly task: string;
  readonly label?: string;
  readonly model?: string;
  readonly context?: ChildContextMode;
  /** Whether the child is bound to the requester's thread, which defaults its context to fork. */
  readonly thread?: boolean;
  readonly timeoutMs?: number;
  readonly cleanup?: ChildCleanup;
  readonly expectsCompletion?: boolean;
  readonly completionDestination?: SessionKey;
  readonly policy: ChildPolicyMetadata;
  /** Whether the child runs under the requester's own agent; a fork of another agent is refused. */
  readonly sameAgent: boolean;
  /** The requester's active context, taken when a fork is decided; nothing when it has none. */
  readonly fork?: () => ForkSnapshot | undefined;
}

export const CHILD_SPAWN_REFUSAL = {
  EMPTY_TASK: "empty_task",
  DEPTH_CAP: "depth_cap",
  REQUESTER_LIMIT: "requester_limit",
  GLOBAL_LIMIT: "global_limit",
  BLOCKED_COMPLETIONS: "blocked_completions",
  FORK_OTHER_AGENT: "fork_other_agent",
  PERSISTENCE: "persistence",
  STOPPED: "stopped",
} as const;

export type ChildSpawnRefusal = (typeof CHILD_SPAWN_REFUSAL)[keyof typeof CHILD_SPAWN_REFUSAL];

export type ChildSpawnOutcome =
  | { readonly accepted: true; readonly receipt: ChildSpawnReceipt }
  | { readonly accepted: false; readonly reason: ChildSpawnRefusal; readonly detail?: string };

/** What a cancellation amounted to: every named child ended, or the ones that did not. */
export interface ChildCancellation {
  readonly ok: boolean;
  readonly remaining: readonly string[];
}

export interface ChildRunServiceOptions {
  store: ChildStore;
  executor: ChildExecutor;
  deliverer: CompletionDeliverer;
  createId: () => string;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
  report?: (message: string) => void;
  limits?: Partial<{
    maximumActivePerRequester: number;
    maximumActiveGlobal: number;
    depthCap: number;
    forkCapTokens: number;
    archiveAfterMs: number;
    blockedWarning: number;
    blockedRefusal: number;
    recoveryFailureBudget: number;
  }>;
}

const FORK_NO_CONTEXT_NOTE =
  "the requester had no active context to fork; the child started isolated";

function forkCapNote(estimated: number, cap: number): string {
  return `the requester's context (~${estimated} tokens) exceeds the ${cap}-token fork cap; the child started isolated`;
}

/** An executor or deliverer call whose throw is an answer, never a crash of the service. */
async function attempt<T>(work: () => Promise<T>, fallback: (error: Error) => T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return fallback(error instanceof Error ? error : new Error(String(error)));
  }
}

/** OpenClaw's delivery backoff: 15 seconds doubling to a five-minute cap. */
export function deliveryBackoffMs(attempts: number): number {
  const doubled = CHILD_DEFAULTS.DELIVERY_INITIAL_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(doubled, CHILD_DEFAULTS.DELIVERY_MAXIMUM_BACKOFF_MS);
}

export class ChildRunService {
  readonly #options: ChildRunServiceOptions;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  readonly #report: (message: string) => void;
  readonly #children = new Map<string, ChildRunRecord>();
  readonly #completions = new Map<string, ChildCompletionRecord>();
  readonly #deliveryTimers = new Map<string, ScheduledTimer>();
  readonly #archiveTimers = new Map<string, ScheduledTimer>();
  /** Each child's own write chain, so two updates of one record land in order. */
  readonly #writes = new Map<string, Promise<unknown>>();
  /** Children whose end is being written, claimed synchronously so a cancel and an end racing cannot both settle one child. */
  readonly #settling = new Set<string>();
  #recoveryFailures = 0;
  #warnedBlocked = false;
  #started: Promise<void> | undefined;
  #stopped = false;

  constructor(options: ChildRunServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#schedule =
      options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.#cancel =
      options.cancel ??
      ((timer) => {
        // SAFETY: a timer this service scheduled itself came from setTimeout above.
        globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  #limit<Key extends keyof NonNullable<ChildRunServiceOptions["limits"]>>(
    key: Key,
    fallback: number,
  ): number {
    return this.#options.limits?.[key] ?? fallback;
  }

  /** Every child record, oldest acceptance first. */
  children(): readonly ChildRunRecord[] {
    return [...this.#children.values()].sort((a, b) => a.acceptedAt - b.acceptedAt);
  }

  child(childId: string): ChildRunRecord | undefined {
    return this.#children.get(childId);
  }

  childrenOf(requesterSessionKey: SessionKey): readonly ChildRunRecord[] {
    return this.children().filter((record) => record.requesterSessionKey === requesterSessionKey);
  }

  completions(): readonly ChildCompletionRecord[] {
    return [...this.#completions.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  completion(childId: string): ChildCompletionRecord | undefined {
    return this.#completions.get(completionIdFor(childId));
  }

  /** How many recovery starts have failed since a backend last actually started. */
  recoveryFailures(): number {
    return this.#recoveryFailures;
  }

  #blockedCount(): number {
    let count = 0;
    for (const completion of this.#completions.values()) {
      if (completion.delivery === COMPLETION_DELIVERY_STATUS.BLOCKED) count += 1;
    }
    return count;
  }

  #active(): readonly ChildRunRecord[] {
    return [...this.#children.values()].filter(
      (record) => !isTerminalChildRunStatus(record.status),
    );
  }

  /**
   * Loads what the last launch left and recovers it: unfinished children are
   * adopted through the executor's own recovery, under a bounded budget of
   * backend-start failures; pending completions are delivered again on their
   * schedule; blocked results past their retention are let go of; completed
   * children not yet archived are archived on their own clock.
   */
  start(): Promise<void> {
    this.#started ??= this.#load();
    return this.#started;
  }

  async #load(): Promise<void> {
    const [children, completions] = await Promise.all([
      this.#options.store.listChildren(),
      this.#options.store.listCompletions(),
    ]);
    for (const record of children) this.#children.set(record.childId, record);
    for (const completion of completions) {
      this.#completions.set(completion.completionId, completion);
    }
    await this.#pruneRetainedCompletions();
    for (const record of this.children()) {
      if (this.#stopped) return;
      if (!isTerminalChildRunStatus(record.status)) {
        await this.#recover(record);
      } else if (record.archivedAt === undefined) {
        this.#armArchive(record);
      }
    }
    for (const completion of this.completions()) {
      if (completion.delivery === COMPLETION_DELIVERY_STATUS.PENDING) this.#armDelivery(completion);
    }
  }

  async #recover(record: ChildRunRecord): Promise<void> {
    const budget = this.#limit("recoveryFailureBudget", CHILD_DEFAULTS.RECOVERY_FAILURE_BUDGET);
    if (this.#recoveryFailures >= budget) {
      await this.#complete(record.childId, {
        status: CHILD_RUN_STATUS.UNKNOWN,
        failureDetail: "not recovered: the recovery budget was spent by earlier backend failures",
        ...(record.performedActions !== undefined
          ? { performedActions: record.performedActions }
          : undefined),
        ...(record.unknownActions !== undefined
          ? { unknownActions: record.unknownActions }
          : undefined),
      });
      return;
    }
    const start = await attempt(
      () => this.#options.executor.resume(record),
      (error): ChildStart => ({ started: false, reason: error.name }),
    );
    if (!start.started) {
      this.#recoveryFailures += 1;
      this.#report(`Child ${record.childId} could not be recovered: ${start.reason}`);
      await this.#complete(record.childId, {
        status: CHILD_RUN_STATUS.UNKNOWN,
        failureDetail: `not recovered: ${start.reason}`,
      });
      return;
    }
    this.#recoveryFailures = 0;
    this.#follow(record.childId, start.done);
  }

  /** Stops every timer; nothing is delivered or archived after this, and what stands is on disk. */
  stop(): void {
    this.#stopped = true;
    for (const timer of this.#deliveryTimers.values()) this.#cancel(timer);
    for (const timer of this.#archiveTimers.values()) this.#cancel(timer);
    this.#deliveryTimers.clear();
    this.#archiveTimers.clear();
  }

  /**
   * Accepts a spawn, or answers why not. The record is written before the
   * receipt is handed back and the child is started only after, so a spawn
   * the store refused starts nothing and a crash between the two is found as
   * an accepted child to recover. The receipt carries what actually stands:
   * the child's own identifiers, the model it resolved to, and the context
   * it started with, isolated when a requested fork exceeded the cap.
   */
  async spawn(request: ChildSpawnRequest): Promise<ChildSpawnOutcome> {
    await this.start();
    if (this.#stopped) return { accepted: false, reason: CHILD_SPAWN_REFUSAL.STOPPED };
    const task = request.task.trim();
    if (!task) return { accepted: false, reason: CHILD_SPAWN_REFUSAL.EMPTY_TASK };
    const depthCap = this.#limit("depthCap", CHILD_DEFAULTS.DEPTH_CAP);
    const depth = request.requesterDepth + 1;
    if (depth > depthCap) {
      return {
        accepted: false,
        reason: CHILD_SPAWN_REFUSAL.DEPTH_CAP,
        detail: `nesting depth ${depthCap} reached`,
      };
    }
    const blocked = this.#blockedCount();
    const refusal = this.#limit("blockedRefusal", CHILD_DEFAULTS.BLOCKED_REFUSAL);
    if (blocked >= refusal) {
      return {
        accepted: false,
        reason: CHILD_SPAWN_REFUSAL.BLOCKED_COMPLETIONS,
        detail: `${blocked} completions are blocked awaiting delivery`,
      };
    }
    const active = this.#active();
    const own = active.filter(
      (record) => record.requesterSessionKey === request.requesterSessionKey,
    ).length;
    const perRequester = this.#limit(
      "maximumActivePerRequester",
      CHILD_DEFAULTS.MAXIMUM_ACTIVE_PER_REQUESTER,
    );
    if (own >= perRequester) {
      return {
        accepted: false,
        reason: CHILD_SPAWN_REFUSAL.REQUESTER_LIMIT,
        detail: `${own} children already active for this conversation`,
      };
    }
    const global = this.#limit("maximumActiveGlobal", CHILD_DEFAULTS.MAXIMUM_ACTIVE_GLOBAL);
    if (active.length >= global) {
      return {
        accepted: false,
        reason: CHILD_SPAWN_REFUSAL.GLOBAL_LIMIT,
        detail: `${active.length} children already active`,
      };
    }
    const requestedContext =
      request.context ?? (request.thread ? CHILD_CONTEXT_MODE.FORK : CHILD_CONTEXT_MODE.ISOLATED);
    let context: ChildContextMode = requestedContext;
    let contextNote: string | undefined;
    let fork: readonly WireRecord[] | undefined;
    if (requestedContext === CHILD_CONTEXT_MODE.FORK) {
      if (!request.sameAgent) {
        return { accepted: false, reason: CHILD_SPAWN_REFUSAL.FORK_OTHER_AGENT };
      }
      const snapshot = request.fork?.();
      const cap = this.#limit("forkCapTokens", CHILD_DEFAULTS.FORK_CAP_TOKENS);
      if (!snapshot || snapshot.items.length === 0) {
        context = CHILD_CONTEXT_MODE.ISOLATED;
        contextNote = FORK_NO_CONTEXT_NOTE;
      } else if (snapshot.estimatedTokens > cap) {
        context = CHILD_CONTEXT_MODE.ISOLATED;
        contextNote = forkCapNote(snapshot.estimatedTokens, cap);
      } else {
        fork = snapshot.items;
      }
    }
    const childId = this.#options.createId();
    const now = this.#now();
    const record: ChildRunRecord = {
      childId,
      agentId: request.agentId,
      requesterSessionKey: request.requesterSessionKey,
      ...(request.requesterRunId !== undefined
        ? { requesterRunId: request.requesterRunId }
        : undefined),
      childSessionKey: childSessionKey(childId, request.agentId),
      childRunId: this.#options.createId(),
      task,
      ...(request.label ? { label: request.label } : undefined),
      depth,
      ...(request.model ? { model: request.model } : undefined),
      requestedContext,
      context,
      ...(contextNote ? { contextNote } : undefined),
      policy: { allowed: [...request.policy.allowed], denied: [...request.policy.denied] },
      timeoutMs: request.timeoutMs ?? CHILD_DEFAULTS.TIMEOUT_MS,
      cleanup: request.cleanup ?? CHILD_CLEANUP.KEEP,
      completionDestination: request.completionDestination ?? request.requesterSessionKey,
      expectsCompletion: request.expectsCompletion ?? true,
      status: CHILD_RUN_STATUS.ACCEPTED,
      acceptedAt: now,
    };
    if (!(await this.#put(record))) {
      return { accepted: false, reason: CHILD_SPAWN_REFUSAL.PERSISTENCE };
    }
    void this.#launch(record, fork);
    return {
      accepted: true,
      receipt: {
        childId,
        childSessionKey: record.childSessionKey,
        childRunId: record.childRunId,
        ...(record.model ? { model: record.model } : undefined),
        context,
        ...(contextNote ? { contextNote } : undefined),
        depth,
      },
    };
  }

  async #launch(record: ChildRunRecord, fork: readonly WireRecord[] | undefined): Promise<void> {
    const start = await attempt(
      () => this.#options.executor.start(record, fork),
      (error): ChildStart => ({ started: false, reason: error.name }),
    );
    if (this.#ended(record.childId)) {
      // Cancelled while starting: the cancel found no run to stop, so the run
      // that has just begun is stopped here, and the terminal row stands.
      if (start.started) void this.#stopLateStart(record);
      return;
    }
    if (!start.started) {
      await this.#complete(record.childId, {
        status: CHILD_RUN_STATUS.FAILED,
        failureDetail: `the child could not be started: ${start.reason}`,
      });
      return;
    }
    this.#recoveryFailures = 0;
    await this.#putIfActive(record.childId, (current) => ({
      ...current,
      status: CHILD_RUN_STATUS.RUNNING,
      startedAt: this.#now(),
    }));
    this.#follow(record.childId, start.done);
  }

  /** A started run's end becomes the child's completion; a run that never reports one ends unknown. */
  #follow(childId: string, done: Promise<ChildEnd>): void {
    void done.then(
      (end) => this.#complete(childId, end),
      (error: Error) =>
        this.#complete(childId, {
          status: CHILD_RUN_STATUS.UNKNOWN,
          failureDetail: `the child's run did not report its end: ${error.name}`,
        }),
    );
  }

  /** Whether the child has ended, or is ending in a write not yet landed. */
  #ended(childId: string): boolean {
    const current = this.#children.get(childId);
    return !current || isTerminalChildRunStatus(current.status) || this.#settling.has(childId);
  }

  /** A run that began after its child was cancelled is stopped; its end, when it comes, changes nothing. */
  async #stopLateStart(record: ChildRunRecord): Promise<void> {
    const stopped = await attempt(
      () => this.#options.executor.cancel(record),
      () => false,
    );
    if (!stopped) {
      this.#report(
        `Child ${record.childId} started after its cancellation and could not be stopped`,
      );
    }
  }

  /**
   * Cancels one child and, first, every descendant of it, deepest first;
   * answers which cancellations did not land. A cancel reaches the executor
   * once per child however many times it is asked, and a child already
   * ended is left as it ended.
   */
  async cancel(childId: string): Promise<ChildCancellation> {
    await this.start();
    const record = this.#children.get(childId);
    if (!record) return { ok: true, remaining: [] };
    const remaining: string[] = [];
    for (const descendant of this.childrenOf(record.childSessionKey)) {
      const below = await this.cancel(descendant.childId);
      remaining.push(...below.remaining);
    }
    if (!(await this.#cancelOne(record))) remaining.push(childId);
    return { ok: remaining.length === 0, remaining };
  }

  async #cancelOne(record: ChildRunRecord): Promise<boolean> {
    const current = this.#children.get(record.childId) ?? record;
    if (isTerminalChildRunStatus(current.status)) return true;
    let landed: boolean;
    try {
      landed = await this.#options.executor.cancel(current);
    } catch {
      landed = false;
    }
    if (!landed) return false;
    await this.#complete(current.childId, { status: CHILD_RUN_STATUS.CANCELLED });
    return true;
  }

  /**
   * What a reset of a conversation must do first: cancel every child it
   * asked for, and theirs. The answer is honest about what remains, so a
   * reset can refuse to report success over a child still running.
   */
  async cancelDescendantsOf(requesterSessionKey: SessionKey): Promise<ChildCancellation> {
    await this.start();
    const remaining: string[] = [];
    for (const record of this.childrenOf(requesterSessionKey)) {
      if (isTerminalChildRunStatus(record.status)) continue;
      const outcome = await this.cancel(record.childId);
      remaining.push(...outcome.remaining);
    }
    return { ok: remaining.length === 0, remaining };
  }

  /**
   * A child's end. The record settles, the completion is written on its own
   * before any delivery is tried, and the child's conversation is archived
   * now or on the retention clock. A child already ended is left alone, so
   * an executor's late report and a cancel cannot end one child twice.
   */
  async #complete(childId: string, end: ChildEnd): Promise<void> {
    const record = this.#children.get(childId);
    if (!record || isTerminalChildRunStatus(record.status) || this.#settling.has(childId)) return;
    this.#settling.add(childId);
    const now = this.#now();
    const settled: ChildRunRecord = {
      ...record,
      status: end.status,
      settledAt: now,
      ...(end.resultText !== undefined ? { resultText: end.resultText } : undefined),
      ...(end.failureDetail !== undefined ? { failureDetail: end.failureDetail } : undefined),
      ...(end.performedActions !== undefined
        ? { performedActions: end.performedActions }
        : undefined),
      ...(end.unknownActions !== undefined ? { unknownActions: end.unknownActions } : undefined),
    };
    await this.#put(settled);
    const completionId = completionIdFor(childId);
    if (!this.#completions.has(completionId)) {
      const completion: ChildCompletionRecord = {
        completionId,
        childId,
        destination: settled.completionDestination,
        status: settled.status,
        ...(settled.resultText !== undefined ? { resultText: settled.resultText } : undefined),
        ...(settled.failureDetail !== undefined
          ? { failureDetail: settled.failureDetail }
          : undefined),
        createdAt: now,
        delivery: settled.expectsCompletion
          ? COMPLETION_DELIVERY_STATUS.PENDING
          : COMPLETION_DELIVERY_STATUS.NOT_REQUIRED,
        attempts: 0,
      };
      await this.#putCompletion(completion);
      if (completion.delivery === COMPLETION_DELIVERY_STATUS.PENDING) {
        void this.#attemptDelivery(completion.completionId);
      }
    }
    if (settled.cleanup === CHILD_CLEANUP.DELETE) void this.#archive(settled.childId);
    else this.#armArchive(settled);
  }

  #armArchive(record: ChildRunRecord): void {
    if (this.#stopped || this.#archiveTimers.has(record.childId)) return;
    const after = this.#limit("archiveAfterMs", CHILD_DEFAULTS.ARCHIVE_AFTER_MS);
    const at = (record.settledAt ?? this.#now()) + after;
    const timer = this.#schedule(
      () => {
        this.#archiveTimers.delete(record.childId);
        void this.#archive(record.childId);
      },
      Math.max(0, at - this.#now()),
    );
    this.#archiveTimers.set(record.childId, timer);
  }

  async #archive(childId: string): Promise<void> {
    const record = this.#children.get(childId);
    if (!record || record.archivedAt !== undefined || this.#stopped) return;
    const archived = await attempt(
      () => this.#options.executor.archive(record),
      () => false,
    );
    if (!archived) {
      this.#report(`Child ${childId}'s conversation could not be archived`);
      return;
    }
    await this.#put({ ...record, archivedAt: this.#now() });
  }

  /** Retries delivery of a completion the host could not take; the operator's manual retry. */
  async retryDelivery(childId: string): Promise<boolean> {
    await this.start();
    const completion = this.#completions.get(completionIdFor(childId));
    if (!completion) return false;
    if (
      completion.delivery === COMPLETION_DELIVERY_STATUS.DELIVERED ||
      completion.delivery === COMPLETION_DELIVERY_STATUS.NOT_REQUIRED
    ) {
      return false;
    }
    const reopened: ChildCompletionRecord = {
      ...completion,
      delivery: COMPLETION_DELIVERY_STATUS.PENDING,
      attempts: 0,
    };
    const { firstAttemptAt: _first, nextAttemptAt: _next, blockedAt: _blocked, ...kept } = reopened;
    await this.#putCompletion(kept);
    await this.#attemptDelivery(completion.completionId);
    return true;
  }

  /** Lets go of a blocked completion on purpose. */
  async dismissCompletion(childId: string): Promise<boolean> {
    await this.start();
    const completion = this.#completions.get(completionIdFor(childId));
    if (!completion || completion.delivery !== COMPLETION_DELIVERY_STATUS.BLOCKED) return false;
    await this.#putCompletion({ ...completion, delivery: COMPLETION_DELIVERY_STATUS.DISMISSED });
    return true;
  }

  #armDelivery(completion: ChildCompletionRecord): void {
    if (this.#stopped || this.#deliveryTimers.has(completion.completionId)) return;
    const delay = Math.max(0, (completion.nextAttemptAt ?? this.#now()) - this.#now());
    const timer = this.#schedule(() => {
      this.#deliveryTimers.delete(completion.completionId);
      void this.#attemptDelivery(completion.completionId);
    }, delay);
    this.#deliveryTimers.set(completion.completionId, timer);
  }

  async #attemptDelivery(completionId: string): Promise<void> {
    const completion = this.#completions.get(completionId);
    const record = completion ? this.#children.get(completion.childId) : undefined;
    if (!completion || !record || this.#stopped) return;
    if (completion.delivery !== COMPLETION_DELIVERY_STATUS.PENDING) return;
    const now = this.#now();
    const firstAttemptAt = completion.firstAttemptAt ?? now;
    const outcome = await attempt(
      () => this.#options.deliverer.deliver(completion, record),
      (error): CompletionDeliveryOutcome => ({ delivered: false, reason: error.name }),
    );
    const latest = this.#completions.get(completionId);
    if (!latest || latest.delivery !== COMPLETION_DELIVERY_STATUS.PENDING) return;
    const attempts = latest.attempts + 1;
    if (outcome.delivered) {
      await this.#putCompletion({
        ...latest,
        delivery: COMPLETION_DELIVERY_STATUS.DELIVERED,
        attempts,
        firstAttemptAt,
        deliveredAt: this.#now(),
      });
      return;
    }
    // The window bounds the retries themselves: a next attempt that would
    // fall past it is not scheduled, and the result is retained as blocked now
    // rather than after one more wait nobody would answer.
    const after = this.#now();
    const nextAttemptAt = after + deliveryBackoffMs(attempts);
    if (nextAttemptAt - firstAttemptAt > CHILD_DEFAULTS.DELIVERY_WINDOW_MS) {
      await this.#putCompletion({
        ...latest,
        delivery: COMPLETION_DELIVERY_STATUS.BLOCKED,
        attempts,
        firstAttemptAt,
        blockedAt: after,
        ...(outcome.reason ? { lastError: outcome.reason } : undefined),
      });
      this.#warnIfBlocked();
      return;
    }
    const retried: ChildCompletionRecord = {
      ...latest,
      attempts,
      firstAttemptAt,
      nextAttemptAt,
      ...(outcome.reason ? { lastError: outcome.reason } : undefined),
    };
    await this.#putCompletion(retried);
    this.#armDelivery(retried);
  }

  #warnIfBlocked(): void {
    const blocked = this.#blockedCount();
    const warning = this.#limit("blockedWarning", CHILD_DEFAULTS.BLOCKED_WARNING);
    if (blocked >= warning && !this.#warnedBlocked) {
      this.#warnedBlocked = true;
      this.#report(
        `${blocked} child completions are blocked awaiting delivery; spawning is refused at ${this.#limit("blockedRefusal", CHILD_DEFAULTS.BLOCKED_REFUSAL)}`,
      );
    }
    if (blocked < warning) this.#warnedBlocked = false;
  }

  /** Blocked and dismissed completions older than the retention are let go of, with their children's records. */
  async #pruneRetainedCompletions(): Promise<void> {
    const now = this.#now();
    for (const completion of this.completions()) {
      const retained =
        completion.delivery === COMPLETION_DELIVERY_STATUS.BLOCKED ||
        completion.delivery === COMPLETION_DELIVERY_STATUS.DISMISSED;
      const since = completion.blockedAt ?? completion.createdAt;
      if (!retained || now - since < CHILD_DEFAULTS.BLOCKED_RETENTION_MS) continue;
      await this.#options.store.deleteCompletion(completion.completionId);
      this.#completions.delete(completion.completionId);
    }
  }

  /** The child's own conversation lines, through the executor, for `sessions_history`. */
  async lines(childId: string, limit: number): Promise<readonly string[] | undefined> {
    await this.start();
    const record = this.#children.get(childId);
    if (!record) return undefined;
    return this.#options.executor.lines(record, limit);
  }

  /**
   * Writes a change to a child still under way, decided inside the child's
   * own write chain: a cancel or an end that settled the child first leaves
   * its terminal row standing, never overwritten by a start that landed late.
   */
  #putIfActive(
    childId: string,
    change: (current: ChildRunRecord) => ChildRunRecord,
  ): Promise<boolean> {
    return this.#chain(childId, async () => {
      const current = this.#children.get(childId);
      if (!current || this.#ended(childId)) return false;
      const record = change(current);
      const written = await this.#options.store.putChild(record);
      if (written) this.#children.set(childId, record);
      else this.#report(`Child ${childId}'s record could not be written`);
      return written;
    });
  }

  #put(record: ChildRunRecord): Promise<boolean> {
    return this.#chain(record.childId, async () => {
      const written = await this.#options.store.putChild(record);
      if (written) this.#children.set(record.childId, record);
      else this.#report(`Child ${record.childId}'s record could not be written`);
      return written;
    });
  }

  #putCompletion(completion: ChildCompletionRecord): Promise<boolean> {
    return this.#chain(completion.completionId, async () => {
      const written = await this.#options.store.putCompletion(completion);
      if (written) this.#completions.set(completion.completionId, completion);
      else this.#report(`Completion ${completion.completionId} could not be written`);
      return written;
    });
  }

  #chain<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#writes.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.#writes.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }
}
