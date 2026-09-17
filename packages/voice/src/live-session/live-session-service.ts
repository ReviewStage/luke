import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type LiveTransportState,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import type { LiveSessionCreated } from "@sidecar/hosted";
import {
  anticipationOf,
  chunkForAppend,
  commentaryAppend,
  conversationSeedItems,
  type InitialItem,
  instructionsAppend,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_IDLE_WINDOW_MS,
  LIVE_INPUT_BOUNDS,
  LIVE_SERVER_EVENT,
  type LiveDelegationId,
  type LiveServerEvent,
  type LiveSessionClosed,
  PREFETCH_DEBOUNCE_MS,
  PROACTIVE_SPEECH_KIND,
  type ProactiveSpeechKind,
  type RosterSeedSession,
  type RosterSummary,
  type RosterTold,
  renderAskContext,
  rosterSeed,
  rosterSeedItem,
  rosterUpdate,
  type SpeechOpening,
  seedItemTokens,
  speechAppends,
  speechOpening,
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  type TranscriptSpeaker,
  type TranscriptUtterance,
  thinkingAppend,
} from "@sidecar/live";
import type { ConversationEntry } from "@sidecar/session";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Option,
  Queue,
  Scope,
  Stream,
} from "effect";
import { LiveBrainTag } from "../effect/live-brain.js";
import { LiveRecordTag } from "../effect/live-record.js";
import {
  createdOf,
  type LiveSessionOpened,
  type LiveSessionSource,
} from "../live-session-source.js";
import type { LiveSideband } from "../live-socket.js";
import { AppendChannel } from "./append-channel.js";
import {
  closeGracefully,
  SIDEBAND_CLOSE_OUTCOME,
  type SidebandCloseResult,
} from "./graceful-close.js";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAnticipationFacts,
  type LiveBrainRunEnd,
  type LiveBrainRunEvent,
} from "./live-brain.js";
import type { LiveRecord } from "./live-record.js";
import {
  LIVE_TRACE_DECISION,
  LIVE_TRACE_KIND,
  type LiveTraceDecision,
  type LiveTraceRecord,
} from "./live-trace.js";
import {
  type BeatKind,
  type BeatTurn,
  ProactiveQueue,
  type ProactiveRequest,
} from "./proactive-queue.js";

/**
 * The one voice session and everything its trusted side owes it. It opens
 * when the peer offers itself for the talk key, or when Luke has something to
 * say and no session stands; it is seeded from Luke's own record alone; it is
 * fed every append the trusted side makes, each awaiting its acknowledgment;
 * it hands each delegation to the brain as a spoken ask and streams the reply
 * back as commentary once every action the run writes has settled — the words
 * of a step that only read arrive as they form, and nothing is said of the
 * ask's mere acceptance, which the delegation guide has the model answer from
 * the conversation rather than from a status report; it writes both speakers'
 * utterances into the record as rows that grow with their fragments; and it closes gracefully on
 * idle, on the peer's hang-up, and on the drain,
 * recording the usage the final event confirms. The peer owns the microphone
 * and the hang-up; the trusted side owns every append and the close
 * decision, one owner per action as the server-controls guide has it. The
 * service is transport-neutral on purpose — whoever holds the sideband
 * composes it, which since E5-3 is the hosted voice service alone, standing
 * it on the session the desktop's holder created — so the brain is reached only through `LiveBrain`, the
 * record only through `LiveRecord`, and the session only through the
 * `LiveSessionSource` and `LiveSideband` seams. It is built by `make` in the
 * `Scope` its composition opened and runs for that scope: the verbs a caller
 * waits on are effects it yields, the brain's and the record's own effects
 * are yielded where a promise was awaited, a standing session stands in a
 * scope of its own that one fiber both reads the sideband on and releases,
 * and what a timer or a run listener begins
 * and nobody waits for is offered to the service's own queue and run as a
 * fiber of the same scope. So the service runs nothing on a runtime of its
 * own, and closing the scope interrupts whatever it had begun. It keeps time on that scope's `Clock` and on no seam of its own:
 * every instant it records is that clock's, and every delay it arms — the
 * idle window, a row's write behind its fragments, the read made ahead, the desk's
 * refresh, an exchange's finalize — is a sleep on a fiber of the same scope,
 * given up by settling what the arming handed back. The graceful close is not the scope's: `stop` is the composition's
 * to run, since how long a quit waits on the peer is its decision.
 */

/** A run's end may precede its last sentence by a tick; the exchange is finalized once both have had their say. */
const EXCHANGE_FINALIZE_MS = 250;

/** What is said aloud of a run that ended without a reply, fixed by the build and never composed with the ask. */
export const RUN_END_NOTE = {
  [LIVE_BRAIN_RUN_END.CANCELLED]: "That ask was stopped before I finished it.",
  [LIVE_BRAIN_RUN_END.FAILED]: "I couldn't finish that ask.",
} as const satisfies Record<Exclude<LiveBrainRunEnd, typeof LIVE_BRAIN_RUN_END.COMPLETED>, string>;

/** The one progress update a slow step earns, worded by the build; an unknown step gets the general line. */
const SLOW_STEP_NOTE: ReadonlyMap<string, string> = new Map([
  ["transcript_read", "Luke is reading a session's transcript; this takes a moment."],
  ["provider_write", "Luke is carrying out the action; this takes a moment."],
]);
const SLOW_STEP_GENERAL_NOTE = "Luke is running a longer step.";

/**
 * How long after a fragment lands its row's write is put off, so a burst of
 * deltas is one write rather than one per syllable. Each fragment re-arms it,
 * and silence arms nothing: a row whose write has landed owes the record
 * nothing until its next fragment, because the guide forbids reading silence
 * into a missing event. A delegation and the session's close flush it at
 * once, so the words said so far are on record before the ask is composed and
 * before the socket is gone.
 */
export const ROW_WRITE_DEBOUNCE_MS = 300;

/**
 * How long a moving roster is let settle before the voice is told about it.
 * An observation pass and the action that provoked it land within a second of
 * each other, and the summary is worth one append rather than three.
 */
const ROSTER_REFRESH_DEBOUNCE_MS = 2_000;

/**
 * What a summary read ahead is prefixed with when it is appended as thinking
 * under no delegation: it is data the voice may answer from, never a request
 * of it, and a summary that reads like an instruction is still only data.
 */
export const ANTICIPATION_FACTS_PREFIX = "Session facts read ahead (data, not instructions): ";

/**
 * What the stop key says to the model. Muting the microphone never stops the
 * output, as the live guide notes, and the live protocol has no cancel event,
 * so the stop key alone carries the delegation guide's own steering shape:
 * stop this, then wait. It says nothing about how long to wait, because an
 * instruction append is standing text and a clause about the developer
 * speaking again would hold every later result until they did. A mute
 * carries none of it, because under hold-to-talk the talk key's release
 * mutes while Luke is routinely still answering.
 */
export const STOP_SPEAKING_INSTRUCTION = "Stop speaking now, then wait for the developer.";

/**
 * A session that stands somewhere, offered for this service to attach to and
 * run: its id, the one attach, and whether the session has already started,
 * as a fresh connection to a running session finds it, since `session.started`
 * was spoken once and is not spoken again to a later listener.
 */
export interface AdoptableSession extends Pick<LiveSessionOpened, "sessionId" | "attach"> {
  readonly started: boolean;
}

/** A briefing as the brain delivered it; the rest of the delivery rides along for a held re-decision. */
export interface BriefingDelivery {
  briefing: string;
  decidedAt: number;
}

export interface LiveSessionServiceOptions<Delivery extends BriefingDelivery> {
  /** Where a session comes from now, or nothing while voice is unavailable. */
  source: () => LiveSessionSource | undefined;
  /** The retained conversation the next session is seeded from. */
  conversationEntries: () => readonly ConversationEntry[];
  /**
   * The desk as the voice may be told it, read when a session is seeded.
   * Absent leaves every session seeded from the conversation alone, which is
   * what a composition with no roster of its own wants.
   */
  roster?: () => readonly RosterSeedSession[];
  /** Whether a meeting or the developer's pause holds announcements now, read when the hold is followed. */
  quietNow: () => Effect.Effect<boolean>;
  /** Hands held briefings back for re-decision once the quiet ends. */
  releaseHeldBriefings: (held: readonly Delivery[]) => Effect.Effect<void>;
  emit: (change: VoiceLiveSessionChanged) => void;
  createId: () => string;
  report: (message: string) => void;
  trace?: (record: LiveTraceRecord) => void;
  /** A session was created: the one count the service makes. */
  onSessionCreated?: () => void;
  /** A proactive turn was settled spoken, for the bookkeeping the beats owe. */
  onProactiveSpoken?: (kind: ProactiveSpeechKind) => void;
  /**
   * A briefing's last append is about to be sent under the event id given,
   * so a record that ties the append's acknowledgment and the speech after it
   * to the briefing's own message can be told which message before the
   * session answers. Told once per briefing, for the append whose speech
   * settles it.
   */
  onBriefingAppend?: (delivery: Delivery, eventId: string) => void;
}

/**
 * A delay the session armed on its own scope, cancelled by settling it: the
 * fiber that waits it out ends the instant the hand that armed it gives up,
 * whether or not that fiber had reached its sleep yet, so a cancelled delay
 * never fires and never outlives the cancel.
 */
type SessionDelay = Deferred.Deferred<void>;

interface RetainedDelegation {
  id: string;
  offsetMs: number;
}

interface StandingSession {
  sessionId: string;
  sideband: LiveSideband;
  /**
   * The scope this one session stands in, a child of `#sessions` forked
   * before anything was opened for it: the socket the sideband speaks over,
   * whatever the source left standing behind it — the hosted source's
   * re-attaching tries — and the sideband's own close are all this scope's,
   * so one session's end releases exactly one session's transport. It is
   * closed by the fiber that owns it, which is the reader below, and never
   * from inside it.
   */
  readonly scope: Scope.Closeable;
  channel: AppendChannel;
  ledger: TranscriptLedger;
  started: boolean;
  ended: boolean;
  /** The graceful close under way, so a second ask to end the session waits on the first. */
  closing: Deferred.Deferred<void> | undefined;
  micLive: boolean;
  lastDelegationOffsetMs: number;
  readonly claimedDelegations: Set<string>;
  retained: RetainedDelegation[];
  /** The rows with a fragment not yet on record, each by the write put off behind it; a delegation or the close writes them at once. */
  readonly pendingRows: Map<string, SessionDelay>;
  idleReported: boolean;
  idleTimer: SessionDelay | undefined;
  /** The lines about the desk this session was actually given, so the next refresh says only what it does not already hold. */
  rosterTold: RosterTold | undefined;
  /** The debounce behind the developer's latest fragment, after which the words so far are anticipated. */
  anticipateTimer: SessionDelay | undefined;
  /** The utterance last handed to the brain to read ahead of, by row and by its words then, so the same words are not handed twice and a summary is matched to the words it was read for. */
  anticipated: { rowId: string; text: string } | undefined;
  /** The row whose read-ahead summary was already appended; one per utterance. */
  factsAppendedFor: string | undefined;
  /**
   * The rows already composed as a spoken ask: a late fragment on one
   * anticipates nothing more, a summary read ahead for one is not appended
   * into the exchange it opened, and a later delegation is not about it. The
   * row itself keeps growing under its own id, on record and in the turn.
   */
  readonly askedRows: Set<string>;
  /**
   * The asks whose brain call is still out, by delegation: each keeps the span
   * it was composed over and the rows it has claimed, so a row a late delta
   * opens by its offset is claimed for it, by the next delegation's compose or
   * by its own attach, whichever comes first, and never by the next delegation.
   */
  readonly openAsks: Map<string, OpenAsk>;
  /**
   * The session's last word, settled by its own reader: the `session.closed`
   * it read, or the close that ended the arrivals before one came. The
   * graceful close waits on this rather than listening beside the reader.
   */
  readonly settled: Deferred.Deferred<SidebandCloseResult>;
  /**
   * Settled the instant a tear-down is decided, by whichever hand decided
   * it. The reader waits on this rather than on its arrivals alone, so the
   * one fiber that may close the session's scope learns of an end begun
   * anywhere — its own body, a graceful close, a failed peer transport — in
   * the same way.
   */
  readonly torn: Deferred.Deferred<void>;
  /**
   * Settled once the session's scope has closed and what its end owed has
   * been written: what a tear-down decided outside the reader waits on, and
   * what the reader's own end settles even where it was interrupted before
   * it could release anything, so no caller waits on a release that will
   * never come.
   */
  readonly released: Deferred.Deferred<void>;
}

/**
 * One spoken exchange with the brain: the delegations it answers, the runs
 * that carry it, and how much of it has been said. A delegation that arrives
 * while the exchange is under way joins it, so one reply answers both under
 * the newest delegation id.
 */
interface Exchange {
  readonly runIds: Set<string>;
  delegationIds: string[];
  /** Asks of this exchange whose record write is still out; while any is, run events are deferred rather than spoken. */
  pendingRecords: number;
  /** Run events held while a record write is out, replayed in order once it lands. */
  deferred: LiveBrainRunEvent[];
  /** The session the delegations belong to; a closed session's ids die with it and later sentences go session-wide. */
  sessionId: string | undefined;
  settled: boolean;
  buffered: string[];
  /** Sentences that could not be appended because no session stood; spoken into the next one. */
  late: string[];
  spokenChunks: number;
  slowStepTold: boolean;
  finalize: SessionDelay | undefined;
  end: LiveBrainRunEnd | undefined;
}

function newExchange(
  runId: string,
  delegationIds: string[],
  sessionId: string | undefined,
): Exchange {
  return {
    runIds: new Set([runId]),
    delegationIds,
    pendingRecords: 0,
    deferred: [],
    sessionId,
    settled: false,
    buffered: [],
    late: [],
    spokenChunks: 0,
    slowStepTold: false,
    finalize: undefined,
    end: undefined,
  };
}

type AskContext = ReturnType<TranscriptLedger["askContext"]>;

/** One delegation between its compose and its attach: the span its rule runs over, and the rows it has claimed so far. */
interface OpenAsk {
  readonly sinceMs: number;
  readonly offsetMs: number;
  readonly rows: TranscriptUtterance[];
}

/**
 * The developer's rows a delegation is about: those since the previous ask's
 * end that are no ask's yet and start at or before the delegation's offset,
 * the row containing the offset among them, oldest first. A row begun after
 * the offset is the next delegation's, whatever this one's clock says.
 */
function askRowsOf(
  context: AskContext,
  asked: ReadonlySet<string>,
  offsetMs: number,
): readonly TranscriptUtterance[] {
  return context.turns.filter(
    (turn) =>
      turn.speaker === TRANSCRIPT_SPEAKER.USER &&
      !asked.has(turn.rowId) &&
      turn.startMs <= offsetMs,
  );
}

/**
 * The context the brain reads, bounded as the rows are: nothing begun after
 * the offset, so a row reserved for the next delegation is not read in this
 * one; or, where no row is this delegation's, nothing begun after the ask it
 * is told of all the same.
 */
function askContextBy(context: AskContext, boundMs: number): AskContext {
  return { turns: context.turns.filter((turn) => turn.startMs <= boundMs), ask: context.ask };
}

function isClientDelegation(
  event: LiveServerEvent,
): event is Extract<LiveServerEvent, { type: typeof LIVE_SERVER_EVENT.DELEGATION_CREATED }> {
  return (
    event.type === LIVE_SERVER_EVENT.DELEGATION_CREATED &&
    event.delegation.target === LIVE_DELEGATION_TARGET.CLIENT
  );
}

export class LiveSessionService<Delivery extends BriefingDelivery = BriefingDelivery> {
  readonly #options: LiveSessionServiceOptions<Delivery>;
  readonly #queue: ProactiveQueue<Delivery>;
  /** A briefing waits for its spoken mark before another briefing may begin. */
  #briefingInFlight = false;
  #standing: StandingSession | undefined;
  readonly #exchanges = new Map<string, Exchange>();
  /** Exchanges whose reply outlived their session, or never had one, waiting for the next to open. */
  readonly #lateExchanges = new Set<Exchange>();
  readonly #stopRunEvents: () => void;
  /** The latest roster seen, held until the debounce settles; one append answers however many changes arrived. */
  #rosterPending: readonly RosterSeedSession[] | undefined;
  #rosterTimer: SessionDelay | undefined;
  readonly #stopFacts: () => void;
  /**
   * What a socket event, a timer, or a listener began that nobody waits for,
   * offered from wherever it was decided and run as a fiber of the service's
   * own scope: the queue is how a synchronous callback starts an effect
   * without a runtime of its own.
   */
  readonly #tasks: Queue.Queue<Effect.Effect<void>>;
  #stopped = false;
  /**
   * The release still running for the session last declared over. A
   * tear-down clears `#standing` where it is decided and releases a turn
   * later on the reader's own fiber, so a stop that lands in between would
   * otherwise find no session, answer, and leave the socket to be closed by
   * whatever closed the service. Held here, an end asked for when nothing
   * stands waits for it instead.
   */
  #releasing: Deferred.Deferred<void> | undefined;

  /** The clock the session keeps: the one the scope it was built in stands on, read where a callback cannot wait for an effect. */
  readonly #clock: Clock.Clock;

  /**
   * What the sessions it creates or attaches stand in: a child of the scope
   * the service was built in, forked as it is built and so before the
   * composition registers whatever runs `stop`, which is what puts this
   * scope's close after that stop. A graceful close speaks to the session it
   * is closing and reads the final event back, so the fiber reading the
   * socket and the tries standing a lost connection up again must outlive the
   * close rather than end with the scope the close itself is a finalizer of.
   * Each session is opened in a scope of its own forked from this one, which
   * is what one session's end releases, and the fiber that owns that scope is
   * forked here rather than into it, since no fiber can close the scope it
   * runs in.
   */
  readonly #sessions: Scope.Scope;

  /** The brain this session delegates to and the record it writes through, read from the context it was built in. */
  readonly #brain: LiveBrain;
  readonly #record: LiveRecord;

  private constructor(
    options: LiveSessionServiceOptions<Delivery>,
    collaborators: { readonly brain: LiveBrain; readonly record: LiveRecord },
    tasks: Queue.Queue<Effect.Effect<void>>,
    clock: Clock.Clock,
    sessions: Scope.Scope,
  ) {
    this.#options = options;
    this.#brain = collaborators.brain;
    this.#record = collaborators.record;
    this.#tasks = tasks;
    this.#clock = clock;
    this.#sessions = sessions;
    this.#queue = new ProactiveQueue({ now: () => this.#now(), trace: this.#trace });
    this.#stopRunEvents = this.#brain.onRunEvent((event) => this.#onRunEvent(event));
    this.#stopFacts =
      this.#brain.onAnticipationFacts?.((facts) => this.#anticipationFacts(facts)) ??
      (() => undefined);
  }

  /**
   * The service for one composition, standing for the scope it is built in.
   * The fiber below runs what the service began and waits for nothing: each
   * task is its own fiber of the set, as each was its own promise before, so
   * a write held by the record delays neither the next write nor the ask
   * behind it, and closing the scope interrupts every one of them. `stop` is
   * not that close: how long a session may hold a quit open while the peer
   * answers its graceful close is the composition's own decision — the
   * desktop runs it as a drain step inside the quit's deadline, the hosted
   * exchange as the socket scope's own finalizer — so this scope owns what
   * the service runs and never the close itself.
   */
  static make<Delivery extends BriefingDelivery>(
    options: LiveSessionServiceOptions<Delivery>,
  ): Effect.Effect<
    LiveSessionService<Delivery>,
    never,
    Scope.Scope | LiveBrainTag | LiveRecordTag
  > {
    return Effect.gen(function* () {
      const tasks = yield* Queue.unbounded<Effect.Effect<void>>();
      const fibers = yield* FiberSet.make();
      const collaborators = { brain: yield* LiveBrainTag, record: yield* LiveRecordTag };
      const scope = yield* Effect.scope;
      const service = new LiveSessionService(
        options,
        collaborators,
        tasks,
        yield* Clock.Clock,
        yield* Scope.fork(scope),
      );
      yield* Effect.forkScoped(
        Effect.forever(Effect.flatMap(Queue.take(tasks), (task) => FiberSet.run(fibers, task))),
      );
      return service;
    });
  }

  /** Begins what nothing waits for, on the service's own fiber. */
  #start(effect: Effect.Effect<void>): void {
    Queue.offerUnsafe(this.#tasks, effect);
  }

  /** The instant this session reads everything by: its scope's own clock, which a test drives. */
  #now(): number {
    return this.#clock.currentTimeMillisUnsafe();
  }

  /**
   * Arms a delay on the service's own fiber: the body runs once the clock has
   * moved by `delayMs` and nothing cancelled it first. What is handed back is
   * the cancel itself, so a hand that gives up before the fiber has even
   * reached its sleep still stops the body from ever running.
   */
  #after(delayMs: number, body: () => void): SessionDelay {
    const delay = Deferred.makeUnsafe<void>();
    this.#start(
      Effect.flatMap(
        Effect.timeoutOption(Deferred.await(delay), Duration.millis(delayMs)),
        (cancelled) => (Option.isSome(cancelled) ? Effect.void : Effect.sync(body)),
      ),
    );
    return delay;
  }

  /** Gives up a delay, whether or not it was ever armed. */
  #cancelDelay(delay: SessionDelay | undefined): void {
    if (delay !== undefined) Deferred.doneUnsafe(delay, Exit.void);
  }

  /** Whether a session stands that appends can reach. */
  sessionStands(): boolean {
    return this.#standing !== undefined && !this.#standing.ended;
  }

  /**
   * Creates the one session for the peer's offer, seeded with the bounded
   * roster summary and the recent conversation, and attaches the sideband
   * before the answer is returned, so no transcript precedes attachment. A
   * session already standing is closed gracefully first: there is one.
   */
  createSession(sdpOffer: string): Effect.Effect<LiveSessionCreated | undefined> {
    return Effect.gen({ self: this }, function* () {
      if (this.#standing) yield* this.endSession();
      const source = this.#options.source();
      if (!source) return undefined;
      const seeded = rosterSeed(this.#options.roster?.() ?? [], this.#now());
      this.#dropPendingRoster();
      return yield* this.#opening((scope) =>
        Effect.gen({ self: this }, function* () {
          const opened = yield* Scope.provide(
            source.create({ sdpOffer, input: this.#seedInput(seeded) }),
            scope,
          );
          if (!opened) return undefined;
          this.#setPhase({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
          const sideband = yield* this.#attach(opened, scope);
          this.#standing = yield* this.#stand(opened.sessionId, sideband, scope);
          this.#standing.rosterTold = seeded?.told;
          this.#options.onSessionCreated?.();
          this.#trace(LIVE_TRACE_DECISION.CREATED);
          return createdOf(opened);
        }),
      );
    });
  }

  /**
   * Stands a session another party created for this peer and seeds nothing:
   * the creator seeded it from the offer it was handed, and a second seed
   * would put the recent lines into the conversation twice. From the attach
   * on, the session is this service's exactly as one it created.
   */
  adoptSession(opened: AdoptableSession): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      if (this.#standing) yield* this.endSession();
      this.#dropPendingRoster();
      this.#setPhase({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
      const stood = yield* this.#opening((scope) =>
        Effect.gen({ self: this }, function* () {
          const sideband = yield* this.#attach(opened, scope);
          const session = yield* this.#stand(opened.sessionId, sideband, scope);
          this.#standing = session;
          this.#options.onSessionCreated?.();
          this.#trace(LIVE_TRACE_DECISION.CREATED);
          if (opened.started) this.#started(session);
          return true;
        }),
      );
      return stood ?? false;
    });
  }

  /**
   * Opens the scope one session is to stand in — a child of `#sessions`,
   * forked before anything is created or attached into it — and closes it
   * again unless a session came to stand there. So a create that answered
   * nothing and an attach that failed each leave no socket and no re-attaching
   * fiber behind them, and what does stand has one scope to be released by.
   */
  #opening<A>(
    stand: (scope: Scope.Closeable) => Effect.Effect<A | undefined>,
  ): Effect.Effect<A | undefined> {
    return Effect.gen({ self: this }, function* () {
      const scope = yield* Scope.fork(this.#sessions);
      return yield* Effect.onExit(stand(scope), (exit) =>
        Exit.isSuccess(exit) && exit.value !== undefined
          ? Effect.void
          : Scope.close(scope, Exit.void),
      );
    });
  }

  /** The session is running: what waited for its start is spoken, and the idle clock reads from here. */
  #started(session: StandingSession): void {
    session.started = true;
    this.#setPhase({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.STARTED });
    this.#trace(LIVE_TRACE_DECISION.STARTED);
    this.#drain();
    this.#speakLate(session);
    this.#tellRoster();
    this.#considerIdle(session);
  }

  /**
   * The renderer's hang-up, the idle decision, and the drain all end the
   * session the same way: whichever stands when the ask is run. Where none
   * stands because one was declared over a turn ago and is still being
   * released, this waits for that release, so the drain answers with the
   * socket closed however the end was decided.
   */
  endSession(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const session = this.#standing;
      if (session !== undefined) return this.#end(session);
      const releasing = this.#releasing;
      return releasing === undefined ? Effect.void : Deferred.await(releasing);
    });
  }

  /**
   * Ends the one session named, which is the session the caller decided
   * about: an end a timer or a transport report began is run on the service's
   * own fiber a turn later, and by then the session standing may be another.
   * A second ask waits on the first and is answered as the first was, so a
   * close that failed is failed for every waiter rather than read as an end.
   */
  #end(session: StandingSession): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (session.ended) return yield* Deferred.await(session.released);
      const standing = session.closing;
      if (standing !== undefined) return yield* Deferred.await(standing);
      const closing = yield* Deferred.make<void>();
      session.closing = closing;
      yield* Effect.onExit(this.#close(session), (exit) => Deferred.done(closing, exit));
    });
  }

  #close(session: StandingSession): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.#setPhase({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSING });
      const result = yield* closeGracefully(session.sideband, {
        eventId: this.#options.createId(),
        settled: Deferred.await(session.settled),
      });
      if (result.outcome === SIDEBAND_CLOSE_OUTCOME.CLOSED) {
        return yield* this.#onClosed(session, result.closed);
      }
      yield* this.#connectionLost(
        session,
        result.outcome === SIDEBAND_CLOSE_OUTCOME.TIMED_OUT
          ? "close timed out"
          : LIVE_CLOSE_REASON.CONNECTION_LOST,
      );
    });
  }

  /**
   * The peer's transport as it saw it change. A failed transport is a lost
   * connection whatever the sideband still shows; a peer closed without a
   * hang-up asked of the host ends the session gracefully from here.
   */
  reportTransport(state: LiveTransportState): void {
    const session = this.#standing;
    if (!session || session.ended) return;
    if (state === LIVE_TRANSPORT_STATE.FAILED) {
      this.#start(this.#connectionLost(session, "peer transport failed"));
      return;
    }
    if (state === LIVE_TRANSPORT_STATE.CLOSED && !session.closing) this.#start(this.#end(session));
  }

  /**
   * The renderer's one idle report. The host closes only when it too has
   * appended nothing in the idle window; otherwise it waits out the rest of
   * that window and decides again, unless the peer reports activity first.
   */
  reportActivity(idle: boolean): void {
    const session = this.#standing;
    if (!session || session.ended) return;
    session.idleReported = idle;
    if (session.idleTimer !== undefined) {
      this.#cancelDelay(session.idleTimer);
      session.idleTimer = undefined;
    }
    if (idle) this.#considerIdle(session);
  }

  /** A briefing the brain decided: spoken into the standing session, or the one opened for it. */
  deliverBriefing(delivery: Delivery): void {
    this.#queue.requestBriefing(delivery);
    this.#drain();
  }

  /** An onboarding beat, each spoken at most once to the end per run. */
  speakBeat(turn: BeatTurn): void {
    this.#queue.requestBeat(turn);
    this.#drain();
  }

  /** Removes a pending beat whose reason has gone; withdrawal does not spend the kind. */
  withdrawBeat(kind: BeatKind): void {
    this.#queue.withdrawBeat(kind);
  }

  /** Discards every briefing not yet appended: the generation that decided them is gone, or the hold lost its reason. */
  dropBriefings(): void {
    this.#queue.dropBriefings();
  }

  /**
   * Follows the announcement hold, on the service's own fiber since no
   * caller of this waits for it. Quiet beginning holds every request not yet
   * appended; quiet ending releases the beats with a fresh clock and hands the
   * held briefings back to the brain for one re-decision against the roster
   * as it then is, so nothing is spoken stale.
   */
  reconcile(): void {
    this.#start(
      Effect.gen({ self: this }, function* () {
        const briefings = this.#queue.setQuiet(yield* this.#options.quietNow());
        if (briefings.length > 0) yield* this.#options.releaseHeldBriefings(briefings);
        this.#drain();
      }),
    );
  }

  /**
   * The stop key: the model is told to stop and then wait, once, through the
   * standing session's own queue. Answers whether a session was there to
   * tell; the microphone is the peer's to mute and is not touched here.
   */
  stopSpeaking(): boolean {
    const session = this.#speakable();
    if (!session) return false;
    // The stop is not something the session is worth keeping open for: the
    // idle decision is made against what this exchange said, and a developer
    // cutting Luke off is the opposite of that.
    session.channel.enqueue(
      Effect.suspend(() =>
        Effect.asVoid(
          session.channel.send(instructionsAppend(this.#input(null, STOP_SPEAKING_INSTRUCTION)), {
            countsForIdle: false,
          }),
        ),
      ),
    );
    return true;
  }

  /**
   * The drain: the session is closed gracefully inside the quit's own
   * deadline, and nothing is opened after. Run once, whether the composition
   * runs it as a drain step or as its own scope's finalizer.
   */
  stop(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.#stopped) return;
      this.#stopped = true;
      this.#stopRunEvents();
      this.#stopFacts();
      this.#queue.clear();
      this.#dropPendingRoster();
      yield* this.endSession();
      yield* this.#drop();
    });
  }

  /** Everything waiting to be told about the desk, discarded: a fresher roster has superseded it, or nothing will read it again. */
  #dropPendingRoster(): void {
    if (this.#rosterTimer !== undefined) {
      this.#cancelDelay(this.#rosterTimer);
      this.#rosterTimer = undefined;
    }
    this.#rosterPending = undefined;
  }

  /**
   * What a session opens knowing: the desk first, then the recent
   * conversation. The roster item is never the one dropped — the guide's own
   * reason for seeding at all is that the conversation can then answer
   * without a round trip — so the conversation is built under what the roster
   * item leaves of the API's bounds.
   */
  #seedInput(seeded: RosterSummary | undefined): readonly InitialItem[] {
    const item = seeded === undefined ? undefined : rosterSeedItem(seeded);
    const budget =
      item === undefined
        ? { messages: LIVE_INPUT_BOUNDS.MESSAGES, tokens: LIVE_INPUT_BOUNDS.TOKENS }
        : {
            messages: LIVE_INPUT_BOUNDS.MESSAGES - 1,
            tokens: LIVE_INPUT_BOUNDS.TOKENS - seedItemTokens([item]),
          };
    const conversation = conversationSeedItems(this.#options.conversationEntries(), budget);
    return item === undefined ? conversation : [item, ...conversation];
  }

  /**
   * The desk has moved. What changed reaches the standing session as one
   * thinking append with no delegation — the guide's own way to refresh a
   * conversation's context without asking the model to say anything about it —
   * so a later "is anything waiting on me?" is answered from the session
   * rather than delegated. It is a note and not speech: it opens no session,
   * waits for none, and does not move the idle clock, so a desk that keeps
   * changing cannot hold a quiet session open.
   */
  updateRoster(sessions: readonly RosterSeedSession[]): void {
    this.#rosterPending = sessions;
    this.#cancelDelay(this.#rosterTimer);
    this.#rosterTimer = this.#after(ROSTER_REFRESH_DEBOUNCE_MS, () => {
      this.#rosterTimer = undefined;
      this.#tellRoster();
    });
  }

  #tellRoster(): void {
    const sessions = this.#rosterPending;
    if (sessions === undefined) return;
    // A change that settled between a session's creation and its start has
    // nowhere to go yet and is kept rather than dropped: the start tells it,
    // so the session the developer is about to speak into does not answer
    // from the snapshot its offer was composed with.
    const session = this.#speakable();
    if (!session) return;
    this.#rosterPending = undefined;
    session.channel.enqueue(
      Effect.gen({ self: this }, function* () {
        // Decided here rather than when the change settled: the channel runs one
        // unit at a time, so any earlier refresh has landed and moved what the
        // session knows before this one works out what is still news.
        const update = rosterUpdate(session.rosterTold, sessions, this.#now());
        if (update === undefined) return;
        const taken = yield* session.channel.send(thinkingAppend(this.#input(null, update.text)), {
          countsForIdle: false,
        });
        // What the session knows moves only once it has taken the append, and
        // moves by the lines that actually travelled: a refusal, or a summary
        // the append bound cut short, leaves the rest to be said again.
        if (taken) session.rosterTold = update.told;
      }),
    );
  }

  /** The standing session, once started and not yet ended: the only one an append can reach. */
  #speakable(): StandingSession | undefined {
    const session = this.#standing;
    return session?.started && !session.ended ? session : undefined;
  }

  #considerIdle(session: StandingSession): void {
    if (!session.idleReported || session.ended || !session.started) return;
    const lastSentAt = session.channel.lastSentAt;
    const quietSince = lastSentAt === undefined ? LIVE_IDLE_WINDOW_MS : this.#now() - lastSentAt;
    if (quietSince >= LIVE_IDLE_WINDOW_MS && !this.#exchangeInFlight(session)) {
      this.#start(this.#end(session));
      return;
    }
    session.idleTimer = this.#after(Math.max(1, LIVE_IDLE_WINDOW_MS - quietSince), () => {
      session.idleTimer = undefined;
      this.#considerIdle(session);
    });
  }

  /** Whether a reply is still coming that this session would speak: a delegation's under it, or one whose own session has since closed, which any standing session says. */
  #exchangeInFlight(session: StandingSession): boolean {
    for (const exchange of this.#exchanges.values()) {
      if (exchange.end !== undefined) continue;
      if (exchange.sessionId === undefined || exchange.sessionId === session.sessionId) return true;
    }
    return false;
  }

  /**
   * The attach runs in the session's own scope rather than the caller's:
   * what the sideband leaves standing — the fiber reading the socket, the
   * hosted source's re-attaching tries — belongs to the session, and the
   * session's scope is what releases it. The sideband's own close is added
   * there too, last, so closing that scope closes the transport before it
   * ends what was feeding it.
   */
  #attach(
    opened: Pick<LiveSessionOpened, "sessionId" | "attach">,
    scope: Scope.Closeable,
  ): Effect.Effect<LiveSideband> {
    return Scope.provide(opened.attach(), scope).pipe(
      Effect.tap((sideband) => Scope.addFinalizer(scope, sideband.close)),
    );
  }

  /**
   * Stands one session: its channel, its ledger, and the one fiber that
   * reads its sideband and owns the scope that sideband stands in. The
   * channel serializes its sends on a fiber of the service's own scope,
   * which its close ends; the reader is forked into `#sessions` rather than
   * into the session's own scope, because closing a scope from a fiber
   * inside it would be that fiber interrupting itself.
   */
  #stand(
    sessionId: string,
    sideband: LiveSideband,
    scope: Scope.Closeable,
  ): Effect.Effect<StandingSession> {
    return Effect.gen({ self: this }, function* () {
      const { channel, serve } = yield* AppendChannel.make({
        sideband,
        report: this.#options.report,
        trace: this.#trace,
      });
      const session: StandingSession = {
        sessionId,
        sideband,
        scope,
        channel,
        ledger: new TranscriptLedger({ mintRowId: this.#options.createId }),
        started: false,
        ended: false,
        closing: undefined,
        micLive: false,
        lastDelegationOffsetMs: 0,
        claimedDelegations: new Set(),
        openAsks: new Map(),
        retained: [],
        pendingRows: new Map(),
        idleReported: false,
        idleTimer: undefined,
        rosterTold: undefined,
        anticipateTimer: undefined,
        anticipated: undefined,
        factsAppendedFor: undefined,
        askedRows: new Set(),
        settled: yield* Deferred.make<SidebandCloseResult>(),
        torn: yield* Deferred.make<void>(),
        released: yield* Deferred.make<void>(),
      };
      yield* Effect.forkIn(this.#read(session), this.#sessions);
      this.#start(serve);
      return session;
    });
  }

  /**
   * The fiber a standing session belongs to: it reads the sideband on a
   * child of its own, waits for a tear-down to be decided by whatever hand
   * decides it, and then closes the session's scope. Nothing else closes
   * that scope, so the release runs once, on one fiber, and it runs after
   * the reading rather than in the middle of it: a tear-down the reading
   * itself began ends that child, and one begun outside interrupts it where
   * it stands. A fiber interrupted before any tear-down was decided — the
   * service's own scope closing — releases nothing here, because the scope
   * it would have closed is a child of the one already closing, and the
   * writes an end owes belong to an end that was decided.
   */
  #read(session: StandingSession): Effect.Effect<void> {
    return Effect.ensuring(
      Effect.gen({ self: this }, function* () {
        const arrivals = yield* Effect.forkChild(this.#arrivals(session));
        yield* Deferred.await(session.torn);
        yield* Fiber.interrupt(arrivals);
        yield* this.#release(session);
      }),
      Effect.sync(() => {
        Deferred.doneUnsafe(session.released, Exit.void);
        if (this.#releasing === session.released) this.#releasing = undefined;
      }),
    );
  }

  /**
   * The one consumer of the session's sideband. What it reads it acts on
   * where it reads it: an end — the session's own `session.closed`, or the
   * socket's close before one came — is settled for whoever is closing
   * gracefully and then decided here, which is what lets the fiber above
   * release the session in the same turn the session is over rather than
   * offering that release to the service's queue.
   */
  #arrivals(session: StandingSession): Effect.Effect<void> {
    return Stream.runForEach(session.sideband.arrivals, (arrival) => {
      if ("close" in arrival) {
        this.#settle(session, {
          outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST,
          close: arrival.close,
        });
        return session.ended || session.closing
          ? Effect.void
          : this.#connectionLost(session, LIVE_CLOSE_REASON.CONNECTION_LOST);
      }
      if (arrival.event.type === LIVE_SERVER_EVENT.SESSION_CLOSED) {
        this.#settle(session, { outcome: SIDEBAND_CLOSE_OUTCOME.CLOSED, closed: arrival.event });
      }
      return this.#onEvent(session, arrival.event);
    });
  }

  /** The session's last word, taken once: a socket closing after its own `session.closed` says nothing new. */
  #settle(session: StandingSession, result: SidebandCloseResult): void {
    Deferred.doneUnsafe(session.settled, Exit.succeed(result));
  }

  #onEvent(session: StandingSession, event: LiveServerEvent): Effect.Effect<void> {
    if (session.ended) return Effect.void;
    switch (event.type) {
      case LIVE_SERVER_EVENT.SESSION_STARTED:
        this.#started(session);
        return Effect.void;
      case LIVE_SERVER_EVENT.SESSION_CLOSED:
        return this.#onClosed(session, event);
      case LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED:
        session.micLive = false;
        return Effect.void;
      case LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED:
        session.micLive = true;
        return Effect.void;
      case LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED:
      case LIVE_SERVER_EVENT.THINKING_APPENDED:
      case LIVE_SERVER_EVENT.COMMENTARY_APPENDED:
        if (event.client_event_id !== undefined) {
          session.channel.acknowledge(event.client_event_id, event.end_ms);
        }
        return Effect.void;
      case LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA:
        this.#fragment(session, TRANSCRIPT_SPEAKER.USER, event.delta, event.start_ms, event.end_ms);
        this.#composeRetained(session);
        return Effect.void;
      case LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA:
        this.#fragment(
          session,
          TRANSCRIPT_SPEAKER.ASSISTANT,
          event.delta,
          event.start_ms,
          event.end_ms,
        );
        session.channel.outputReached(event.end_ms);
        return Effect.void;
      case LIVE_SERVER_EVENT.DELEGATION_CREATED:
        if (isClientDelegation(event))
          this.#delegation(session, event.delegation.id, event.offset_ms);
        return Effect.void;
      case LIVE_SERVER_EVENT.USAGE_UPDATED:
        return Effect.void;
      case LIVE_SERVER_EVENT.ERROR: {
        const about = event.client_event_id ?? event.error.client_event_id;
        if (about !== undefined) session.channel.refuse(about);
        else session.channel.interruptSpeech();
        return Effect.void;
      }
      case LIVE_SERVER_EVENT.INFO:
        this.#trace(LIVE_TRACE_DECISION.INFO);
        return Effect.void;
      default:
        return Effect.void;
    }
  }

  #fragment(
    session: StandingSession,
    speaker: TranscriptSpeaker,
    delta: string,
    startMs: number,
    endMs: number,
  ): void {
    const utterance = session.ledger.append({ speaker, text: delta, startMs, endMs });
    if (!utterance) return;
    this.#cancelDelay(session.pendingRows.get(utterance.rowId));
    session.pendingRows.set(
      utterance.rowId,
      this.#after(ROW_WRITE_DEBOUNCE_MS, () => {
        session.pendingRows.delete(utterance.rowId);
        this.#start(this.#upsertRow(session, utterance.rowId));
      }),
    );
    if (speaker === TRANSCRIPT_SPEAKER.USER) this.#armAnticipation(session);
  }

  /**
   * Every row with a write still put off is written now, as the ledger holds
   * it when the write runs, and nothing waits for the writes: the delegation
   * that flushes them is composed on the next task, so its own write reaches
   * the record behind these.
   */
  #flushRows(session: StandingSession): void {
    for (const [rowId, delay] of session.pendingRows) {
      this.#cancelDelay(delay);
      this.#start(this.#upsertRow(session, rowId));
    }
    session.pendingRows.clear();
  }

  /** Writes or grows one row as the ledger holds it at the write: the record reads the words from its own segments over the span. */
  #upsertRow(session: StandingSession, rowId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const row = session.ledger.row(rowId);
      if (row === undefined) return Effect.void;
      return Effect.flatMap(
        this.#record.upsertSpokenRow({
          rowId,
          speaker: row.speaker,
          voiceSessionId: session.sessionId,
          startMs: row.startMs,
          endMs: row.endMs,
        }),
        (written) => (written ? Effect.void : Effect.sync(() => this.#reportUnwritten())),
      );
    });
  }

  #reportUnwritten(): void {
    this.#options.report("A live utterance could not be written to the record");
  }

  /**
   * The developer is speaking: after a short pause in their fragments, the
   * words so far are handed to the brain to read ahead of. Each fragment
   * re-arms the pause, so the brain is handed a phrase rather than every
   * syllable, and a brain that reads nothing ahead arms nothing.
   */
  #armAnticipation(session: StandingSession): void {
    if (!this.#brain.anticipate) return;
    this.#cancelAnticipation(session);
    session.anticipateTimer = this.#after(PREFETCH_DEBOUNCE_MS, () => {
      session.anticipateTimer = undefined;
      this.#anticipate(session);
    });
  }

  #cancelAnticipation(session: StandingSession): void {
    if (session.anticipateTimer === undefined) return;
    this.#cancelDelay(session.anticipateTimer);
    session.anticipateTimer = undefined;
  }

  /** The words so far, once: the same row with the same words is not handed over again. */
  #anticipate(session: StandingSession): void {
    const brain = this.#brain;
    if (!brain.anticipate || session.ended) return;
    const anticipation = anticipationOf(session.ledger.askContext(session.lastDelegationOffsetMs));
    if (!anticipation || session.askedRows.has(anticipation.rowId)) return;
    const partialAsk = anticipation.text.trim();
    if (partialAsk.length === 0) return;
    if (
      session.anticipated?.rowId === anticipation.rowId &&
      session.anticipated.text === anticipation.text
    ) {
      return;
    }
    session.anticipated = { rowId: anticipation.rowId, text: anticipation.text };
    this.#trace(LIVE_TRACE_DECISION.ANTICIPATED);
    // Nothing waits for the read: the ask that follows takes what it read or
    // does not, so the anticipation is a fiber of the service's own scope.
    this.#start(
      brain.anticipate({
        rowId: anticipation.rowId,
        partialAsk,
        recentTurns: renderAskContext(anticipation.context),
      }),
    );
  }

  /**
   * A summary the brain read ahead for one utterance, appended as thinking
   * under no delegation and as data, once per utterance, and only while the
   * words it was read for are still the words on that row and that row has
   * not yet become a spoken ask: an append cannot be taken back, so a summary
   * of words since superseded is dropped, one that would land inside the
   * exchange its own ask opened is dropped, and so is one with no started
   * session to reach.
   */
  #anticipationFacts(facts: LiveBrainAnticipationFacts): void {
    const session = this.#speakable();
    const anticipated = session?.anticipated;
    const row = session?.ledger.row(facts.rowId);
    if (
      !session ||
      !anticipated ||
      !row ||
      anticipated.rowId !== facts.rowId ||
      anticipated.text !== row.text ||
      session.factsAppendedFor === facts.rowId ||
      session.askedRows.has(facts.rowId)
    ) {
      this.#trace(LIVE_TRACE_DECISION.FACTS_DROPPED);
      return;
    }
    const [chunk] = chunkForAppend(`${ANTICIPATION_FACTS_PREFIX}${facts.text}`);
    if (chunk === undefined) {
      this.#trace(LIVE_TRACE_DECISION.FACTS_DROPPED);
      return;
    }
    session.factsAppendedFor = facts.rowId;
    this.#trace(LIVE_TRACE_DECISION.FACTS_APPENDED);
    session.channel.enqueue(
      Effect.suspend(() =>
        Effect.asVoid(
          session.channel.send(thinkingAppend(this.#input(null, chunk)), { countsForIdle: false }),
        ),
      ),
    );
  }

  /** Whatever opened by an open ask's offset since its compose and is no ask's yet is that ask's. */
  #claimLate(session: StandingSession, open: OpenAsk): void {
    const late = askRowsOf(
      session.ledger.askContext(open.sinceMs),
      session.askedRows,
      open.offsetMs,
    );
    this.#claim(session, late, open.offsetMs);
    open.rows.push(...late);
  }

  /** The rows are the delegation's from here: no later delegation is about them, and the session's span moves past them and the offset. */
  #claim(session: StandingSession, rows: readonly TranscriptUtterance[], offsetMs: number): void {
    for (const row of rows) session.askedRows.add(row.rowId);
    session.lastDelegationOffsetMs = Math.max(
      session.lastDelegationOffsetMs,
      offsetMs,
      ...rows.map((row) => row.endMs),
    );
  }

  /**
   * The ask's rows given their delegation, each handed over as the ledger
   * holds it now, not as it stood when the delegation arrived: the API
   * delivers a delegation ahead of the transcript deltas it is about, so the
   * ask's last fragment may land while the brain is being asked, and the
   * record writes each row as handed before it attaches. A row's own debounce
   * may write it again after; the record grows it in place either way.
   */
  #attachAsk(
    session: StandingSession,
    delegationId: string,
    rowIds: readonly string[],
  ): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      const rows = rowIds.flatMap((rowId) => {
        const row = session.ledger.row(rowId);
        return row === undefined
          ? []
          : [
              {
                rowId,
                speaker: row.speaker,
                voiceSessionId: session.sessionId,
                startMs: row.startMs,
                endMs: row.endMs,
              },
            ];
      });
      return Effect.tap(
        this.#record.attachSpokenAsk({ delegationId, voiceSessionId: session.sessionId, rows }),
        (attached) => (attached ? Effect.void : Effect.sync(() => this.#reportUnwritten())),
      );
    });
  }

  /**
   * A delegation claimed once. One that precedes any developer utterance in
   * its span is retained and composed when the next fragment lands, never
   * answered with a note that nothing was heard.
   */
  #delegation(session: StandingSession, id: string, offsetMs: number): void {
    if (session.claimedDelegations.has(id)) return;
    session.claimedDelegations.add(id);
    // The words said so far are on record before the ask is composed on them.
    this.#flushRows(session);
    if (!session.ledger.askContext(session.lastDelegationOffsetMs).ask) {
      session.retained.push({ id, offsetMs });
      this.#trace(LIVE_TRACE_DECISION.RETAINED);
      return;
    }
    this.#start(this.#compose(session, id, offsetMs));
  }

  #composeRetained(session: StandingSession): void {
    if (session.retained.length === 0) return;
    if (!session.ledger.askContext(session.lastDelegationOffsetMs).ask) return;
    // The newest retained delegation is the one the model waits on; the
    // older ones asked about the same span and are answered by the same ask.
    const newest = session.retained[session.retained.length - 1];
    session.retained = [];
    if (!newest) return;
    // The fragment that let the delegation compose was the first on its row, and its
    // write is still put off: the row goes on record under the ledger's id ahead of
    // the ask's write, as it does when the delegation follows the words.
    this.#flushRows(session);
    this.#start(this.#compose(session, newest.id, newest.offsetMs));
  }

  /**
   * The ask the delegation is about, claimed here and answered on the fiber
   * that begins what this hands back: what the ask claims — the rows, the
   * span it moves the session past, the read it cancels — is decided the
   * instant the delegation arrives, because a second delegation or a late
   * fragment in the same tick must find the claim already made. The rows are
   * the ledger's, by the rule `askRowsOf` states; the question the brain is
   * handed names the latest of them as the developer's ask, as it did when
   * an ask was one row, over the whole context since the previous one.
   */
  #compose(session: StandingSession, delegationId: string, offsetMs: number): Effect.Effect<void> {
    // An ask still with the brain claims first whatever opened by its offset since, so this
    // delegation is about what is left and never about a row containing the earlier offset.
    for (const open of session.openAsks.values()) this.#claimLate(session, open);
    const sinceMs = session.lastDelegationOffsetMs;
    const context = session.ledger.askContext(sinceMs);
    const rows = askRowsOf(context, session.askedRows, offsetMs);
    // No row is this delegation's where every developer row since is an ask's already, or begun
    // after the offset: the brain is asked about the latest all the same, since the model waits on
    // the delegation, and nothing is attached.
    const ask = rows[rows.length - 1] ?? context.ask;
    if (!ask) {
      // An open ask's claim took the only words since: this delegation is about nothing yet, and
      // is retained for the next fragment as one before any developer utterance is.
      session.retained.push({ id: delegationId, offsetMs });
      this.#trace(LIVE_TRACE_DECISION.RETAINED);
      return Effect.void;
    }
    // The ask is here: a pause still pending would anticipate what the turn
    // is about to read for itself, and a late fragment on these rows must not
    // supersede the slot that turn is taking. A read already under way is
    // left to finish, since that turn is what waits for it.
    this.#cancelAnticipation(session);
    // A follow-up with no row of its own, its words on a row already an ask's, moves the session
    // past that row's end as the row's own delegation did, so the next delegation does not read
    // the row again; one whose ask begins after the offset leaves the row the next delegation's.
    const spanMs =
      rows.length === 0 && session.askedRows.has(ask.rowId)
        ? Math.max(offsetMs, ask.endMs)
        : offsetMs;
    this.#claim(session, rows, spanMs);
    const open: OpenAsk = { sinceMs, offsetMs, rows: [...rows] };
    session.openAsks.set(delegationId, open);
    this.#trace(LIVE_TRACE_DECISION.DELEGATED);
    const question = [
      renderAskContext(askContextBy(context, rows.length > 0 ? offsetMs : ask.startMs)),
      `The developer's ask is their latest line above: ${ask.text.trim()}`,
    ].join("\n");
    return Effect.gen({ self: this }, function* () {
      // The delegation's id is the submission's: the record gives the ask's rows
      // that id, so a record that learns the ask's turn can attach the rows to it.
      const submission = yield* this.#brain.submitAsk({
        submissionId: delegationId,
        question,
      });
      // The rule is applied once more over the same span before the attach: the
      // API delivers a delegation ahead of the deltas it is about, and one that
      // landed while the brain was being asked may have opened a row of its own
      // that starts by the offset, which is this delegation's and no one else's.
      this.#claimLate(session, open);
      session.openAsks.delete(delegationId);
      const rowIds = [...open.rows]
        .sort((left, right) => left.startMs - right.startMs)
        .map((row) => row.rowId);
      if (submission.outcome === LIVE_BRAIN_SUBMISSION.REFUSED) {
        if (rowIds.length > 0) yield* this.#attachAsk(session, delegationId, rowIds);
        this.#speakInto(session, delegationId, submission.refusal);
        return;
      }
      // The exchange stands before the ask's record write is awaited, so a run
      // that ends at once or speaks its first sentence during the write is
      // deferred into it rather than dropped; the record still precedes the
      // speech, because nothing deferred is spoken until the write lands. The
      // acceptance itself is told nothing of: a note saying the ask is with
      // Luke is what the model reads as license to narrate waiting, and the
      // only thinking appends this exchange earns are the factual ones a slow
      // step actually begun writes. An attach that lands nothing (a follow-up
      // with no row of its own, a repeat, or a store failure, which `#attachAsk`
      // reports) changes nothing here: the ask is with the brain either way,
      // and the developer is told nothing of the record.
      const exchange = this.#registerExchange(session, submission.runId, delegationId);
      if (rowIds.length > 0) {
        exchange.pendingRecords += 1;
        yield* this.#attachAsk(session, delegationId, rowIds);
        exchange.pendingRecords -= 1;
      }
      // A sibling ask steered into this exchange may still have its own attach
      // out; the exchange is settled once, when the last of them is in. A
      // follow-up whose words joined the first ask's row has none of its own.
      if (exchange.pendingRecords > 0) return;
      for (const event of exchange.deferred.splice(0)) this.#onRunEvent(event);
    });
  }

  /** The run joins the exchange open on its session, or opens one; either way its events are read from now on. */
  #registerExchange(session: StandingSession, runId: string, delegationId: string): Exchange {
    const open = [...this.#exchanges.values()].find(
      (exchange) => exchange.sessionId === session.sessionId && exchange.end === undefined,
    );
    if (open) {
      open.delegationIds.push(delegationId);
      open.runIds.add(runId);
      this.#exchanges.set(runId, open);
      return open;
    }
    const exchange = newExchange(runId, [delegationId], session.sessionId);
    this.#exchanges.set(runId, exchange);
    return exchange;
  }

  #onRunEvent(event: LiveBrainRunEvent): void {
    const exchange = this.#exchanges.get(event.runId);
    if (!exchange) return;
    if (exchange.pendingRecords > 0) {
      exchange.deferred.push(event);
      return;
    }
    switch (event.kind) {
      case LIVE_BRAIN_RUN_EVENT.SLOW_STEP: {
        if (exchange.slowStepTold) return;
        exchange.slowStepTold = true;
        const session = this.#sessionOf(exchange);
        if (!session) return;
        const note = SLOW_STEP_NOTE.get(event.step) ?? SLOW_STEP_GENERAL_NOTE;
        session.channel.enqueue(
          Effect.suspend(() =>
            Effect.asVoid(
              session.channel.send(thinkingAppend(this.#input(this.#delegationOf(exchange), note))),
            ),
          ),
        );
        return;
      }
      // The brain tells the settle as soon as no write of the run is still
      // out, which for a read-only run is at its first words, so the gate
      // below releases the reply earlier without meaning anything weaker.
      case LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED:
        exchange.settled = true;
        for (const sentence of exchange.buffered.splice(0)) this.#speakSentence(exchange, sentence);
        return;
      case LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE:
        if (exchange.settled) this.#speakSentence(exchange, event.sentence);
        else exchange.buffered.push(event.sentence);
        return;
      case LIVE_BRAIN_RUN_EVENT.ENDED:
        exchange.runIds.delete(event.runId);
        // A stopped or failed rider marks the exchange; a completed one only fills an empty mark.
        if (exchange.end === undefined || event.end !== LIVE_BRAIN_RUN_END.COMPLETED) {
          exchange.end = event.end;
        }
        if (exchange.runIds.size > 0) return;
        this.#cancelDelay(exchange.finalize);
        exchange.finalize = this.#after(EXCHANGE_FINALIZE_MS, () => this.#finalize(exchange));
        return;
      default:
        return;
    }
  }

  /**
   * Ends an exchange once every run in it has: a run that ended with nothing
   * said is spoken as the standing note for how it ended, and a completed one
   * that said nothing says nothing.
   */
  #finalize(exchange: Exchange): void {
    exchange.finalize = undefined;
    if (exchange.runIds.size > 0) return;
    for (const [runId, held] of [...this.#exchanges]) {
      if (held === exchange) this.#exchanges.delete(runId);
    }
    const unspoken =
      exchange.spokenChunks === 0 && exchange.buffered.length === 0 && exchange.late.length === 0;
    if (!unspoken || exchange.end === undefined || exchange.end === LIVE_BRAIN_RUN_END.COMPLETED) {
      return;
    }
    this.#speakSentence(exchange, RUN_END_NOTE[exchange.end]);
  }

  /** One sentence of an exchange's reply, into its session under its delegation, or kept for the next session. */
  #speakSentence(exchange: Exchange, sentence: string): void {
    const session = this.#sessionOf(exchange);
    if (!session) {
      exchange.late.push(sentence);
      this.#lateExchanges.add(exchange);
      this.#wantSession();
      return;
    }
    this.#speakFor(exchange, session, this.#delegationOf(exchange), sentence);
  }

  /** A reply that finished after its session closed, or that never had one, is spoken into the next session with no delegation. */
  #speakLate(session: StandingSession): void {
    for (const exchange of [...this.#lateExchanges]) {
      this.#lateExchanges.delete(exchange);
      exchange.sessionId = undefined;
      for (const sentence of exchange.late.splice(0)) {
        this.#speakFor(exchange, session, null, sentence);
      }
    }
  }

  #speakFor(
    exchange: Exchange,
    session: StandingSession,
    delegationId: LiveDelegationId,
    sentence: string,
  ): void {
    for (const chunk of chunkForAppend(sentence)) {
      session.channel.enqueue(
        Effect.gen({ self: this }, function* () {
          const taken = yield* session.channel.send(
            commentaryAppend(this.#input(delegationId, chunk)),
          );
          if (taken) exchange.spokenChunks += 1;
        }),
      );
    }
  }

  #speakInto(session: StandingSession, delegationId: LiveDelegationId, text: string): void {
    for (const chunk of chunkForAppend(text)) {
      session.channel.enqueue(
        Effect.suspend(() =>
          Effect.asVoid(session.channel.send(commentaryAppend(this.#input(delegationId, chunk)))),
        ),
      );
    }
  }

  /** The session an exchange's delegation ids belong to, if it still stands; a closed one leaves them dead. */
  #sessionOf(exchange: Exchange): StandingSession | undefined {
    const session = this.#speakable();
    if (!session) return undefined;
    if (exchange.sessionId !== undefined && exchange.sessionId !== session.sessionId)
      return undefined;
    return session;
  }

  #delegationOf(exchange: Exchange): LiveDelegationId {
    if (exchange.sessionId === undefined || exchange.sessionId !== this.#standing?.sessionId) {
      return null;
    }
    return exchange.delegationIds[exchange.delegationIds.length - 1] ?? null;
  }

  #input(delegationId: LiveDelegationId, content: string) {
    return { eventId: this.#options.createId(), delegationId, content };
  }

  /** Speaks pending proactive turns into the standing session, or asks for one. */
  #drain(): void {
    if (!this.#queue.hasPending) return;
    const session = this.#speakable();
    if (!session) {
      this.#wantSession();
      return;
    }
    const requests = this.#queue.take(this.#briefingInFlight);
    for (const request of requests) {
      if (request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) this.#briefingInFlight = true;
      this.#speakProactive(session, request);
    }
  }

  #speakProactive(session: StandingSession, request: ProactiveRequest<Delivery>): void {
    const opening = speechOpening(request.turn);
    if (opening) {
      this.#speakOpening(session, request, opening);
      return;
    }
    const chunks = speechAppends(request.turn);
    chunks.forEach((chunk, index) => {
      const last = index === chunks.length - 1;
      session.channel.enqueue(
        Effect.gen({ self: this }, function* () {
          const input = this.#input(null, chunk);
          if (last && request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
            this.#options.onBriefingAppend?.(request.delivery, input.eventId);
          }
          const taken = yield* session.channel.send(commentaryAppend(input), {
            ...(last
              ? {
                  onSpoken: () => {
                    this.#queue.spoken(request);
                    this.#options.onProactiveSpoken?.(request.kind);
                    if (request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
                      this.#briefingInFlight = false;
                      this.#drain();
                    }
                  },
                }
              : undefined),
          });
          if (!taken && last) {
            this.#queue.release(request);
            if (request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
              this.#briefingInFlight = false;
              this.#drain();
            }
          }
        }),
      );
    });
  }

  /**
   * The conversations guide's greeting before the caller speaks: the
   * instruction appended and acknowledged first, then the one commentary that
   * has the model begin, and no cue at all for an instruction the session
   * refused or never acknowledged, so a greeting that did not land is not
   * begun on the strength of the cue alone.
   *
   * A greeting opens a conversation, and only one nothing has opened yet.
   * Decided when the channel reaches it, so every append enqueued ahead of it
   * has left: a session Luke has already been asked to speak into (a briefing
   * the exchange claimed the moment the session stood, a reply) or on which
   * either speaker has already been heard is not greeted, because the
   * instruction to greet now has the model drop what it is saying to say
   * "Hey" instead, and a conversation under way is not opened again. Such a
   * greeting is settled as spoken all the same, so the device that owes it
   * once per run stops asking for it.
   */
  #speakOpening(
    session: StandingSession,
    request: ProactiveRequest<Delivery>,
    opening: SpeechOpening,
  ): void {
    session.channel.enqueue(
      Effect.gen({ self: this }, function* () {
        if (session.channel.commentarySent || session.ledger.lastActivityMs() !== undefined) {
          this.#trace(LIVE_TRACE_DECISION.SUPERSEDED);
          this.#queue.spoken(request);
          this.#options.onProactiveSpoken?.(request.kind);
          return;
        }
        const instructed = yield* session.channel.send(
          instructionsAppend(this.#input(null, opening.instruction)),
        );
        if (!instructed) {
          this.#queue.release(request);
          if (request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
            this.#briefingInFlight = false;
            this.#drain();
          }
          return;
        }
        const cued = yield* session.channel.send(commentaryAppend(this.#input(null, opening.cue)), {
          onSpoken: () => {
            this.#queue.spoken(request);
            this.#options.onProactiveSpoken?.(request.kind);
            if (request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
              this.#briefingInFlight = false;
              this.#drain();
            }
          },
        });
        if (!cued) {
          this.#queue.release(request);
          if (request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
            this.#briefingInFlight = false;
            this.#drain();
          }
        }
      }),
    );
  }

  #wantSession(): void {
    if (this.sessionStands()) return;
    this.#setPhase({ phase: LIVE_SESSION_PHASE.WANTED });
  }

  /**
   * The session's own end, settled here and handing back what the tear-down
   * began. An end already decided — the reader read `session.closed` while a
   * graceful close was waiting for it — is handed back the same release, so
   * the close that asked for it still answers with the socket released.
   */
  #onClosed(session: StandingSession, closed: LiveSessionClosed): Effect.Effect<void> {
    if (session.ended) return Deferred.await(session.released);
    this.#trace(LIVE_TRACE_DECISION.CLOSED);
    const torn = this.#tearDown(session, closed.reason);
    if (closed.reason === LIVE_CLOSE_REASON.EXPIRED || this.#owedSpeech()) this.#wantSession();
    return torn;
  }

  /**
   * The session ended without `session.closed`: every delivery aimed at the
   * dead session is discarded, and a conversation the developer was holding
   * is reopened. Settled here, like the close above, and handing back what
   * the tear-down began.
   */
  #connectionLost(session: StandingSession, reason: string): Effect.Effect<void> {
    if (session.ended) return Deferred.await(session.released);
    this.#trace(LIVE_TRACE_DECISION.CONNECTION_LOST);
    const micWasLive = session.micLive;
    const torn = this.#tearDown(session, reason);
    if (micWasLive || this.#owedSpeech()) this.#wantSession();
    return torn;
  }

  /** Whether something waits to be said that only a new session can carry. */
  #owedSpeech(): boolean {
    return this.#queue.hasPending || this.#lateExchanges.size > 0;
  }

  /** Whatever the brain read ahead is forgotten; a brain that reads nothing ahead is asked nothing. */
  #drop(): Effect.Effect<void> {
    return this.#brain.dropAnticipation?.() ?? Effect.void;
  }

  /**
   * The session is over, and it is over the instant this is called: the
   * timers, the channel, `#standing`, and the phase are all settled here, on
   * the hand that decided it, so a caller that reads the service back sees no
   * session standing. The release is not settled here and cannot be — the
   * scope's close is the reader's own to run, and a reader that decided this
   * cannot wait for the fiber it is. What is handed back is that release as
   * something to wait for, so the drain, which is the one caller that waits,
   * closes with the socket released and those writes in rather than racing
   * them, while the reader's own tear-down waits for nothing and simply ends.
   */
  #tearDown(session: StandingSession, reason: string): Effect.Effect<void> {
    session.ended = true;
    // The writes put off are the release's to make now; the delays behind them are given up here so none fires beside it.
    for (const delay of session.pendingRows.values()) this.#cancelDelay(delay);
    this.#cancelDelay(session.idleTimer);
    this.#cancelAnticipation(session);
    session.channel.close();
    session.retained = [];
    for (const exchange of this.#exchanges.values()) {
      if (exchange.sessionId === session.sessionId) exchange.sessionId = undefined;
    }
    if (this.#standing === session) {
      this.#standing = undefined;
      this.#briefingInFlight = false;
    }
    this.#releasing = session.released;
    Deferred.doneUnsafe(session.torn, Exit.void);
    this.#setPhase({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSED, reason });
    return Deferred.await(session.released);
  }

  /**
   * The session's scope, closed once and by the fiber that owns it: the
   * sideband's transport released, and with it whatever the source left
   * standing under it. Then what the end owes and nothing inside it waits
   * on — the read made ahead forgotten, and every row with a write still put
   * off written as it stands, so a socket closing mid-sentence leaves the
   * words said so far on the row.
   */
  #release(session: StandingSession): Effect.Effect<void> {
    return Effect.andThen(
      Scope.close(session.scope, Exit.void),
      Effect.suspend(() => {
        const rows = [...session.pendingRows.keys()];
        session.pendingRows.clear();
        return Effect.all([this.#drop(), ...rows.map((rowId) => this.#upsertRow(session, rowId))], {
          concurrency: "unbounded",
          discard: true,
        });
      }),
    );
  }

  #setPhase(change: VoiceLiveSessionChanged): void {
    this.#options.emit(change);
  }

  readonly #trace = (decision: LiveTraceDecision): void => {
    this.#options.trace?.({ kind: LIVE_TRACE_KIND, decision, pendingCount: this.#queue.size });
  };
}
