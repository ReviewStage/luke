import type { ChildEnd, ChildPolicyContext } from "@sidecar/runtime";
import type {
  AgentRuntimeEffect,
  ChildCompletionRecord,
  ChildRunRecord,
  ExecutionRuntime,
  MemoryDefinition,
  ModelAdapter,
  ReasoningEffort,
  SessionKey,
} from "@sidecar/runtime/vocabulary";
import type {
  ProviderTranscriptResult,
  ProviderTranscriptSinceResult,
  SessionIdentity,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import {
  type Clock,
  Duration,
  Effect,
  Either,
  Exit,
  FiberId,
  PubSub,
  Runtime,
  Scope,
  Stream,
} from "effect";
import { AskLedger, type BrainRequestsListener } from "./asks.js";
import { type BrainCompletionDelivery, ChildRuns } from "./children.js";
import { BRAIN_DEFAULTS } from "./defaults.js";
import { type Detach, detachOn } from "./effect/carry.js";
import { joinedOnce } from "./effect/once.js";
import {
  type BrainPersistedState,
  type BrainStoreLease,
  brainGenerationExpired,
} from "./envelope.js";
import {
  CONTEXT_OPENING,
  type Generation,
  generationFrom,
  retireGeneration,
} from "./generation.js";
import { GENERATION_ADOPTION, GenerationHolder } from "./generation-holder.js";
import { holdReleasedInputText, wakeInputText } from "./input-items.js";
import { journalActionCounts, UNKNOWN_ACTION_RESULT } from "./journal.js";
import { BrainRequestLedger, PENDING_MARK_FIELD, type PendingMarkField } from "./ledger.js";
import { type BrainFlushMarkerStore, Maintenance } from "./maintenance.js";
import { inboxEvents } from "./observation-inbox.js";
import type { BrainActionPerformer, BrainRoster } from "./performer.js";
import {
  type BrainAnticipation,
  type BrainAnticipationFacts,
  PREFETCH_BOUNDS,
  ReadPrefetch,
} from "./read-prefetch.js";
import {
  BRAIN_REQUEST_ORIGIN,
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
import { brainToolCatalog, planReadsToolSchema, resolveTurnToolPolicy } from "./tools.js";
import type { BrainPrefetchTraceRecord, BrainTurnTraceRecord } from "./trace.js";
import { readWholeTranscript } from "./transcript-reads.js";
import {
  BRAIN_TURN_KIND,
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

/**
 * The read prefetch's own seams: the small model its planner and summary run
 * on, and where its moments are traced. Handed to main's conversation alone,
 * because a spoken ask reaches main.
 */
interface BrainPrefetchOptions {
  model: ModelAdapter;
  trace?: (record: BrainPrefetchTraceRecord) => void;
}

/** Runs a turn's work under the host's lane for its trigger, so conversations share the lanes' budgets and nothing wider. */
type BrainLane = <A>(trigger: BrainTurnTrigger, work: Effect.Effect<A>) => Effect.Effect<A>;

export interface BrainAgentOptions {
  /** The conversation this agent is: the key every run event names, which is the conversation's id in this build. */
  conversationId: SessionKey;
  /** The execution the host runs turns on; it decides how a model and its tools loop, and it alone reaches the model. */
  runtime: AgentRuntimeEffect;
  /**
   * The runtime every turn of this conversation is a fiber of, so a cancel, a
   * deadline, and the generation's replacement all reach a turn's waits as
   * that fiber's interruption. The host's own where it has one.
   */
  execution?: ExecutionRuntime;
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
  ) => Effect.Effect<ProviderTranscriptSinceResult>;
  readTranscript: (identity: SessionIdentity) => Effect.Effect<ProviderTranscriptResult>;
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
   * The read prefetch: a small model that, handed the developer's words so
   * far, names the reads a spoken ask's turn will need and begins them before
   * the ask is finished. Absent, nothing is anticipated and every turn reads
   * for itself.
   */
  prefetch?: BrainPrefetchOptions;
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
 * The brain: one long-lived agent that is woken by the host's edges for its
 * session and by its own look at the roster, asked things by the developer, and
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
  /**
   * The `Clock` this conversation keeps its own time on: every instant it
   * stamps and every wait it arms is read from this one, so an agent built
   * under a `TestClock` never stamps one clock and sleeps on another.
   */
  readonly #clock: Clock.Clock;
  /** The scope every wait this conversation arms is forked into, closed by `stop()`. */
  readonly #scope: Scope.CloseableScope;
  readonly #now: () => number;
  readonly #report: (message: string) => void;
  readonly #detached: Detach;
  readonly #execution: ExecutionRuntime;
  readonly #generations = new GenerationHolder();
  readonly #lease: BrainStoreLease;
  readonly #ledger: BrainRequestLedger;
  readonly #asks: AskLedger;
  readonly #wakes: WakeCapture;
  readonly #turns: TurnRunner;
  readonly #children: ChildRuns;
  readonly #maintenance: Maintenance;
  readonly #prefetch: ReadPrefetch | undefined;
  #turnsQueued = 0;
  #restored: Effect.Effect<void> | undefined;
  /**
   * The conversation's serial queue: one permit, taken for the whole of a
   * turn and handed to the waiters in the order they asked, so the turns of
   * one conversation never overlap however many edges opened them.
   */
  readonly #serial = Effect.unsafeMakeSemaphore(1);
  #stopped = false;
  #unsubscribeStore: (() => void) | undefined;
  #incompatibleReported: string | undefined;
  readonly #runEvents: PubSub.PubSub<BrainRunEvent>;

  /**
   * What every turn tells as it goes, whichever kind opened it. A recorded
   * run's moments — its slow step, its actions settling, its reply a sentence
   * at a time, its record's end — come in that order for a host relaying the
   * run into a live conversation, and only for recorded runs. Around them,
   * every turn tells its start, each tool call before and after it runs, each
   * reasoning item, each message it completed, each compaction it folded, and
   * its end, each event stamped with the conversation, the turn, and its
   * place in the turn's sequence.
   *
   * The stream itself: a subscriber yields this in a scope of its own, which
   * takes the subscription on that subscriber's own fiber, and then reads it
   * however it likes — `Stream.runForEach` on a fiber of the same scope is
   * what the live brain adapter does. Closing that scope is the whole of the
   * unsubscribe, so no subscription outlives its reader and nothing here
   * needs a scope of the agent's own; stopping the agent shuts the pubsub
   * down instead, which ends every reader whether or not it unsubscribed.
   * What a reader does with a listener that throws is its own decision — the
   * adapter logs the defect and carries on, because a fan-out the agent
   * cannot see is not a failure the agent can rule on.
   */
  readonly runEvents: Effect.Effect<Stream.Stream<BrainRunEvent>, never, Scope.Scope>;

  /**
   * The agent as an effect: everything of it is built synchronously except
   * the three things only a fiber can hand it — the pubsub its run events are
   * published into, the `Clock` this conversation reads every instant and
   * arms every wait on, and the scope those waits are forked into. A host
   * yields one where it built one before, and nothing in the class runs an
   * effect of its own.
   */
  static make(options: BrainAgentOptions): Effect.Effect<BrainAgent> {
    return Effect.gen(function* () {
      const runEvents = yield* PubSub.unbounded<BrainRunEvent>();
      const clock = yield* Effect.clock;
      const scope = yield* Scope.make();
      return new BrainAgent(options, runEvents, clock, scope);
    });
  }

  private constructor(
    options: BrainAgentOptions,
    runEvents: PubSub.PubSub<BrainRunEvent>,
    clock: Clock.Clock,
    scope: Scope.CloseableScope,
  ) {
    this.#options = options;
    this.#runEvents = runEvents;
    this.runEvents = Stream.fromPubSub(runEvents, { scoped: true });
    this.#clock = clock;
    this.#scope = scope;
    this.#now = () => clock.unsafeCurrentTimeMillis();
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
    this.#execution = options.execution ?? Runtime.defaultRuntime;
    this.#detached = detachOn(this.#execution);
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
      detach: (work) => this.#detach(work),
      arm: (delayMs, work) => this.#arm(delayMs, work),
      report: this.#report,
      ledger: this.#ledger,
      generation: () => this.#generations.standing(),
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
    this.#prefetch = options.prefetch
      ? new ReadPrefetch(
          {
            model: options.prefetch.model,
            conversationId: options.conversationId,
            roster: options.roster,
            readTranscript: (identity, signal) =>
              readWholeTranscript(identity, {
                read: (session) => options.readTranscript(session),
                signal,
                maximumChars: PREFETCH_BOUNDS.TRANSCRIPT_CHARS,
              }),
            // The policy a spoken ask's turn would resolve, resolved the same
            // way ahead of it, so a denied read is never begun.
            policy: async () => {
              const preparation = await options.prepareTurn({
                kind: BRAIN_TURN_KIND.TURN,
                trigger: BRAIN_TURN_TRIGGER.ASK,
                askOrigin: BRAIN_REQUEST_ORIGIN.SPOKEN,
              });
              return resolveTurnToolPolicy(
                preparation.catalog ?? brainToolCatalog(),
                preparation.layers,
                BRAIN_TURN_TRIGGER.ASK,
                options.child,
              );
            },
            ...(options.memory ? { memory: options.memory } : undefined),
            now: this.#now,
            createId: options.createRunId,
            report: this.#report,
            ...(options.prefetch.trace ? { trace: options.prefetch.trace } : undefined),
          },
          planReadsToolSchema(),
        )
      : undefined;
    this.#turns = new TurnRunner({
      seam,
      conversationId: options.conversationId,
      ...(this.#prefetch ? { prefetch: this.#prefetch } : undefined),
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
      runAsk: (inputs) =>
        this.#detach(this.#queueTurn(BRAIN_TURN_TRIGGER.ASK, this.#turns.runAsk(inputs))),
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
    return this.#generations.standing()?.inbox.length ?? this.#wakes.size();
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
      (this.#generations.standing()?.inbox.length ?? 0) > 0 ||
      this.#wakes.size() > 0
    );
  }

  /**
   * Settles once the stored state has been read: the last launch's unfinished
   * runs marked interrupted, dangling calls paired, and both checkpointed.
   * Every entry point awaits this itself; a host that wants the records
   * before its first ask awaits it here.
   */
  ready(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#restored ??= joinedOnce(this.#restore());
      return this.#restored;
    });
  }

  /**
   * Why the standing generation cannot open a turn, when it cannot: its
   * checkpoint was written by a runtime other than the one this agent runs.
   * The checkpoint, the requests, and the journal are all kept as they are;
   * the way forward is a runtime that reads them or a Clear.
   */
  incompatibility(): Effect.Effect<string | undefined> {
    return Effect.gen(this, function* () {
      yield* this.ready();
      const generation = this.#generations.standing();
      if (!generation) return undefined;
      const opened = yield* generation.opened;
      return opened.kind === CONTEXT_OPENING.INCOMPATIBLE ? opened.reason : undefined;
    });
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
  submitAsk(submission: BrainSubmission): Effect.Effect<BrainSubmissionResult> {
    return Effect.gen(this, function* () {
      yield* this.ready();
      return yield* this.#asks.submit(submission);
    });
  }

  /**
   * The developer's ask as far as it has been said, for the reads its turn
   * will need to begin now. Nothing is recorded and nothing is promised: the
   * spoken ask that follows takes what was read, or it expires.
   */
  anticipateAsk(anticipation: BrainAnticipation): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#stopped) return Effect.void;
      return this.#prefetch?.anticipate(anticipation) ?? Effect.void;
    });
  }

  /** Whatever was read ahead is forgotten: the session that was speaking is gone. */
  dropAnticipation(): void {
    this.#prefetch?.drop();
  }

  /** Hears the summary of each read made ahead, for the voice to be handed as data; nothing without a prefetch. */
  onAnticipationFacts(listener: (facts: BrainAnticipationFacts) => void): () => void {
    return this.#prefetch?.onFacts(listener) ?? (() => undefined);
  }

  /**
   * Answers the record once the run ends, or as it stands when the wait runs
   * out first. A wait that runs out changes nothing about the run, and a run
   * this generation does not know answers nothing.
   */
  waitAsk(runId: string, timeoutMs: number): Effect.Effect<BrainRequestRecord | undefined> {
    return Effect.gen(this, function* () {
      yield* this.ready();
      return yield* Effect.promise(() => this.#asks.wait(runId, timeoutMs));
    });
  }

  /**
   * Cancels a run: a queued one never starts, a running one has its model and
   * read work aborted and every action not yet dispatched refused. An action whose
   * effect is already under way is neither retried nor aborted — its result
   * is kept, known or unknown — because cancelling cannot undo a message
   * already sent.
   */
  cancelAsk(runId: string): Effect.Effect<BrainRequestRecord | undefined> {
    return Effect.gen(this, function* () {
      yield* this.ready();
      return yield* Effect.promise(() => this.#asks.cancel(runId));
    });
  }

  /**
   * Marks a run's end as written into the host's thread, so a later report,
   * a rebuilt follower, or the next launch never writes it a second time. The
   * host calls this only after its own write succeeded, and the mark stands
   * only once it is itself written: a mark the store refused is not held in
   * memory either, so the next report tries the whole step again.
   */
  markConversationRecorded(runId: string, recordedAt: number): Effect.Effect<boolean> {
    return this.#mark(runId, PENDING_MARK_FIELD.CONVERSATION_RECORDED_AT, recordedAt);
  }

  /** Marks a run's own ask as written into a host's thread, on the same terms; the desktop's host writes no ask line and never calls it. */
  markAskRecorded(runId: string, recordedAt: number): Effect.Effect<boolean> {
    return this.#mark(runId, PENDING_MARK_FIELD.ASK_RECORDED_AT, recordedAt);
  }

  #mark(runId: string, field: PendingMarkField, recordedAt: number): Effect.Effect<boolean> {
    return Effect.gen(this, function* () {
      yield* this.ready();
      const generation = this.#generations.standing();
      if (!generation) return false;
      return yield* Effect.promise(() => this.#ledger.mark(generation, runId, field, recordedAt));
    });
  }

  /**
   * Captures wake events into the durable inbox and arms the coalescing
   * window; ends once the capture has landed or been refused. The host runs
   * it on its own runtime, so the capture is a fiber of the same runtime
   * every turn of this conversation is one of.
   */
  wake(events: readonly BrainWakeEvent[]): Effect.Effect<void> {
    return this.#wakes.wake(events);
  }

  /** One look at the whole roster, driven by the host's observation pass rather than an internal timer. */
  rosterLook(): Effect.Effect<void> {
    return this.#wakes.rosterLook();
  }

  /**
   * Hands back briefings the host held while a meeting or a pause stood, for
   * one re-decision against the roster as it now stands. Pending wakes open
   * in the same turn, ahead of the held briefings, so the decision is made
   * knowing everything that happened during the hold.
   */
  releaseHeld(held: readonly BrainDelivery[]): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      if (this.#stopped || held.length === 0) return;
      const generation = this.#generations.standing();
      if (!generation) {
        // The state is still loading: the briefings wait for the generation
        // they will be re-decided in.
        yield* this.ready();
        return yield* this.releaseHeld(held);
      }
      this.#wakes.take();
      // Detached rather than forked: the turn must be counted queued and
      // standing in line for the permit before this returns, or a stop that
      // followed it could drain a queue the turn had not yet joined.
      this.#detach(
        this.#queueTurn(
          BRAIN_TURN_TRIGGER.HOLD_RELEASED,
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
        ),
      );
    });
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
  ): Effect.Effect<{ readonly runId: string; readonly done: Effect.Effect<ChildEnd> } | undefined> {
    return this.#children.runTask(task, childRunId);
  }

  /** The end of a child run this conversation already holds, or nothing when no run stands for the id. */
  adoptChildRun(childRunId: string): Effect.Effect<ChildEnd | undefined> {
    return this.#children.adopt(childRunId);
  }

  /** Cancels the run named as a child's, answering only once the run has actually ended. */
  cancelChildRun(childRunId: string): Effect.Effect<boolean> {
    return this.#children.cancelRun(childRunId);
  }

  /** A child's completion, handed to this conversation as the one that asked for it. */
  deliverChildCompletion(
    completion: ChildCompletionRecord,
    record: ChildRunRecord,
  ): Effect.Effect<BrainCompletionDelivery> {
    return this.#children.deliver(completion, record);
  }

  /**
   * Revokes every execution at once and takes nothing more: the generation's
   * signal fires, so every wait the agent holds — a model answer, a
   * transcript read, a run's own action preparation — settles, and the queue
   * drains behind it. Unfinished runs are recorded as interrupted: the agent
   * stopping — a key or account changing, the app quitting — is not the
   * developer's cancel, and the record says which. Revoking is the whole of its
   * synchronous head, so a host running this withdraws the old agent's
   * standing before the effect suspends for the first time.
   */
  stop(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      this.#stopped = true;
      this.#maintenance.cancel();
      this.#wakes.clear();
      const waiting = this.#asks.takeWaiting();
      this.#unsubscribeStore?.();
      this.#unsubscribeStore = undefined;
      this.#generations.standing()?.abort.abort();
      this.#asks.abortAll();
      this.#prefetch?.drop();
      // An acceptance whose write is still out settles before the stop does:
      // its caller hears the durable answer, its run is recorded interrupted,
      // and nothing of it is left to land on the agent that comes next.
      yield* Effect.promise(() => this.#asks.drainPendingSubmissions());
      yield* Effect.promise(() => this.#asks.settleWaiting(waiting));
      const generation = this.#generations.standing();
      if (generation) {
        for (const record of this.requests()) {
          if (record.status === BRAIN_REQUEST_STATUS.QUEUED) {
            yield* Effect.promise(() =>
              this.#ledger.settleRun(
                generation,
                record.runId,
                BRAIN_REQUEST_STATUS.INTERRUPTED,
                {},
              ),
            );
          }
        }
      }
      // The queue is drained by taking its one permit: every turn already
      // queued stands ahead of this in the order it always did.
      yield* this.#serial.withPermits(1)(Effect.void);
      const retiring = this.#generations.standing();
      if (retiring) retireGeneration(retiring);
      // Shutting the pubsub down ends every `Stream.fromPubSub` pump this agent
      // ever forked, whether or not its subscriber ever called the unsubscribe
      // it was handed back: a retired agent's followers stop hearing rather
      // than parking a fiber for the rest of the process.
      yield* PubSub.shutdown(this.#runEvents);
      // Every wait still outstanding is answered the record as it stands
      // before the scope that carries its timer closes under it: the wake
      // window and the ask queue's debounce were disarmed above, and a wait
      // whose fiber is interrupted with nothing to answer would leave its
      // caller holding a promise nothing resolves.
      this.#asks.notify();
      // Closing the scope interrupts every wait still armed on this
      // conversation's clock, so nothing left over fires into a conversation
      // that is gone.
      yield* Scope.close(this.#scope, Exit.void);
    });
  }

  #fireRunEvent(event: BrainRunEvent): void {
    this.#runEvents.unsafeOffer(event);
  }

  /**
   * A copy of the conversation's context items as they stand, for the host's
   * reset capture; nothing when no context is loaded. The engine itself is
   * never handed out.
   */
  contextSnapshot(): Effect.Effect<readonly WireRecord[] | undefined> {
    return Effect.gen(this, function* () {
      const generation = this.#generations.standing();
      if (!generation) return undefined;
      const standing = yield* generation.opened;
      if (standing.kind !== CONTEXT_OPENING.LOADED) return undefined;
      return [...standing.context.checkpoint().items];
    });
  }

  /** Queues a turn behind this conversation's own, and runs it under the host's lane for its trigger. */
  #queueTurn<A>(trigger: BrainTurnTrigger, work: Effect.Effect<A>): Effect.Effect<A> {
    const lane = this.#options.lane;
    return this.#enqueue(lane ? lane(trigger, work) : work);
  }

  /**
   * The conversation's serial queue. A turn is counted queued from the moment
   * its fiber asks for the permit until it has given the permit back, so
   * `busy()` answers for what waits as well as for what runs, and the count is
   * given back however the turn ends, interruption included.
   */
  #enqueue<A>(work: Effect.Effect<A>): Effect.Effect<A> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        this.#turnsQueued += 1;
      }),
      () => this.#serial.withPermits(1)(work),
      () =>
        Effect.sync(() => {
          this.#turnsQueued -= 1;
        }),
    );
  }

  /**
   * Runs one of this conversation's effects on a fiber of its own, beginning
   * it before this returns. Every turn nobody waits for goes through here —
   * the ask ledger's drain, the wake window's flush and its roster look, the
   * housekeeping a settled turn leaves behind, and a hold's release — because
   * `detachOn` starts the work on the calling stack: `#enqueue`'s own
   * acquisition is the fiber's first step, so the turn takes its place in the
   * conversation's queue, and is counted busy, in the same step that asked for
   * it. `Effect.forkDaemon` would only schedule the fiber, and a stop or a
   * host reading `busy()` between the fork and the scheduler task would find a
   * queue the turn had not yet joined. The fiber is dropped rather than held:
   * what the conversation is drained by is the queue, which this turn is
   * already counted in, and a defect nobody is left to observe is logged as
   * the fiber's own unhandled error rather than thrown into a promise nobody
   * holds.
   */
  #detach(work: Effect.Effect<unknown>): void {
    this.#detached(work);
  }

  /**
   * Arms a wait of `delayMs` on this conversation's own clock — the wake
   * window and the ask ledger's wait are the two that take one — and answers
   * the disarm. It goes through the same detach door every turn nobody waits
   * for does, because only a run gives a synchronous collaborator a fiber at
   * all; unlike a turn, nothing of a wait has to stand in the step that armed
   * it, since its first step is the sleep. The fiber is forked into the
   * agent's own scope, so a wait nobody disarmed ends when `stop()` closes
   * that scope rather than firing into a conversation that is gone, and the
   * sleep is the agent's `Clock`'s own rather than the calling fiber's, so a
   * wait is out exactly when the instants this conversation stamps say it is.
   */
  #arm(delayMs: number, work: Effect.Effect<void>): () => void {
    const fiber = this.#detached(
      Effect.andThen(this.#clock.sleep(Duration.millis(delayMs)), work),
      { scope: this.#scope },
    );
    return () => {
      fiber.unsafeInterruptAsFork(FiberId.none);
    };
  }

  #generationFrom(state: BrainPersistedState): Generation {
    return generationFrom(state, this.#options.runtime, UNKNOWN_ACTION_RESULT, this.#now);
  }

  #restore(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const loaded = yield* Effect.either(
        Effect.tryPromise({ try: () => this.#options.store.load(), catch: (error) => error }),
      );
      if (Either.isLeft(loaded)) {
        this.#report(
          `Brain memory could not be restored: ${loaded.left instanceof Error ? loaded.left.name : "unknown error"}`,
        );
        return;
      }
      // A generation adopted from the store's announcement while the load was
      // out — a Clear or expiry pressed under a starting agent — is the one
      // that stands; the loaded copy is not built over it.
      const current = this.#options.store.current() ?? loaded.right;
      const adoption = this.#generations.adopt(current.generationId, (previous) => {
        if (previous) retireGeneration(previous);
        return this.#generationFrom(current);
      });
      if (adoption.kind === GENERATION_ADOPTION.STANDING) return;
      const generation = adoption.generation;
      const opened = yield* generation.opened;
      if (generation !== this.#generations.standing()) return;
      this.#wakes.armInbox(generation);
      if (opened.kind === CONTEXT_OPENING.INCOMPATIBLE) {
        this.#reportIncompatible(generation, opened.reason);
      }
      const interrupted = interruptedUnfinishedRequests(current.requests, this.#now());
      // An action found started with no result may have happened: the runtime's
      // context paired it as unknown at load, and the interrupted run says so
      // in its count; neither is ever a call to make again.
      const repaired = opened.kind === CONTEXT_OPENING.LOADED ? opened.repaired : 0;
      // A journal row under a run no record names is what an observation turn
      // that died mid-action left behind. Its result already stands in the context,
      // paired at load, and no record waits for its count, so it goes here
      // rather than standing where a later turn's call could be matched to it.
      const recorded = new Set(current.requests.map((record) => record.runId));
      const orphaned = current.journal.filter((entry) => !recorded.has(entry.runId));
      if (orphaned.length > 0) {
        generation.journal.dropRuns(new Set(orphaned.map((entry) => entry.runId)));
      }
      if (interrupted === current.requests && repaired === 0 && orphaned.length === 0) return;
      const unfinished = new Set(
        current.requests
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
            ? { ...record, ...journalActionCounts(current.journal, record.runId) }
            : record,
        ]),
      );
      yield* Effect.promise(() =>
        this.#ledger.restored(
          generation,
          opened.kind === CONTEXT_OPENING.LOADED ? opened.context : undefined,
        ),
      );
      this.#asks.notify();
    });
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
    const adoption = this.#generations.adopt(state.generationId, (previous) => {
      this.#maintenance.cancel();
      // Asks that only ever waited belong to the memory being replaced: nothing
      // opens for them, and each record ends as the replacement leaves it.
      void this.#asks.settleWaiting(this.#asks.takeWaiting());
      if (previous) retireGeneration(previous);
      this.#asks.revokeAll();
      this.#prefetch?.drop();
      // Wakes coalesced against the old memory — including a quiet retry's —
      // are that generation's work, and go with it.
      this.#wakes.clear();
      return this.#generationFrom(state);
    });
    if (adoption.kind === GENERATION_ADOPTION.STANDING) return;
    this.#wakes.armInbox(adoption.generation);
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
    const generation = this.#generations.standing();
    if (this.#stopped || !generation || !brainGenerationExpired(generation, this.#now())) return;
    this.#options.store.expireIfDue(this.#now());
  }

  #runRevoked(run: RunControl): boolean {
    return run.cancelled || run.timedOut || this.#stopped || run.generation.abort.signal.aborted;
  }
}
