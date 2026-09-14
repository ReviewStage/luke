import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type LiveTransportState,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import { type SessionBeatFrame, VOICE_SERVICE_FRAME } from "@sidecar/hosted";
import {
  conversationSeedItems,
  type InitialItem,
  LIVE_CLOSE_REASON,
  LIVE_INPUT_BOUNDS,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  type LiveSessionClosed,
  PROACTIVE_SPEECH_KIND,
  type ProactiveSpeechKind,
  type RosterSeedSession,
  type RosterSummary,
  rosterSeed,
  rosterSeedItem,
  seedItemTokens,
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
  Queue,
  Scope,
  Stream,
} from "effect";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import type { LiveSideband } from "../live-socket.js";
import {
  closeGracefully,
  SIDEBAND_CLOSE_OUTCOME,
  type SidebandCloseResult,
} from "./graceful-close.js";
import type { BeatKind } from "./proactive-queue.js";

/**
 * The peer's side of one hosted voice session, which is everything the Mac
 * still holds of a session once the exchange is the service's. It creates
 * the session for the renderer's offer, seeded from the recent Conversation
 * and the desk as the Mac sees them, and holds the sideband the service
 * answered on for exactly four things: the graceful close, which sends
 * `session.close` and waits for `session.closed` as the conversations guide
 * prescribes; and the stop key, the idle report, and the onboarding beats,
 * each told to the service in its own vocabulary through the door the source
 * opened, because the instruction the stop appends, the idle decision, and
 * the words of every beat belong to the exchange the service holds. Nothing
 * else leaves this side, and no append at all: the desktop never appends to
 * a session. What comes back in that vocabulary is one thing, the service's
 * word that a turn was spoken to its end, because the record of the beats
 * and the counts that follow them are this side's. Every delegation the session
 * creates, every transcript delta, and every acknowledgment reaches the
 * service's exchange over the same socket ahead of this holder, and this
 * holder reads of them only what its phases need: the start, the usage, and
 * the close. It appends no thinking, no commentary, and no reply, and decides
 * no briefing; the one session it wants of its own is the muted one a beat
 * needs, announced as the `wanted` phase when a beat is asked for and no
 * session stands. The voice picker's audition is such a beat with a session
 * of its own: the voice a session speaks with is fixed when the session is
 * created, so a voice just chosen is heard by closing the audition's last
 * session and opening one under the voice the write has stored, and that
 * session is given back on the audition's own clock. The renderer's hang-up,
 * the peer's transport, and that clock are the only reasons a session ends
 * from this side, and the service's idle close reaches it as the
 * `session.closed` the relay forwards.
 *
 * Built by `make` for the scope of the composition that holds it, on the
 * same terms as `LiveSessionService`: each session stands in a scope of its
 * own forked from a child of that scope, read by one fiber that owns it, and
 * what a report or the stop key begins that nobody waits on runs as a fiber
 * of the holder's own set. `stop` is a drain step the composition runs
 * inside its own deadline, never the scope's finalizer.
 */

export interface LiveSessionHolderOptions {
  /** Where a session comes from now, or nothing while voice is unavailable. */
  source: () => LiveSessionSource | undefined;
  /** The retained conversation the next session is seeded from. */
  conversationEntries: () => readonly ConversationEntry[];
  /** The desk as the voice may be told it, read when a session is seeded; absent seeds from the conversation alone. */
  roster?: () => readonly RosterSeedSession[];
  emit: (change: VoiceLiveSessionChanged) => void;
  createId: () => string;
  report: (message: string) => void;
  /** A session was created: the one count the holder makes. */
  onSessionCreated?: () => void;
  /**
   * The service reported a proactive turn spoken to its end, by kind: a beat
   * this holder asked for, or a briefing the service's exchange decided. The
   * record of what was spoken and the counts that follow it are the caller's.
   */
  onSpoken?: (kind: ProactiveSpeechKind) => void;
}

interface HeldSession {
  readonly sessionId: string;
  readonly sideband: LiveSideband;
  readonly opened: LiveSessionOpened;
  /** The scope this one session stands in, closed by the fiber that reads it once the end is decided. */
  readonly scope: Scope.Closeable;
  started: boolean;
  ended: boolean;
  /** The graceful close under way, so a second ask to end the session waits on the first. */
  closing: Deferred.Deferred<void> | undefined;
  usageSeconds: number | undefined;
  /** The session's last word, for whoever is closing gracefully: `session.closed`, or the socket's own end. */
  readonly settled: Deferred.Deferred<SidebandCloseResult>;
  /** Settled the instant an end is decided; the reader releases the session on it. */
  readonly torn: Deferred.Deferred<void>;
  /** Settled once the session's scope is closed and its transport released. */
  readonly released: Deferred.Deferred<void>;
}

/**
 * How long the word `wanted` stands unanswered before it is spent: the
 * renderer opens within a second when it can, and one that cannot (voice
 * unavailable to it, no window) answers nothing, so a bound is what keeps
 * one unanswered word from silencing every later ask for the run. Well
 * inside the phone's two-minute grace on a briefing.
 */
export const WANTED_WORD = {
  STANDS_MS: 30_000,
} as const;

/**
 * The audition's own session, bounded on both sides. GPT Live fixes a
 * session's voice when the session is created and documents no preview of its
 * own, so the one way to hear a chosen voice is a session created with it,
 * and the one thing said into it is the picker's fixed line. It is closed
 * shortly after that line has been heard rather than the instant it settles,
 * because a commentary settles as spoken when the output first runs past it
 * and closing then would cut the words off; and it is closed on the ceiling
 * where the line was never heard at all — refused, or a model that said
 * nothing — so an audition never leaves a session standing for the run.
 */
export const VOICE_PREVIEW_SESSION = {
  LINGER_MS: 6_000,
  CEILING_MS: 20_000,
} as const;

/** The audition's beat: the kind alone, since its words are the build's and it mentions nothing observed. */
const VOICE_PREVIEW_BEAT: SessionBeatFrame = {
  type: VOICE_SERVICE_FRAME.SESSION_BEAT,
  kind: PROACTIVE_SPEECH_KIND.VOICE_PREVIEW,
};

export class LiveSessionHolder {
  readonly #options: LiveSessionHolderOptions;
  #held: HeldSession | undefined;
  /** The release still running for the session last declared over, so an end asked for meanwhile waits for it. */
  #releasing: Deferred.Deferred<void> | undefined;
  /**
   * The beats asked for and not yet spoken, by kind: waiting for a session
   * to start, or sent to the service and not yet reported spoken. One ask per
   * kind stands at a time; a second is refused until the first is spoken,
   * withdrawn, or lost with its session — except the audition, which is the
   * developer asking again and replaces the ask standing.
   */
  readonly #beats = new Map<BeatKind, { readonly beat: SessionBeatFrame; sent: boolean }>();
  /**
   * When the peer was last told a session is wanted and has not yet offered
   * one: one word, however many reasons stand behind it, since the peer
   * reads a repeated `wanted` as a fresh ask and would open twice. Spent
   * when the peer answers with an offer, when the caller drops it, or when
   * it has stood unanswered for `WANTED_WORD.STANDS_MS`, since a peer that
   * opens nothing (voice unavailable to it, or gone) must not hold every
   * later ask silent for the run.
   */
  #wantedAt: number | undefined;
  /**
   * The session opened for an audition and nothing else, while ending it is
   * still the audition's to do: a voice chosen while it stands is heard by
   * closing it and opening one with the new voice, since the voice a session
   * speaks with cannot change after it is created. Anything else spoken into
   * it, and the session's own end, give it up.
   */
  #auditionSession: HeldSession | undefined;
  /** Which audition is the standing one, so a superseded one's clocks end nothing. */
  #audition = 0;
  readonly #tasks: Queue.Queue<Effect.Effect<void>>;
  readonly #clock: Clock.Clock;
  readonly #sessions: Scope.Scope;

  private constructor(
    options: LiveSessionHolderOptions,
    tasks: Queue.Queue<Effect.Effect<void>>,
    clock: Clock.Clock,
    sessions: Scope.Scope,
  ) {
    this.#options = options;
    this.#tasks = tasks;
    this.#clock = clock;
    this.#sessions = sessions;
  }

  /** The holder for one composition, standing for the scope it is built in. */
  static make(
    options: LiveSessionHolderOptions,
  ): Effect.Effect<LiveSessionHolder, never, Scope.Scope> {
    return Effect.gen(function* () {
      const tasks = yield* Queue.unbounded<Effect.Effect<void>>();
      const fibers = yield* FiberSet.make();
      const scope = yield* Effect.scope;
      const holder = new LiveSessionHolder(
        options,
        tasks,
        yield* Clock.Clock,
        yield* Scope.fork(scope, "sequential"),
      );
      yield* Effect.forkScoped(
        Effect.forever(Effect.flatMap(Queue.take(tasks), (task) => FiberSet.run(fibers, task))),
      );
      return holder;
    });
  }

  /** Begins what nothing waits for, on the holder's own fiber. */
  #start(effect: Effect.Effect<void>): void {
    Queue.offerUnsafe(this.#tasks, effect);
  }

  /** Whether a session stands that the stop and the reports can reach. */
  sessionStands(): boolean {
    return this.#held !== undefined && !this.#held.ended;
  }

  /**
   * Creates the one session for the peer's offer, seeded with the bounded
   * roster summary and the recent conversation, and attaches the sideband
   * before the answer is returned, so no transcript precedes attachment. A
   * session already standing is closed gracefully first: there is one. The
   * scope the session stands in is opened before anything is created into it
   * and closed again unless a session came to stand there.
   */
  createSession(
    sdpOffer: string,
  ): Effect.Effect<{ sessionId: string; sdpAnswer: string } | undefined> {
    return Effect.gen({ self: this }, function* () {
      if (this.#held) yield* this.endSession();
      // The peer has answered the word, with this offer; whatever comes of it, the word is spent.
      this.#wantedAt = undefined;
      const source = this.#options.source();
      if (!source) {
        this.#beats.clear();
        return undefined;
      }
      const seeded = rosterSeed(
        this.#options.roster?.() ?? [],
        this.#clock.currentTimeMillisUnsafe(),
      );
      const scope = yield* Scope.fork(this.#sessions, "sequential");
      const created = yield* Effect.onExit(this.#stand(source, sdpOffer, seeded, scope), (exit) =>
        Exit.isSuccess(exit) && exit.value !== undefined
          ? Effect.void
          : Scope.close(scope, Exit.void),
      );
      // A session that could not be stood leaves no beat waiting for it: the
      // caller decides again at its next reason, and asks then stand rather
      // than being refused for a kind still waiting on a session that never came.
      if (created === undefined) this.#beats.clear();
      return created;
    });
  }

  #stand(
    source: LiveSessionSource,
    sdpOffer: string,
    seeded: RosterSummary | undefined,
    scope: Scope.Closeable,
  ): Effect.Effect<{ sessionId: string; sdpAnswer: string } | undefined> {
    return Effect.gen({ self: this }, function* () {
      const opened = yield* Scope.provide(
        source.create({ sdpOffer, input: this.#seedInput(seeded) }),
        scope,
      );
      if (!opened) return undefined;
      this.#options.emit({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
      const sideband = yield* Scope.provide(
        Effect.catch(opened.attach(), (failure) =>
          Effect.sync(() => {
            this.#options.report(`Live sideband could not attach: ${failure.message}`);
            this.#options.emit({
              sessionId: opened.sessionId,
              phase: LIVE_SESSION_PHASE.CLOSED,
              reason: "sideband-failed",
            });
            return undefined;
          }),
        ),
        scope,
      );
      if (!sideband) return undefined;
      const session: HeldSession = {
        sessionId: opened.sessionId,
        sideband,
        opened,
        scope,
        started: false,
        ended: false,
        closing: undefined,
        usageSeconds: undefined,
        settled: yield* Deferred.make<SidebandCloseResult>(),
        torn: yield* Deferred.make<void>(),
        released: yield* Deferred.make<void>(),
      };
      // The transport is released with the session's scope, whichever hand
      // ends the session: the graceful close already closed it, and a session
      // lost or torn down with the holder's own scope closes it here.
      yield* Scope.addFinalizer(scope, sideband.close);
      opened.onSpoken?.((kind) => this.#spoken(session, kind));
      yield* Effect.forkIn(this.#read(session), this.#sessions);
      this.#held = session;
      // The peer answered a `wanted` an audition asked for: this session is
      // the audition's to close, until something else is spoken into it.
      if (this.#beats.has(PROACTIVE_SPEECH_KIND.VOICE_PREVIEW)) this.#auditionSession = session;
      this.#options.onSessionCreated?.();
      return { sessionId: opened.sessionId, sdpAnswer: opened.sdpAnswer };
    });
  }

  /**
   * The fiber a held session belongs to: it reads the sideband on a child of
   * its own, waits for an end to be decided by whatever hand decides it, and
   * then closes the session's scope, so the release runs once, on one fiber,
   * and after the reading rather than in the middle of it.
   */
  #read(session: HeldSession): Effect.Effect<void> {
    return Effect.ensuring(
      Effect.gen({ self: this }, function* () {
        const arrivals = yield* Effect.forkChild(this.#arrivals(session));
        yield* Deferred.await(session.torn);
        yield* Fiber.interrupt(arrivals);
        yield* Scope.close(session.scope, Exit.void);
      }),
      Effect.sync(() => {
        Deferred.doneUnsafe(session.released, Exit.void);
        if (this.#releasing === session.released) this.#releasing = undefined;
      }),
    );
  }

  /** The one consumer of the session's sideband here; the three events the phases need, and the end. */
  #arrivals(session: HeldSession): Effect.Effect<void> {
    return Stream.runForEach(session.sideband.arrivals, (arrival) => {
      if ("close" in arrival) {
        Deferred.doneUnsafe(
          session.settled,
          Exit.succeed({ outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST, close: arrival.close }),
        );
        return session.ended || session.closing
          ? Effect.void
          : this.#lost(session, LIVE_CLOSE_REASON.CONNECTION_LOST);
      }
      if (arrival.event.type === LIVE_SERVER_EVENT.SESSION_CLOSED) {
        Deferred.doneUnsafe(
          session.settled,
          Exit.succeed({ outcome: SIDEBAND_CLOSE_OUTCOME.CLOSED, closed: arrival.event }),
        );
      }
      return this.#onEvent(session, arrival.event);
    });
  }

  #onEvent(session: HeldSession, event: LiveServerEvent): Effect.Effect<void> {
    if (session.ended) return Effect.void;
    switch (event.type) {
      case LIVE_SERVER_EVENT.SESSION_STARTED:
        session.started = true;
        this.#options.emit({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.STARTED });
        this.#sendBeats(session);
        return Effect.void;
      case LIVE_SERVER_EVENT.USAGE_UPDATED:
        session.usageSeconds = event.usage.seconds;
        return Effect.void;
      case LIVE_SERVER_EVENT.SESSION_CLOSED:
        return this.#onClosed(session, event);
      default:
        return Effect.void;
    }
  }

  /**
   * The renderer's hang-up, the peer's closed transport, and the drain all
   * end the session the same way: whichever stands when the ask is run, or,
   * where one was declared over a turn ago and is still being released, that
   * release, so the drain answers with the socket closed.
   */
  endSession(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const session = this.#held;
      if (session !== undefined) return this.#end(session);
      const releasing = this.#releasing;
      return releasing === undefined ? Effect.void : Deferred.await(releasing);
    });
  }

  #end(session: HeldSession): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (session.ended) return yield* Deferred.await(session.released);
      const standing = session.closing;
      if (standing !== undefined) return yield* Deferred.await(standing);
      const closing = yield* Deferred.make<void>();
      session.closing = closing;
      yield* Effect.onExit(this.#close(session), (exit) => Deferred.done(closing, exit));
    });
  }

  #close(session: HeldSession): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.#options.emit({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSING });
      const result = yield* closeGracefully(session.sideband, {
        eventId: this.#options.createId(),
        settled: Deferred.await(session.settled),
      });
      if (result.outcome === SIDEBAND_CLOSE_OUTCOME.CLOSED) {
        return yield* this.#onClosed(session, result.closed);
      }
      yield* this.#lost(
        session,
        result.outcome === SIDEBAND_CLOSE_OUTCOME.TIMED_OUT
          ? "close timed out"
          : LIVE_CLOSE_REASON.CONNECTION_LOST,
      );
    });
  }

  /**
   * The peer's transport as it saw it change, acted on here where the
   * transport is: a failed transport is a lost connection whatever the
   * sideband still shows, and a peer closed without a hang-up asked of the
   * host ends the session gracefully from here. Neither is told to the
   * service; both reach it as the close they cause.
   */
  reportTransport(state: LiveTransportState): void {
    const session = this.#held;
    if (!session || session.ended) return;
    if (state === LIVE_TRANSPORT_STATE.FAILED) {
      this.#start(this.#lost(session, "peer transport failed"));
      return;
    }
    if (state === LIVE_TRANSPORT_STATE.CLOSED && !session.closing) this.#start(this.#end(session));
  }

  /**
   * The renderer's idle report, carried to the service that holds the
   * exchange: only it knows when it last appended and whether a reply is
   * still coming, so only it can decide the idle close. A session opened
   * through no service has no one to tell, and the report goes nowhere.
   */
  reportActivity(idle: boolean): void {
    const session = this.#held;
    if (!session || session.ended) return;
    session.opened.reportActivity?.(idle);
  }

  /**
   * The stop key: the service is asked, through the source's door, to tell
   * the model to stop and then wait, and the service's exchange appends the
   * one instruction that says so, so nothing here names or appends it.
   * Answers whether a started session with someone to ask was there; a
   * session opened through no service has no door, and the microphone is
   * the peer's to mute and is not touched here.
   */
  stopSpeaking(): boolean {
    const session = this.#held;
    if (!session?.started || session.ended) return false;
    const stop = session.opened.stopSpeaking;
    if (stop === undefined) return false;
    stop();
    return true;
  }

  /**
   * A beat the caller decided is owed: asked of the service through the
   * source's door once a session has started, and held for one until then,
   * with the peer told the session is wanted so it opens one muted for it.
   * Answers whether the ask stands: a kind already asked for and not yet
   * spoken is not asked twice. A session opened through no service has no
   * door, and a beat that finds none is dropped rather than held for a
   * service that will never stand.
   */
  speakBeat(beat: SessionBeatFrame): boolean {
    if (this.#beats.has(beat.kind)) return false;
    this.#arm(beat);
    return true;
  }

  /**
   * The voice picker's audition: the developer has just chosen a voice and is
   * listening for it. GPT Live fixes a session's voice at creation and offers
   * no preview of its own, so what is heard is a session created with the
   * voice the write has already stored, saying the build's one line into it.
   *
   * A session opened for an earlier audition is closed first and a new one
   * asked for, so the voice chosen last is the voice heard and two auditions
   * never speak over each other; the word `wanted` the close is followed by
   * is the same one a beat asks with, so the peer opens the muted session
   * exactly as it does for any other. An ordinary session standing is left
   * alone and nothing is auditioned: it keeps the voice it opened with, which
   * is what the picker's own line says, and ending a conversation to
   * demonstrate a voice would be the worse of the two. Answers whether an
   * audition was begun.
   */
  previewVoice(): boolean {
    if (this.#options.source() === undefined) return false;
    const audition = ++this.#audition;
    const session = this.#held;
    if (session === undefined || session.ended) {
      this.#beginAudition(audition);
      return true;
    }
    if (this.#auditionSession !== session) return false;
    this.#start(
      Effect.gen({ self: this }, function* () {
        yield* this.#end(session);
        // Overtaken while the close was out: the audition that overtook this
        // one has asked for its own session and this one adds nothing.
        if (audition !== this.#audition) return;
        this.#beginAudition(audition);
      }),
    );
    return true;
  }

  /**
   * The audition asked for: the beat waits for the session the peer is told
   * is wanted, and the ceiling stands from here rather than from the session,
   * so an audition whose session never comes, or whose line is never heard,
   * still gives the session back.
   */
  #beginAudition(audition: number): void {
    this.#arm(VOICE_PREVIEW_BEAT);
    this.#endAuditionAfter(audition, VOICE_PREVIEW_SESSION.CEILING_MS);
  }

  /** A beat put where the session that speaks it will find it, and the peer told one is wanted if none stands. */
  #arm(beat: SessionBeatFrame): void {
    this.#beats.set(beat.kind, { beat, sent: false });
    const session = this.#held;
    if (session === undefined || session.ended) {
      this.#askWanted();
      return;
    }
    if (session.started) this.#sendBeats(session);
  }

  /**
   * The audition's session given back on its own clock, on a fiber of the
   * holder's own: the audition that armed it must still be the standing one,
   * and the session must still be the audition's alone.
   */
  #endAuditionAfter(audition: number, delayMs: number): void {
    this.#start(
      Effect.gen({ self: this }, function* () {
        yield* Effect.sleep(Duration.millis(delayMs));
        if (audition !== this.#audition) return;
        const session = this.#auditionSession;
        if (session === undefined || session.ended) return;
        yield* this.#end(session);
      }),
    );
  }

  /** Whether the peer has been told a session is wanted, within the word's own standing, and has not yet offered one. */
  sessionWanted(): boolean {
    return (
      this.#wantedAt !== undefined &&
      this.#clock.currentTimeMillisUnsafe() - this.#wantedAt < WANTED_WORD.STANDS_MS
    );
  }

  /**
   * Takes the word back before the peer has answered: the reasons for the
   * session have gone (a hold began, the account signed out), so the next
   * reason asks afresh. A session already offered is not touched.
   */
  dropWant(): void {
    this.#wantedAt = undefined;
  }

  /**
   * The caller wants a session and has nothing to send into it: a briefing
   * stands on offer to the account, and the service's exchange will claim
   * and speak it once a session stands. The peer is told the session is
   * wanted so it opens one muted, exactly as for a beat; a session already
   * standing is left to its own exchange's look, and a `wanted` already out
   * for a beat is the same word. Answers whether the peer was told.
   */
  wantSession(): boolean {
    if (this.sessionStands() || this.sessionWanted()) return false;
    this.#askWanted();
    return true;
  }

  /** One `wanted` to the peer for however many reasons stand, until it answers with an offer or the word lapses. */
  #askWanted(): void {
    if (this.sessionWanted()) return;
    this.#wantedAt = this.#clock.currentTimeMillisUnsafe();
    this.#options.emit({ phase: LIVE_SESSION_PHASE.WANTED });
  }

  /**
   * Removes a beat whose reason has gone, or that a hold now keeps, before it
   * was sent, and answers whether one was waiting; one the service already
   * has is the service's to speak, and is not withdrawn.
   */
  withdrawBeat(kind: BeatKind): boolean {
    const standing = this.#beats.get(kind);
    if (standing === undefined || standing.sent) return false;
    this.#beats.delete(kind);
    return true;
  }

  /** The drain: the session is closed gracefully inside the quit's own deadline, and nothing is opened after. */
  stop(): Effect.Effect<void> {
    return this.endSession();
  }

  /** Every beat still waiting goes to the service now, or nowhere on a session with no door. */
  #sendBeats(session: HeldSession): void {
    const speak = session.opened.speakBeat;
    for (const [kind, standing] of [...this.#beats]) {
      if (standing.sent) continue;
      if (speak === undefined) {
        this.#beats.delete(kind);
        continue;
      }
      standing.sent = true;
      speak(standing.beat);
    }
  }

  /** The service's word that a turn was spoken to its end: a beat of this holder's is settled, and the caller is told whatever the kind. */
  #spoken(session: HeldSession, kind: ProactiveSpeechKind): void {
    if (session.ended) return;
    if (kind !== PROACTIVE_SPEECH_KIND.BRIEFING) this.#beats.delete(kind);
    if (kind === PROACTIVE_SPEECH_KIND.VOICE_PREVIEW) {
      // Heard, not finished: a commentary settles as spoken when the output
      // first runs past it, so the session stands a moment longer and the
      // line is not cut off by the close that follows it.
      this.#endAuditionAfter(this.#audition, VOICE_PREVIEW_SESSION.LINGER_MS);
    } else if (this.#auditionSession === session) {
      // Something the audition did not ask for was spoken into its session:
      // it is a session with a turn in it now, and no longer one to close.
      this.#auditionSession = undefined;
    }
    this.#options.onSpoken?.(kind);
  }

  /**
   * What a session opens knowing: the desk first, then the recent
   * conversation. The roster item is never the one dropped, so the
   * conversation is built under what the roster item leaves of the API's
   * bounds.
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

  #onClosed(session: HeldSession, closed: LiveSessionClosed): Effect.Effect<void> {
    if (session.ended) return Deferred.await(session.released);
    session.usageSeconds = closed.usage.seconds;
    return this.#tearDown(session, closed.reason);
  }

  /** The session ended without `session.closed`: the latest usage stands unconfirmed. */
  #lost(session: HeldSession, reason: string): Effect.Effect<void> {
    if (session.ended) return Deferred.await(session.released);
    return this.#tearDown(session, reason);
  }

  /**
   * The session is over the instant this is called: `#held` and the phase
   * are settled here, on the hand that decided it. The release is the
   * reader's own to run, so what is handed back is that release to wait for.
   */
  #tearDown(session: HeldSession, reason: string): Effect.Effect<void> {
    session.ended = true;
    if (this.#held === session) this.#held = undefined;
    if (this.#auditionSession === session) this.#auditionSession = undefined;
    // A beat the session ended on, sent or waiting, is not carried to the
    // next: the caller decides again at its next reason to, and a beat that
    // was spoken settled itself before this.
    this.#beats.clear();
    this.#releasing = session.released;
    Deferred.doneUnsafe(session.torn, Exit.void);
    this.#options.emit({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSED, reason });
    return Deferred.await(session.released);
  }
}
