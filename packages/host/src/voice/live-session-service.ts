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
  LIVE_SERVER_EVENT,
  type LiveDelegationId,
  type LiveServerEvent,
  type LiveSessionClosed,
  type ProactiveSpeechKind,
  renderAskContext,
  speechAppends,
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  type TranscriptSpeaker,
  type TranscriptUtterance,
  thinkingAppend,
  UTTERANCE_GAP_MS,
  UTTERANCE_SETTLE_MARGIN_MS,
} from "@sidecar/live";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import type { LiveSessionOpened, LiveSessionSource, LiveSideband } from "@sidecar/voice";
import { AppendChannel } from "./append-channel.js";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainRunEnd,
  type LiveBrainRunEvent,
} from "./live-brain.js";
import type { LiveRecord } from "./live-record.js";
import { closeGracefully, SIDEBAND_CLOSE_OUTCOME } from "./live-sideband.js";
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
import { rosterAppendContent, rosterSeedItem, seedBudgetBesideRoster } from "./roster-context.js";

/**
 * The one voice session and everything the host owes it. It opens when the
 * renderer offers a peer for the talk key, or when Luke has something to say
 * and no session stands; it is seeded from Luke's own record and the roster;
 * it is fed every append the host makes, each awaiting its acknowledgment;
 * it hands each delegation to the brain as a spoken ask and streams the
 * reply back as commentary once every action in the run has settled; it
 * writes both speakers' settled utterances into the record; and it closes
 * gracefully on idle, on the renderer's hang-up, and on the drain, recording
 * the usage the final event confirms. The renderer owns the microphone and
 * the hang-up; the host owns every append and the close decision, one owner
 * per action as the server-controls guide has it. The brain is reached only
 * through `LiveBrain`, and the record only through `LiveRecord`.
 */

/** Rapid roster changes are combined into one append of the latest state. */
const ROSTER_COALESCE_MS = 1_500;

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
const SLOW_STEP_GENERAL_NOTE = "Luke is still working on it; this takes a moment.";

const TYPED_ASK_MIRROR_NOTE = "The developer typed this ask into Luke's composer:";

/** Said once, under the delegation, when the developer's ask could not be put on record: an ask off the record is answered nowhere. */
export const ASK_UNRECORDED_NOTE =
  "I couldn't write that ask down, so I'm not going to answer it here.";

/**
 * What the stop key says to the model. Muting the microphone never stops the
 * output, as the live guide notes, so a microphone muted while Luke is
 * speaking also carries the guide's corrective instruction: stop means stop.
 */
export const STOP_SPEAKING_INSTRUCTION =
  "Stop speaking now and wait quietly until the developer speaks again.";

/**
 * How recently an output transcript fragment must have arrived for a mute to
 * count as cutting Luke off. The talk key mutes at the end of every turn of
 * the developer's; only a mute that lands over Luke's own words is the stop
 * key's meaning, and only that one carries the instruction.
 */
export const STOP_SPEAKING_OUTPUT_RECENCY_MS = 2_000;

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
  /** When Luke's output transcript last moved, on this host's clock; what tells a stop from a turn's end. */
  lastOutputAt: number | undefined;
  usageSeconds: number | undefined;
  lastDelegationOffsetMs: number;
  readonly claimedDelegations: Set<string>;
  retained: RetainedDelegation[];
  readonly writtenRows: Set<number>;
  /** When each utterance's first fragment arrived, on this host's clock: the instant its line is recorded at, so a Clear's cutoff refuses what was begun before it. */
  readonly rowBeganAt: Map<number, number>;
  readonly settleTimers: Map<TranscriptSpeaker, ScheduledTimer>;
  idleReported: boolean;
  idleTimer: ScheduledTimer | undefined;
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
  #lastRosterView: string | undefined;
  #rosterTimer: ScheduledTimer | undefined;
  #lastSessionSeconds: number | undefined;
  #usageConfirmed = false;
  #phase: LiveSessionPhase | undefined;
  readonly #exchanges = new Map<string, Exchange>();
  /** Exchanges whose reply outlived their session, or never had one, waiting for the next to open. */
  readonly #lateExchanges = new Set<Exchange>();
  readonly #stopRunEvents: () => void;

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
   * Creates the one session for the peer's offer, seeded with the recent
   * conversation and the roster, and attaches the sideband before the answer
   * is returned, so no transcript precedes attachment. A session already
   * standing is closed gracefully first: there is one.
   */
  async createSession(
    sdpOffer: string,
  ): Promise<{ sessionId: string; sdpAnswer: string } | undefined> {
    if (this.#standing) await this.endSession();
    const source = this.#options.source();
    if (!source) return undefined;
    const view = this.#options.brain.standingRosterView();
    const roster = rosterSeedItem(view);
    const input: InitialItem[] = [
      ...conversationSeedItems(this.#options.conversationEntries(), seedBudgetBesideRoster(roster)),
      roster,
    ];
    const opened = await source.create({ sdpOffer, input });
    if (!opened) return undefined;
    this.#lastRosterView = view;
    this.#setPhase({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
    const sideband = await this.#attach(opened);
    if (!sideband) return undefined;
    this.#standing = this.#stand(opened.sessionId, sideband);
    this.#usageConfirmed = false;
    this.#options.onSessionCreated?.();
    this.#trace(LIVE_TRACE_DECISION.CREATED);
    return { sessionId: opened.sessionId, sdpAnswer: opened.sdpAnswer };
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
   * A typed ask goes to the brain as today; here its run is followed so the
   * reply is spoken like a delegation's, with no delegation id since no
   * delegation asked it, into the standing session or the one opened for it,
   * and the ask itself is mirrored into a standing session so the voice knows
   * what was asked before it speaks the answer.
   */
  followTypedAsk(words: string, runId: string): void {
    if (!this.#exchanges.has(runId)) this.#exchanges.set(runId, newExchange(runId, [], undefined));
    const session = this.#speakable();
    if (!session) return;
    const [summary] = chunkForAppend(`${TYPED_ASK_MIRROR_NOTE} ${words}`);
    if (summary === undefined) return;
    session.channel.enqueue(async () => {
      await session.channel.send(thinkingAppend(this.#input(null, summary)));
    });
  }

  /** The roster moved; rapid changes are combined and an unchanged view is skipped. */
  rosterChanged(): void {
    if (!this.sessionStands()) return;
    if (this.#rosterTimer !== undefined) this.#options.cancel(this.#rosterTimer);
    this.#rosterTimer = this.#options.schedule(() => {
      this.#rosterTimer = undefined;
      const session = this.#speakable();
      if (!session) return;
      const view = this.#options.brain.standingRosterView();
      if (view === this.#lastRosterView) return;
      this.#lastRosterView = view;
      session.channel.enqueue(async () => {
        await session.channel.send(thinkingAppend(this.#input(null, rosterAppendContent(view))));
      });
    }, ROSTER_COALESCE_MS);
  }

  /** The drain: the session is closed gracefully inside the quit's own deadline, and nothing is opened after. */
  async stop(): Promise<void> {
    this.#stopRunEvents();
    if (this.#rosterTimer !== undefined) this.#options.cancel(this.#rosterTimer);
    this.#rosterTimer = undefined;
    this.#queue.clear();
    await this.endSession();
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

  /** Whether a reply is still coming that this session would speak: a delegation's under it, or a typed ask's, which any standing session says. */
  #exchangeInFlight(session: StandingSession): boolean {
    for (const exchange of this.#exchanges.values()) {
      if (exchange.end !== undefined) continue;
      if (exchange.sessionId === undefined || exchange.sessionId === session.sessionId) return true;
    }
    return false;
  }

  async #attach(opened: LiveSessionOpened): Promise<LiveSideband | undefined> {
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
      lastOutputAt: undefined,
      usageSeconds: undefined,
      lastDelegationOffsetMs: 0,
      claimedDelegations: new Set(),
      retained: [],
      writtenRows: new Set(),
      rowBeganAt: new Map(),
      settleTimers: new Map(),
      idleReported: false,
      idleTimer: undefined,
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
        session.started = true;
        this.#setPhase({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.STARTED });
        this.#trace(LIVE_TRACE_DECISION.STARTED);
        this.#drain();
        this.#speakLate(session);
        this.#considerIdle(session);
        return;
      case LIVE_SERVER_EVENT.SESSION_CLOSED:
        this.#onClosed(session, event);
        return;
      case LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED:
        // A microphone muted over Luke's own words is the stop key's meaning;
        // one muted at the end of the developer's turn, or a session that
        // opened muted for a briefing, has nothing to stop.
        if (
          session.micLive &&
          session.lastOutputAt !== undefined &&
          this.#options.now() - session.lastOutputAt < STOP_SPEAKING_OUTPUT_RECENCY_MS
        ) {
          session.channel.enqueue(async () => {
            await session.channel.send(
              instructionsAppend(this.#input(null, STOP_SPEAKING_INSTRUCTION)),
            );
          });
        }
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
        session.lastOutputAt = this.#options.now();
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
    const submission = await this.#options.brain.submitAsk({
      submissionId: this.#options.createId(),
      question,
    });
    if (submission.outcome === LIVE_BRAIN_SUBMISSION.REFUSED) {
      if (!session.writtenRows.has(ask.rowId)) {
        session.writtenRows.add(ask.rowId);
        await this.#write({
          session,
          utterance: ask,
          delegationId,
          askContext: { sinceMs, untilMs: offsetMs },
        });
      }
      this.#speakInto(session, delegationId, submission.refusal);
      return;
    }
    // The exchange stands before the ask's record write is awaited, so a run
    // that ends at once or speaks its first sentence during the write is
    // deferred into it rather than dropped; the record still precedes the
    // speech, because nothing deferred is spoken until the write lands.
    const exchange = this.#registerExchange(session, submission.runId, delegationId);
    if (session.writtenRows.has(ask.rowId)) return;
    session.writtenRows.add(ask.rowId);
    exchange.pendingRecords += 1;
    const recorded = await this.#write({
      session,
      utterance: ask,
      delegationId,
      askContext: { sinceMs, untilMs: offsetMs },
      runId: submission.runId,
    });
    exchange.pendingRecords -= 1;
    if (!recorded) {
      this.#dropExchange(exchange);
      this.#speakInto(session, delegationId, ASK_UNRECORDED_NOTE);
      return;
    }
    if (exchange.pendingRecords === 0) {
      for (const event of exchange.deferred.splice(0)) this.#onRunEvent(event);
    }
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
        const taken = await session.channel.send(
          commentaryAppend(this.#input(null, chunk)),
          last
            ? () => {
                this.#queue.spoken(request);
                this.#options.onProactiveSpoken?.(request.kind);
              }
            : undefined,
        );
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
