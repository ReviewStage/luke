import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type LiveSessionPhase,
  type LiveTransportState,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import {
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
  PROACTIVE_SPEECH_KIND,
  type ProactiveSpeechKind,
  type RosterSeedSession,
  type RosterSummary,
  type RosterTold,
  renderAskContext,
  rosterSeed,
  rosterSeedItem,
  rosterUpdate,
  seedItemTokens,
  speechAppends,
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  type TranscriptSpeaker,
  type TranscriptUtterance,
  thinkingAppend,
  UTTERANCE_GAP_MS,
  UTTERANCE_SETTLE_MARGIN_MS,
} from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import type { LiveSideband } from "../live-socket.js";
import { AppendChannel, type ScheduledTimer } from "./append-channel.js";
import { closeGracefully, SIDEBAND_CLOSE_OUTCOME } from "./graceful-close.js";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
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
 * settled utterances into the record; and it closes gracefully on
 * idle, on the peer's hang-up, and on the drain,
 * recording the usage the final event confirms. The peer owns the microphone
 * and the hang-up; the trusted side owns every append and the close
 * decision, one owner per action as the server-controls guide has it. The
 * service is transport-neutral on purpose — whoever holds the sideband
 * composes it: the desktop's host today, the hosted voice service where it
 * owns the exchange — so the brain is reached only through `LiveBrain`, the
 * record only through `LiveRecord`, and the session only through the
 * `LiveSessionSource` and `LiveSideband` seams.
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
 * How long a moving roster is let settle before the voice is told about it.
 * An observation pass and the action that provoked it land within a second of
 * each other, and the summary is worth one append rather than three.
 */
const ROSTER_REFRESH_DEBOUNCE_MS = 2_000;

/** Said once, under the delegation, when the developer's ask could not be put on record: an ask off the record is answered nowhere. */
export const ASK_UNRECORDED_NOTE =
  "I couldn't write that ask down, so I'm not going to answer it here.";

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

export interface LiveSessionStatus {
  sessionId?: string;
  phase: LiveSessionPhase | undefined;
  /** The latest usage snapshot, cumulative seconds; confirmed only by `session.closed`. */
  usageSeconds?: number;
  usageConfirmed: boolean;
  /** The seconds the last session's `session.closed` reported. */
  lastSessionSeconds?: number;
}

export interface LiveSessionServiceOptions<Delivery extends BriefingDelivery> {
  /** Where a session comes from now, or nothing while voice is unavailable. */
  source: () => LiveSessionSource | undefined;
  brain: LiveBrain;
  record: LiveRecord;
  /** The retained conversation the next session is seeded from. */
  conversationEntries: () => readonly ConversationEntry[];
  /**
   * The desk as the voice may be told it, read when a session is seeded.
   * Absent leaves every session seeded from the conversation alone, which is
   * what a composition with no roster of its own wants.
   */
  roster?: () => readonly RosterSeedSession[];
  /** Whether a meeting or the developer's pause holds announcements now. */
  quietNow: () => Promise<boolean>;
  /** Hands held briefings back for re-decision once the quiet ends. */
  releaseHeldBriefings: (held: readonly Delivery[]) => void;
  emit: (change: VoiceLiveSessionChanged) => void;
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel: (timer: ScheduledTimer) => void;
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

interface RetainedDelegation {
  id: string;
  offsetMs: number;
}

interface StandingSession {
  sessionId: string;
  sideband: LiveSideband;
  channel: AppendChannel;
  ledger: TranscriptLedger;
  started: boolean;
  ended: boolean;
  /** The graceful close under way, so a second ask to end the session waits on the first. */
  closing: Promise<void> | undefined;
  micLive: boolean;
  usageSeconds: number | undefined;
  lastDelegationOffsetMs: number;
  readonly claimedDelegations: Set<string>;
  retained: RetainedDelegation[];
  /** Utterance rows the settle timer has nothing more to write: written undelegated already, or handed to a delegated write, which a record tells from the undelegated one by the row. */
  readonly writtenRows: Set<number>;
  /** When each utterance's first fragment arrived, on this host's clock: the instant its line is recorded at, so a Clear's cutoff refuses what was begun before it. */
  readonly rowBeganAt: Map<number, number>;
  readonly settleTimers: Map<TranscriptSpeaker, ScheduledTimer>;
  idleReported: boolean;
  idleTimer: ScheduledTimer | undefined;
  /** The lines about the desk this session was actually given, so the next refresh says only what it does not already hold. */
  rosterTold: RosterTold | undefined;
  stopEvents: () => void;
  stopClose: () => void;
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
  /** The delegation whose ask the record refused, if any: once every write is in, the exchange is dropped and told so once. */
  unrecorded: string | undefined;
  /** The session the delegations belong to; a closed session's ids die with it and later sentences go session-wide. */
  sessionId: string | undefined;
  settled: boolean;
  buffered: string[];
  /** Sentences that could not be appended because no session stood; spoken into the next one. */
  late: string[];
  spokenChunks: number;
  slowStepTold: boolean;
  finalize: ScheduledTimer | undefined;
  end: LiveBrainRunEnd | undefined;
}

interface UtteranceWrite {
  session: StandingSession;
  utterance: TranscriptUtterance;
  delegationId: LiveDelegationId;
  askContext?: { sinceMs: number; untilMs: number };
  runId?: string;
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
    unrecorded: undefined,
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
  #standing: StandingSession | undefined;
  #lastSessionSeconds: number | undefined;
  #usageConfirmed = false;
  #phase: LiveSessionPhase | undefined;
  readonly #exchanges = new Map<string, Exchange>();
  /** Exchanges whose reply outlived their session, or never had one, waiting for the next to open. */
  readonly #lateExchanges = new Set<Exchange>();
  readonly #stopRunEvents: () => void;
  /** The latest roster seen, held until the debounce settles; one append answers however many changes arrived. */
  #rosterPending: readonly RosterSeedSession[] | undefined;
  #rosterTimer: ScheduledTimer | undefined;

  constructor(options: LiveSessionServiceOptions<Delivery>) {
    this.#options = options;
    this.#queue = new ProactiveQueue({ now: options.now, trace: this.#trace });
    this.#stopRunEvents = options.brain.onRunEvent((event) => this.#onRunEvent(event));
  }

  status(): LiveSessionStatus {
    return {
      ...(this.#standing ? { sessionId: this.#standing.sessionId } : undefined),
      phase: this.#phase,
      ...(this.#standing?.usageSeconds !== undefined
        ? { usageSeconds: this.#standing.usageSeconds }
        : undefined),
      usageConfirmed: this.#usageConfirmed,
      ...(this.#lastSessionSeconds !== undefined
        ? { lastSessionSeconds: this.#lastSessionSeconds }
        : undefined),
    };
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
  async createSession(
    sdpOffer: string,
  ): Promise<{ sessionId: string; sdpAnswer: string } | undefined> {
    if (this.#standing) await this.endSession();
    const source = this.#options.source();
    if (!source) return undefined;
    const seeded = rosterSeed(this.#options.roster?.() ?? [], this.#options.now());
    this.#dropPendingRoster();
    const opened = await source.create({ sdpOffer, input: this.#seedInput(seeded) });
    if (!opened) return undefined;
    this.#setPhase({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
    const sideband = await this.#attach(opened);
    if (!sideband) return undefined;
    this.#standing = this.#stand(opened.sessionId, sideband);
    this.#standing.rosterTold = seeded?.told;
    this.#usageConfirmed = false;
    this.#options.onSessionCreated?.();
    this.#trace(LIVE_TRACE_DECISION.CREATED);
    return { sessionId: opened.sessionId, sdpAnswer: opened.sdpAnswer };
  }

  /**
   * Stands a session another party created for this peer and seeds nothing:
   * the creator seeded it from the offer it was handed, and a second seed
   * would put the recent lines into the conversation twice. From the attach
   * on, the session is this service's exactly as one it created.
   */
  async adoptSession(opened: AdoptableSession): Promise<boolean> {
    if (this.#standing) await this.endSession();
    this.#dropPendingRoster();
    this.#setPhase({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
    const sideband = await this.#attach(opened);
    if (!sideband) return false;
    const session = this.#stand(opened.sessionId, sideband);
    this.#standing = session;
    this.#usageConfirmed = false;
    this.#options.onSessionCreated?.();
    this.#trace(LIVE_TRACE_DECISION.CREATED);
    if (opened.started) this.#started(session);
    return true;
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

  /** The renderer's hang-up, the idle decision, and the drain all end the session the same way. */
  async endSession(): Promise<void> {
    const session = this.#standing;
    if (!session || session.ended) return;
    session.closing ??= this.#close(session);
    await session.closing;
  }

  async #close(session: StandingSession): Promise<void> {
    this.#setPhase({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSING });
    const result = await closeGracefully(session.sideband, {
      eventId: this.#options.createId(),
      schedule: this.#options.schedule,
      cancel: this.#options.cancel,
    });
    if (result.outcome === SIDEBAND_CLOSE_OUTCOME.CLOSED) {
      this.#onClosed(session, result.closed);
      return;
    }
    this.#connectionLost(
      session,
      result.outcome === SIDEBAND_CLOSE_OUTCOME.TIMED_OUT
        ? "close timed out"
        : LIVE_CLOSE_REASON.CONNECTION_LOST,
    );
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
      this.#connectionLost(session, "peer transport failed");
      return;
    }
    if (state === LIVE_TRANSPORT_STATE.CLOSED && !session.closing) void this.endSession();
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
      this.#options.cancel(session.idleTimer);
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
   * Follows the announcement hold. Quiet beginning holds every request not yet
   * appended; quiet ending releases the beats with a fresh clock and hands the
   * held briefings back to the brain for one re-decision against the roster
   * as it then is, so nothing is spoken stale.
   */
  async reconcile(): Promise<void> {
    const briefings = this.#queue.setQuiet(await this.#options.quietNow());
    if (briefings.length > 0) this.#options.releaseHeldBriefings(briefings);
    this.#drain();
  }

  /**
   * The stop key: the model is told to stop and then wait, once, through the
   * standing session's own queue. Answers whether a session was there to
   * tell; the microphone is the peer's to mute and is not touched here.
   */
  stopSpeaking(): boolean {
    const session = this.#speakable();
    if (!session) return false;
    session.channel.enqueue(async () => {
      await session.channel.send(instructionsAppend(this.#input(null, STOP_SPEAKING_INSTRUCTION)));
    });
    return true;
  }

  /** The drain: the session is closed gracefully inside the quit's own deadline, and nothing is opened after. */
  async stop(): Promise<void> {
    this.#stopRunEvents();
    this.#queue.clear();
    this.#dropPendingRoster();
    await this.endSession();
  }

  /** Everything waiting to be told about the desk, discarded: a fresher roster has superseded it, or nothing will read it again. */
  #dropPendingRoster(): void {
    if (this.#rosterTimer !== undefined) {
      this.#options.cancel(this.#rosterTimer);
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
    if (this.#rosterTimer !== undefined) this.#options.cancel(this.#rosterTimer);
    this.#rosterTimer = this.#options.schedule(() => {
      this.#rosterTimer = undefined;
      this.#tellRoster();
    }, ROSTER_REFRESH_DEBOUNCE_MS);
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
    session.channel.enqueue(async () => {
      // Decided here rather than when the change settled: the channel runs one
      // unit at a time, so any earlier refresh has landed and moved what the
      // session knows before this one works out what is still news.
      const update = rosterUpdate(session.rosterTold, sessions, this.#options.now());
      if (update === undefined) return;
      const taken = await session.channel.send(thinkingAppend(this.#input(null, update.text)), {
        countsForIdle: false,
      });
      // What the session knows moves only once it has taken the append, and
      // moves by the lines that actually travelled: a refusal, or a summary
      // the append bound cut short, leaves the rest to be said again.
      if (taken) session.rosterTold = update.told;
    });
  }

  /** The standing session, once started and not yet ended: the only one an append can reach. */
  #speakable(): StandingSession | undefined {
    const session = this.#standing;
    return session?.started && !session.ended ? session : undefined;
  }

  #considerIdle(session: StandingSession): void {
    if (!session.idleReported || session.ended || !session.started) return;
    const lastSentAt = session.channel.lastSentAt;
    const quietSince =
      lastSentAt === undefined ? LIVE_IDLE_WINDOW_MS : this.#options.now() - lastSentAt;
    if (quietSince >= LIVE_IDLE_WINDOW_MS && !this.#exchangeInFlight(session)) {
      void this.endSession();
      return;
    }
    session.idleTimer = this.#options.schedule(
      () => {
        session.idleTimer = undefined;
        this.#considerIdle(session);
      },
      Math.max(1, LIVE_IDLE_WINDOW_MS - quietSince),
    );
  }

  /** Whether a reply is still coming that this session would speak: a delegation's under it, or one whose own session has since closed, which any standing session says. */
  #exchangeInFlight(session: StandingSession): boolean {
    for (const exchange of this.#exchanges.values()) {
      if (exchange.end !== undefined) continue;
      if (exchange.sessionId === undefined || exchange.sessionId === session.sessionId) return true;
    }
    return false;
  }

  async #attach(
    opened: Pick<LiveSessionOpened, "sessionId" | "attach">,
  ): Promise<LiveSideband | undefined> {
    try {
      return await opened.attach();
    } catch (error) {
      this.#options.report(
        `Live sideband could not attach: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.#setPhase({
        sessionId: opened.sessionId,
        phase: LIVE_SESSION_PHASE.CLOSED,
        reason: "sideband-failed",
      });
      return undefined;
    }
  }

  #stand(sessionId: string, sideband: LiveSideband): StandingSession {
    const session: StandingSession = {
      sessionId,
      sideband,
      channel: new AppendChannel({
        sideband,
        now: this.#options.now,
        schedule: this.#options.schedule,
        cancel: this.#options.cancel,
        report: this.#options.report,
        trace: this.#trace,
      }),
      ledger: new TranscriptLedger(),
      started: false,
      ended: false,
      closing: undefined,
      micLive: false,
      usageSeconds: undefined,
      lastDelegationOffsetMs: 0,
      claimedDelegations: new Set(),
      retained: [],
      writtenRows: new Set(),
      rowBeganAt: new Map(),
      settleTimers: new Map(),
      idleReported: false,
      idleTimer: undefined,
      rosterTold: undefined,
      stopEvents: () => undefined,
      stopClose: () => undefined,
    };
    session.stopEvents = sideband.onEvent((event) => this.#onEvent(session, event));
    session.stopClose = sideband.onClose(() => {
      if (!session.ended && !session.closing) {
        this.#connectionLost(session, LIVE_CLOSE_REASON.CONNECTION_LOST);
      }
    });
    return session;
  }

  #onEvent(session: StandingSession, event: LiveServerEvent): void {
    if (session.ended) return;
    switch (event.type) {
      case LIVE_SERVER_EVENT.SESSION_STARTED:
        this.#started(session);
        return;
      case LIVE_SERVER_EVENT.SESSION_CLOSED:
        this.#onClosed(session, event);
        return;
      case LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED:
        session.micLive = false;
        return;
      case LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED:
        session.micLive = true;
        return;
      case LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED:
      case LIVE_SERVER_EVENT.THINKING_APPENDED:
      case LIVE_SERVER_EVENT.COMMENTARY_APPENDED:
        if (event.client_event_id !== undefined) {
          session.channel.acknowledge(event.client_event_id, event.end_ms);
        }
        return;
      case LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA:
        this.#fragment(session, TRANSCRIPT_SPEAKER.USER, event.delta, event.start_ms, event.end_ms);
        this.#composeRetained(session);
        return;
      case LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA:
        this.#fragment(
          session,
          TRANSCRIPT_SPEAKER.ASSISTANT,
          event.delta,
          event.start_ms,
          event.end_ms,
        );
        session.channel.outputReached(event.end_ms);
        return;
      case LIVE_SERVER_EVENT.DELEGATION_CREATED:
        if (isClientDelegation(event))
          this.#delegation(session, event.delegation.id, event.offset_ms);
        return;
      case LIVE_SERVER_EVENT.USAGE_UPDATED:
        session.usageSeconds = event.usage.seconds;
        return;
      case LIVE_SERVER_EVENT.ERROR: {
        const about = event.client_event_id ?? event.error.client_event_id;
        if (about !== undefined) session.channel.refuse(about);
        else session.channel.interruptSpeech();
        return;
      }
      case LIVE_SERVER_EVENT.INFO:
        this.#trace(LIVE_TRACE_DECISION.INFO);
        return;
      default:
        return;
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
    if (!session.rowBeganAt.has(utterance.rowId)) {
      session.rowBeganAt.set(utterance.rowId, this.#options.now());
    }
    const armed = session.settleTimers.get(speaker);
    if (armed !== undefined) this.#options.cancel(armed);
    session.settleTimers.set(
      speaker,
      this.#options.schedule(() => {
        session.settleTimers.delete(speaker);
        void this.#writeSettled(session, speaker);
      }, UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS),
    );
  }

  /** Writes every utterance of one speaker not yet on record: no fragment has joined it inside the gap plus the margin. */
  async #writeSettled(session: StandingSession, speaker: TranscriptSpeaker): Promise<void> {
    for (const utterance of session.ledger.utterances(speaker)) {
      if (session.writtenRows.has(utterance.rowId)) continue;
      session.writtenRows.add(utterance.rowId);
      await this.#write({ session, utterance, delegationId: null });
    }
  }

  async #write(write: UtteranceWrite): Promise<boolean> {
    const { session, utterance } = write;
    const recordedAt = session.rowBeganAt.get(utterance.rowId) ?? this.#options.now();
    const written =
      utterance.speaker === TRANSCRIPT_SPEAKER.USER
        ? await this.#options.record.writeDeveloperUtterance({
            rowId: utterance.rowId,
            text: utterance.text,
            voiceSessionId: session.sessionId,
            delegationId: write.delegationId,
            askContext: write.askContext,
            startMs: utterance.startMs,
            endMs: utterance.endMs,
            ...(write.runId !== undefined ? { runId: write.runId } : undefined),
            recordedAt,
          })
        : await this.#options.record.writeLukeUtterance({
            role: CONVERSATION_ENTRY_KIND.REPLY,
            text: utterance.text,
            voiceSessionId: session.sessionId,
            startMs: utterance.startMs,
            endMs: utterance.endMs,
            recordedAt,
          });
    if (!written) this.#options.report("A live utterance could not be written to the record");
    return written;
  }

  /**
   * A delegation claimed once. One that precedes any developer utterance in
   * its span is retained and composed when the next fragment lands, never
   * answered with a note that nothing was heard.
   */
  #delegation(session: StandingSession, id: string, offsetMs: number): void {
    if (session.claimedDelegations.has(id)) return;
    session.claimedDelegations.add(id);
    if (!session.ledger.askContext(session.lastDelegationOffsetMs).ask) {
      session.retained.push({ id, offsetMs });
      this.#trace(LIVE_TRACE_DECISION.RETAINED);
      return;
    }
    void this.#compose(session, id, offsetMs);
  }

  #composeRetained(session: StandingSession): void {
    if (session.retained.length === 0) return;
    if (!session.ledger.askContext(session.lastDelegationOffsetMs).ask) return;
    // The newest retained delegation is the one the model waits on; the
    // older ones asked about the same span and are answered by the same ask.
    const newest = session.retained[session.retained.length - 1];
    session.retained = [];
    if (newest) void this.#compose(session, newest.id, newest.offsetMs);
  }

  async #compose(session: StandingSession, delegationId: string, offsetMs: number): Promise<void> {
    const sinceMs = session.lastDelegationOffsetMs;
    const context = session.ledger.askContext(sinceMs);
    const ask = context.ask;
    if (!ask) return;
    session.lastDelegationOffsetMs = Math.max(offsetMs, ask.endMs);
    this.#trace(LIVE_TRACE_DECISION.DELEGATED);
    const question = [
      renderAskContext(context),
      `The developer's ask is their latest line above: ${ask.text.trim()}`,
    ].join("\n");
    // The delegation's id is the submission's: the record writes the developer's
    // utterance under it, so an ask and the line it leaves share one id and a
    // record that learns the ask's turn can attach the line to it.
    const submission = await this.#options.brain.submitAsk({
      submissionId: delegationId,
      question,
    });
    // The delegated write runs whether or not the settle timer wrote the
    // utterance undelegated already: an ask is on record only under its
    // delegation, and a record that took the utterance before tells the two
    // writes apart by the row. The settle timer, for its part, writes the row
    // no more.
    session.writtenRows.add(ask.rowId);
    if (submission.outcome === LIVE_BRAIN_SUBMISSION.REFUSED) {
      await this.#write({
        session,
        utterance: ask,
        delegationId,
        askContext: { sinceMs, untilMs: offsetMs },
      });
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
    // step actually begun writes.
    const exchange = this.#registerExchange(session, submission.runId, delegationId);
    exchange.pendingRecords += 1;
    const recorded = await this.#write({
      session,
      utterance: ask,
      delegationId,
      askContext: { sinceMs, untilMs: offsetMs },
      runId: submission.runId,
    });
    exchange.pendingRecords -= 1;
    if (!recorded) exchange.unrecorded ??= delegationId;
    // A sibling ask steered into this exchange may still have its own write
    // out; the exchange is settled once, when the last of them is in.
    if (exchange.pendingRecords > 0) return;
    if (exchange.unrecorded !== undefined) {
      const refusedDelegation = exchange.unrecorded;
      this.#dropExchange(exchange);
      this.#speakInto(session, refusedDelegation, ASK_UNRECORDED_NOTE);
      return;
    }
    for (const event of exchange.deferred.splice(0)) this.#onRunEvent(event);
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

  /** An exchange whose ask never reached the record answers nothing: its runs are forgotten and what they said is dropped. */
  #dropExchange(exchange: Exchange): void {
    if (exchange.finalize !== undefined) this.#options.cancel(exchange.finalize);
    exchange.finalize = undefined;
    exchange.deferred = [];
    exchange.buffered = [];
    exchange.late = [];
    this.#lateExchanges.delete(exchange);
    for (const [runId, held] of [...this.#exchanges]) {
      if (held === exchange) this.#exchanges.delete(runId);
    }
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
        session.channel.enqueue(async () => {
          await session.channel.send(
            thinkingAppend(this.#input(this.#delegationOf(exchange), note)),
          );
        });
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
        if (exchange.finalize !== undefined) this.#options.cancel(exchange.finalize);
        exchange.finalize = this.#options.schedule(
          () => this.#finalize(exchange),
          EXCHANGE_FINALIZE_MS,
        );
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
      session.channel.enqueue(async () => {
        const taken = await session.channel.send(
          commentaryAppend(this.#input(delegationId, chunk)),
        );
        if (taken) exchange.spokenChunks += 1;
      });
    }
  }

  #speakInto(session: StandingSession, delegationId: LiveDelegationId, text: string): void {
    for (const chunk of chunkForAppend(text)) {
      session.channel.enqueue(async () => {
        await session.channel.send(commentaryAppend(this.#input(delegationId, chunk)));
      });
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

  /** Speaks the pending proactive turns in order into the standing session, or asks for one. */
  #drain(): void {
    if (!this.#queue.hasPending) return;
    const session = this.#speakable();
    if (!session) {
      this.#wantSession();
      return;
    }
    for (const request of this.#queue.take()) this.#speakProactive(session, request);
  }

  #speakProactive(session: StandingSession, request: ProactiveRequest<Delivery>): void {
    const chunks = speechAppends(request.turn);
    chunks.forEach((chunk, index) => {
      const last = index === chunks.length - 1;
      session.channel.enqueue(async () => {
        const input = this.#input(null, chunk);
        if (last && request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
          this.#options.onBriefingAppend?.(request.delivery, input.eventId);
        }
        const taken = await session.channel.send(commentaryAppend(input), {
          ...(last
            ? {
                onSpoken: () => {
                  this.#queue.spoken(request);
                  this.#options.onProactiveSpoken?.(request.kind);
                },
              }
            : undefined),
        });
        if (!taken && last) this.#queue.release(request);
      });
    });
  }

  #wantSession(): void {
    if (this.sessionStands()) return;
    this.#setPhase({ phase: LIVE_SESSION_PHASE.WANTED });
  }

  #onClosed(session: StandingSession, closed: LiveSessionClosed): void {
    if (session.ended) return;
    session.usageSeconds = closed.usage.seconds;
    this.#lastSessionSeconds = closed.usage.seconds;
    this.#usageConfirmed = true;
    this.#trace(LIVE_TRACE_DECISION.CLOSED);
    this.#tearDown(session, closed.reason);
    if (closed.reason === LIVE_CLOSE_REASON.EXPIRED || this.#owedSpeech()) this.#wantSession();
  }

  /**
   * The session ended without `session.closed`: the latest usage stands
   * unconfirmed, every delivery aimed at the dead session is discarded, and
   * a conversation the developer was holding is reopened.
   */
  #connectionLost(session: StandingSession, reason: string): void {
    if (session.ended) return;
    this.#usageConfirmed = false;
    this.#trace(LIVE_TRACE_DECISION.CONNECTION_LOST);
    const micWasLive = session.micLive;
    this.#tearDown(session, reason);
    if (micWasLive || this.#owedSpeech()) this.#wantSession();
  }

  /** Whether something waits to be said that only a new session can carry. */
  #owedSpeech(): boolean {
    return this.#queue.hasPending || this.#lateExchanges.size > 0;
  }

  #tearDown(session: StandingSession, reason: string): void {
    session.ended = true;
    session.stopEvents();
    session.stopClose();
    for (const timer of session.settleTimers.values()) this.#options.cancel(timer);
    session.settleTimers.clear();
    if (session.idleTimer !== undefined) this.#options.cancel(session.idleTimer);
    session.channel.close();
    session.retained = [];
    for (const exchange of this.#exchanges.values()) {
      if (exchange.sessionId === session.sessionId) exchange.sessionId = undefined;
    }
    for (const speaker of Object.values(TRANSCRIPT_SPEAKER))
      void this.#writeSettled(session, speaker);
    session.sideband.close();
    if (this.#standing === session) this.#standing = undefined;
    this.#setPhase({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSED, reason });
  }

  #setPhase(change: VoiceLiveSessionChanged): void {
    this.#phase = change.phase;
    this.#options.emit(change);
  }

  readonly #trace = (decision: LiveTraceDecision): void => {
    this.#options.trace?.({ kind: LIVE_TRACE_KIND, decision, pendingCount: this.#queue.size });
  };
}
