import type { ChildEnd, ChildPolicyContext } from "@sidecar/runtime";
import type {
  AgentRuntime,
  ChildCompletionRecord,
  ChildRunRecord,
  MemoryDefinition,
  ReasoningEffort,
  ScheduledTimer,
  SessionKey,
} from "@sidecar/runtime/vocabulary";
import type {
  ProviderTranscriptResult,
  ProviderTranscriptSinceResult,
  SessionIdentity,
} from "@sidecar/session";
import type { Event, WireRecord } from "@sidecar/wire";
import { eventFromStream } from "@sidecar/wire/effect";
import { Effect, Exit, PubSub, Scope, Stream } from "effect";
import { AskLedger, type BrainRequestsListener } from "./asks.js";
import { type BrainCompletionDelivery, ChildRuns } from "./children.js";
import { BRAIN_DEFAULTS } from "./defaults.js";
import {
  type BrainPersistedState,
  type BrainStoreLease,
  brainGenerationExpired,
} from "./envelope.js";
import {
  CONTEXT_OPENING,
  type Generation,
  generationFrom,
  retireOpenedContext,
} from "./generation.js";
import { holdReleasedInputText, wakeInputText } from "./input-items.js";
import { journalActionCounts, UNKNOWN_ACTION_RESULT } from "./journal.js";
import { BrainRequestLedger, PENDING_MARK_FIELD, type PendingMarkField } from "./ledger.js";
import { type BrainFlushMarkerStore, Maintenance } from "./maintenance.js";
import { inboxEvents } from "./observation-inbox.js";
import type { BrainActionPerformer, BrainRoster } from "./performer.js";
import {
  BRAIN_REQUEST_STATUS,
  type BrainRequestRecord,
  type BrainSubmission,
  type BrainSubmissionResult,
  interruptedUnfinishedRequests,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import type { BrainRunEvent } from "./run-events.js";
import type { AgentSeam } from "./seam.js";
import type { BrainStateStore } from "./state-store.js";
import { SteeredDeliveries } from "./steered-deliveries.js";
import type { BrainChildAccess, BrainWorkspaceAccess } from "./tool-executor.js";
import type { BrainTurnTraceRecord } from "./trace.js";
import {
  BRAIN_TURN_TRIGGER,
  type BrainTurnDescription,
  type BrainTurnPreparation,
  type BrainTurnTrigger,
  type RunControl,
} from "./turn.js";
import { TurnEvents } from "./turn-events.js";
import { type BrainOpeningNotes, TurnRunner } from "./turn-runner.js";
import type { BrainDelivery, BrainTurnReport, BrainWakeEvent } from "./wake-events.js";
import { type LookSubject, WakeCapture } from "./wakes.js";

export type { BrainRequestsListener } from "./asks.js";
export type { BrainCompletionDelivery } from "./children.js";
export { BRAIN_DEFAULTS } from "./defaults.js";
export type { BrainFlushMarkerStore } from "./maintenance.js";
export type { BrainWorkspaceAccess } from "./tool-executor.js";

export { LOOK_SUBJECT } from "./wakes.js";

/** Runs a turn's work under the host's lane for its trigger, so conversations share the lanes' budgets and nothing wider. */
type BrainLane = <T>(trigger: BrainTurnTrigger, work: () => Promise<T>) => Promise<T>;

export interface BrainAgentOptions {
  /** The conversation this agent is: the key every run event names, which is the conversation's id in this build. */
  conversationId: SessionKey;
  /** The execution the host runs turns on; it decides how a model and its tools loop, and it alone reaches the model. */
  runtime: AgentRuntime;
  actions: BrainActionPerformer;
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
   * The memory provider bound to this conversation's scope. Its recall is
   * read into every turn — the remembered facts as a standing item, the
   * recent daily notes once into a conversation opening fresh — its tools
   * are the memory tools, and its capture, where it has one, is the flush
   * run before a compaction: handed a private copy of the context, once per
   * compaction cycle, a soft margin before the context would fold or once
   * the retained transcript crosses the byte trigger. What a capture writes
   * stands whatever it answers; only an answer that says it ran to its end
   * marks the cycle flushed, so an interrupted flush runs again at the next
   * assessment. Absent, the memory tools refuse and nothing is recalled.
   */
  memory?: MemoryDefinition;
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
  /** Hears what each observation or hold-release turn amounted to, in the host's own counts. */
  notice?: (report: BrainTurnReport) => void;
  /** The lane each turn runs under; absent, turns are bounded only by this conversation's own serial queue. */
  lane?: BrainLane;
  openingNotes?: BrainOpeningNotes;
  /**
   * Which session this conversation's roster look reads, so two conversations
   * never read each other's transcript: its one observed session, or none.
   */
  observes: LookSubject;
  /**
   * Set when this conversation is a child's: how deep it is. Every turn is
   * then prepared as a child's — the minimal profile, the child restriction
   * on top of the configured layers — and a spawn from it counts one deeper.
   */
  child?: ChildPolicyContext;
  /** Delegation, supplied by the host that owns the conversations; absent, the session tools refuse. */
  children?: BrainChildAccess;
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
  /**
   * The prefix cache this conversation's turns ask for. Stable across
   * launches so a later turn lands on the earlier turns' prefix, and derived
   * by the host from the conversation's key by a hash, so the key itself
   * never travels.
   */
  promptCacheKey?: string;
  executionDeadlineMs?: number;
}

/**
 * The brain: one long-lived agent that is woken by the agents' hooks and by
 * its own look at the roster, asked things by the developer, and
 * answers with briefings for the voice to speak and actions for the host to
 * carry. Nothing detects a change on its behalf: the roster look carries
 * what stands and what each transcript gained, and the brain notices what is
 * new against its own memory.
 *
 * It is the host of an execution, not the execution itself. What it owns is
 * the conversation's standing: accepting asks into runs with records,
 * queueing turns, revoking them on a cancel, a deadline, a stop, or the
 * store's generation changing, journaling every action before its effect and
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
 * a roster look, a hold release — is recorded as its origin, and an action taken
 * in a turn the developer did not open is journaled and narrated as Luke's
 * own rather than as anything the developer asked for.
 *
 * A developer ask is a run with a record: accepted once its record is
 * checkpointed, queued behind the turns ahead of it, running under an
 * execution deadline and a cancellation the developer holds, and ended in one
 * of the terminal statuses the record vocabulary names. Every action the run
 * dispatches is journaled before the performer sees it and again with its
 * result before the model does, and the context's rollback point advances
 * past each answered act, so a reply the model then fails to produce cannot
 * erase an action that already happened.
 */
export class BrainAgent {
  readonly #options: BrainAgentOptions;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  readonly #report: (message: string) => void;
  #generation: Generation | undefined;
  readonly #lease: BrainStoreLease;
  readonly #ledger: BrainRequestLedger;
  readonly #asks: AskLedger;
  readonly #wakes: WakeCapture;
  readonly #turns: TurnRunner;
  readonly #children: ChildRuns;
  readonly #maintenance: Maintenance;
  #turnsQueued = 0;
  #restored: Promise<void> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #stopped = false;
  #unsubscribeStore: (() => void) | undefined;
  #incompatibleReported: string | undefined;
  readonly #runEventsScope: Scope.CloseableScope = Effect.runSync(Scope.make());
  readonly #runEventsPubSub: PubSub.PubSub<BrainRunEvent> = Effect.runSync(PubSub.unbounded());

  /**
   * What every turn tells as it goes, whichever kind opened it. A recorded
   * run's moments — its slow step, its actions settling, its reply a sentence
   * at a time, its record's end — come in that order for a host relaying the
   * run into a live conversation, and only for recorded runs. Around them,
   * every turn tells its start, each tool call before and after it runs, each
   * reasoning item, each message it completed, each compaction it folded, and
   * its end, each event stamped with the conversation, the turn, and its
   * place in the turn's sequence. A listener that throws ends no turn.
   *
   * Published from `#fireRunEvent` into `#runEventsPubSub` and read out here
   * as the `Event` every subscriber already holds, bridged by
   * `eventFromStream`; the bridge's own daemon pump is what keeps the
   * delivery order and the mid-round-subscribe rule an `Emitter` guaranteed.
   *
   * Building that bridge is a run outside a runtime edge, on the
   * `docs/adr/0001-effect.md` allowlist on the same terms as this file's
   * other seams: every subscriber here still holds a plain `Event`, not a
   * `Stream`, so the bridge is built once, synchronously, over a scope this
   * agent owns and closes in `stop()`. P5-14 deletes it once a turn runs on
   * a fiber of the agent's own and a subscriber can read the stream directly.
   */
  readonly onRunEvent: Event<BrainRunEvent> = Effect.runSync(
    Effect.provideService(
      eventFromStream(Stream.fromPubSub(this.#runEventsPubSub)),
      Scope.Scope,
      this.#runEventsScope,
    ),
  );

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
    this.#lease = options.store.lease();
    this.#ledger = new BrainRequestLedger({
      store: options.store,
      lease: this.#lease,
      now: this.#now,
      report: this.#report,
      notify: () => this.#asks.notify(),
      // A record's end is numbered in the turn it rode in; one that never
      // opened a turn — cancelled while queued, refused at the door — is a
      // turn of its own with this one event.
      runEnded: (record) => {
        const events =
          this.#turns.takeEvents(record.runId) ??
          new TurnEvents({
            conversationId: options.conversationId,
            turnId: record.runId,
            fire: (event) => this.#fireRunEvent(event),
            createMessageId: options.createRunId,
            now: this.#now,
          });
        events.recordEnded(record);
      },
    });
    const seam: AgentSeam = {
      now: this.#now,
      schedule: this.#schedule,
      cancel: this.#cancel,
      report: this.#report,
      ledger: this.#ledger,
      generation: () => this.#generation,
      stopped: () => this.#stopped,
      ready: () => this.ready(),
      expireIfDue: () => this.#expireIfDue(),
      reportIncompatible: (generation, reason) => this.#reportIncompatible(generation, reason),
      runRevoked: (run) => this.#runRevoked(run),
      queueTurn: (trigger, work) => this.#queueTurn(trigger, work),
      enqueue: (work) => this.#enqueue(work),
    };
    this.#maintenance = new Maintenance({
      seam,
      runtime: options.runtime,
      prepareTurn: options.prepareTurn,
      ...(options.memory ? { memory: options.memory } : undefined),
      ...(options.flushMarker ? { flushMarker: options.flushMarker } : undefined),
      holdTurnInFlight: (held) => this.#turns.holdInFlight(held),
    });
    this.#turns = new TurnRunner({
      seam,
      conversationId: options.conversationId,
      runtime: options.runtime,
      actions: options.actions,
      roster: options.roster,
      standingContext: options.standingContext,
      prepareTurn: options.prepareTurn,
      readTranscriptSince: options.readTranscriptSince,
      readTranscript: options.readTranscript,
      deliver: options.deliver,
      ...(options.notice ? { notice: options.notice } : undefined),
      onRunEvent: (event) => this.#fireRunEvent(event),
      ...(options.trace ? { trace: options.trace } : undefined),
      ...(options.openingNotes ? { openingNotes: options.openingNotes } : undefined),
      ...(options.workspace ? { workspace: options.workspace } : undefined),
      ...(options.children ? { children: options.children } : undefined),
      ...(options.memory ? { memory: options.memory } : undefined),
      ...(options.inheritedContext ? { inheritedContext: options.inheritedContext } : undefined),
      ...(options.child ? { child: options.child } : undefined),
      createRunId: options.createRunId,
      maximumOutputTokens: options.maximumOutputTokens ?? BRAIN_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : undefined),
      ...(options.promptCacheKey !== undefined
        ? { promptCacheKey: options.promptCacheKey }
        : undefined),
      executionDeadlineMs: options.executionDeadlineMs ?? BRAIN_DEFAULTS.EXECUTION_DEADLINE_MS,
      compactIfNeeded: (turnContext, prompt, countedTokens) =>
        this.#maintenance.compactIfNeeded(turnContext, prompt, countedTokens),
      scheduleMaintenance: (turnContext, countedTokens) =>
        this.#maintenance.schedule(turnContext, countedTokens),
      opensAsk: (run) => this.#asks.opens(run),
      forgetRun: (runId) => this.#asks.forget(runId),
      notifyRecords: () => this.#asks.notify(),
      flushAskQueue: () => this.#asks.flushQueue(),
    });
    this.#asks = new AskLedger({
      seam,
      store: options.store,
      createRunId: options.createRunId,
      runAsk: (inputs) => this.#queueTurn(BRAIN_TURN_TRIGGER.ASK, () => this.#turns.runAsk(inputs)),
      active: () => this.#turns.active(),
      disarmWakes: () => this.#wakes.take(),
      cancelMaintenance: () => this.#maintenance.cancel(),
    });
    this.#wakes = new WakeCapture({
      seam,
      subject: options.observes,
      roster: options.roster,
      readTranscriptSince: options.readTranscriptSince,
      createRunId: options.createRunId,
      quietUntil: () => options.runtime.quietUntil(),
      turnInFlight: () => this.#turns.inFlight(),
      turn: (plan) => this.#turns.turn(plan),
    });
    this.#children = new ChildRuns({
      seam,
      submit: (submission) => this.submitAsk(submission),
      records: () => this.requests(),
      record: (runId) => this.request(runId),
      wait: (runId, timeoutMs) => this.waitAsk(runId, timeoutMs),
      cancel: (runId) => this.cancelAsk(runId),
      active: () => this.#turns.active(),
      turn: (plan) => this.#turns.turn(plan),
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
      this.#turns.inFlight() ||
      this.#turnsQueued > 0 ||
      this.#wakes.capturesInFlight() > 0 ||
      this.#turns.active() !== undefined ||
      this.#asks.size() > 0 ||
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
    return this.#asks.records();
  }

  request(runId: string): BrainRequestRecord | undefined {
    return this.#asks.record(runId);
  }

  /** Hears the whole list on every change to any record. */
  subscribe(listener: BrainRequestsListener): () => void {
    return this.#asks.subscribe(listener);
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
   * A spoken ask is this same submission under the spoken origin, with the
   * submission id its relay minted: that origin is what prepares its turn
   * under the backend preamble, and it needs no entry of its own.
   */
  async submitAsk(submission: BrainSubmission): Promise<BrainSubmissionResult> {
    await this.ready();
    return this.#asks.submit(submission);
  }

  /**
   * Answers the record once the run ends, or as it stands when the wait runs
   * out first. A wait that runs out changes nothing about the run, and a run
   * this generation does not know answers nothing.
   */
  async waitAsk(runId: string, timeoutMs: number): Promise<BrainRequestRecord | undefined> {
    await this.ready();
    return this.#asks.wait(runId, timeoutMs);
  }

  /**
   * Cancels a run: a queued one never starts, a running one has its model and
   * read work aborted and every action not yet dispatched refused. An action whose
   * effect is already under way is neither retried nor aborted — its result
   * is kept, known or unknown — because cancelling cannot undo a message
   * already sent.
   */
  async cancelAsk(runId: string): Promise<BrainRequestRecord | undefined> {
    await this.ready();
    return this.#asks.cancel(runId);
  }

  /**
   * Marks a run's end as written into the host's thread, so a later report,
   * a rebuilt follower, or the next launch never writes it a second time. The
   * host calls this only after its own write succeeded, and the mark stands
   * only once it is itself written: a mark the store refused is not held in
   * memory either, so the next report tries the whole step again.
   */
  markConversationRecorded(runId: string, recordedAt: number): Promise<boolean> {
    return this.#mark(runId, PENDING_MARK_FIELD.CONVERSATION_RECORDED_AT, recordedAt);
  }

  /** Marks a run's own ask as written into a host's thread, on the same terms; the desktop's host writes no ask line and never calls it. */
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
   * window; settles once the capture has landed or been refused.
   */
  wake(events: readonly BrainWakeEvent[]): Promise<void> {
    return this.#wakes.wake(events);
  }

  /** One look at the whole roster, driven by the host's observation pass rather than an internal timer. */
  rosterLook(): Promise<void> {
    return this.#wakes.rosterLook();
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
      this.#turns.turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED,
        deliveries: new SteeredDeliveries(),
        events: inboxEvents(generation.inbox),
        open: (attached: readonly BrainWakeEvent[], now: number) => [
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
   * run.
   */
  runChildTask(
    task: string,
    childRunId: string,
  ): Promise<{ readonly runId: string; readonly done: Promise<ChildEnd> } | undefined> {
    return this.#children.runTask(task, childRunId);
  }

  /** The end of a child run this conversation already holds, or nothing when no run stands for the id. */
  adoptChildRun(childRunId: string): Promise<ChildEnd | undefined> {
    return this.#children.adopt(childRunId);
  }

  /** Cancels the run named as a child's, answering only once the run has actually ended. */
  cancelChildRun(childRunId: string): Promise<boolean> {
    return this.#children.cancelRun(childRunId);
  }

  /** A child's completion, handed to this conversation as the one that asked for it. */
  deliverChildCompletion(
    completion: ChildCompletionRecord,
    record: ChildRunRecord,
  ): Promise<BrainCompletionDelivery> {
    return this.#children.deliver(completion, record);
  }

  /**
   * Revokes every execution at once and takes nothing more: the generation's
   * signal fires, so every wait the agent holds — a model answer, a
   * transcript read, a run's own action preparation — settles, and the queue
   * drains behind it. Unfinished runs are recorded as interrupted: the agent
   * stopping — a key or account changing, the app quitting — is not the
   * developer's cancel, and the record says which. Synchronous up to the
   * revocation, so a host can withdraw the old agent's standing before its
   * first await of a transition.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#maintenance.cancel();
    this.#wakes.clear();
    const waiting = this.#asks.takeWaiting();
    this.#unsubscribeStore?.();
    this.#unsubscribeStore = undefined;
    this.#generation?.abort.abort();
    this.#asks.abortAll();
    // An acceptance whose write is still out settles before the stop does:
    // its caller hears the durable answer, its run is recorded interrupted,
    // and nothing of it is left to land on the agent that comes next.
    await this.#asks.drainPendingSubmissions();
    await this.#asks.settleWaiting(waiting);
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
    // Closing this scope interrupts the bridge's daemon pump, which may be
    // suspended waiting on the pubsub; that interruption is not guaranteed
    // to settle synchronously, so the close runs to a promise here rather
    // than with runSync.
    await Effect.runPromise(Scope.close(this.#runEventsScope, Exit.void));
  }

  #fireRunEvent(event: BrainRunEvent): void {
    Effect.runSync(PubSub.publish(this.#runEventsPubSub, event));
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

  /** Queues a turn behind this conversation's own, and runs it under the host's lane for its trigger. */
  #queueTurn<T>(trigger: BrainTurnTrigger, work: () => Promise<T>): Promise<T> {
    const lane = this.#options.lane;
    return this.#enqueue(() => (lane ? lane(trigger, work) : work()));
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

  #generationFrom(state: BrainPersistedState): Generation {
    return generationFrom(state, this.#options.runtime, UNKNOWN_ACTION_RESULT, this.#now);
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
    this.#wakes.armInbox(generation);
    if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
      this.#reportIncompatible(generation, opened.reason);
    }
    const interrupted = interruptedUnfinishedRequests(state.requests, this.#now());
    // An action found started with no result may have happened: the runtime's
    // context paired it as unknown at load, and the interrupted run says so
    // in its count; neither is ever a call to make again.
    const repaired = opened.kind === CONTEXT_OPENING.LOADED ? opened.repaired : 0;
    // A journal row under a run no record names is what an observation turn
    // that died mid-action left behind. Its result already stands in the context,
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
    // An interrupted run's accounting is what its journal established: actions
    // whose result was accepted went through, actions whose result says unknown
    // or never arrived may have. Counted from the journal alone, so a copy
    // taken mid-run and a copy taken after it both say the same.
    generation.requests = new Map(
      interrupted.map((record) => [
        record.runId,
        unfinished.has(record.runId)
          ? { ...record, ...journalActionCounts(state.journal, record.runId) }
          : record,
      ]),
    );
    await this.#ledger.restored(
      generation,
      opened.kind === CONTEXT_OPENING.LOADED ? opened.context : undefined,
    );
    this.#asks.notify();
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
    this.#maintenance.cancel();
    // Asks that only ever waited belong to the memory being replaced: nothing
    // opens for them, and each record ends as the replacement leaves it.
    void this.#asks.settleWaiting(this.#asks.takeWaiting());
    previous?.abort.abort();
    this.#asks.revokeAll();
    if (previous) retireOpenedContext(previous);
    // Wakes coalesced against the old memory — including a quiet retry's —
    // are that generation's work, and go with it.
    this.#wakes.clear();
    this.#generation = this.#generationFrom(state);
    this.#wakes.armInbox(this.#generation);
    this.#asks.notify();
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
}
