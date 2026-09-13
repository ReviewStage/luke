import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type LiveTransportState,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import {
  conversationSeedItems,
  type InitialItem,
  LIVE_CLOSE_REASON,
  LIVE_INPUT_BOUNDS,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  type LiveSessionClosed,
  type RosterSeedSession,
  type RosterSummary,
  rosterSeed,
  rosterSeedItem,
  seedItemTokens,
} from "@sidecar/live";
import type { ConversationEntry } from "@sidecar/session";
import {
  type Clock,
  Deferred,
  Effect,
  ExecutionStrategy,
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

/**
 * The peer's side of one hosted voice session, which is everything the Mac
 * still holds of a session once the exchange is the service's. It creates
 * the session for the renderer's offer, seeded from the recent Conversation
 * and the desk as the Mac sees them, and holds the sideband the service
 * answered on for exactly three things: the graceful close, which sends
 * `session.close` and waits for `session.closed` as the conversations guide
 * prescribes; and the stop key and the idle report, each told to the service
 * in its own vocabulary through the door the source opened, because the
 * instruction the stop appends and the idle decision both belong to the
 * exchange the service holds. Nothing else leaves this side, and no append
 * at all: the desktop never appends to a session. Every delegation the session
 * creates, every transcript delta, and every acknowledgment reaches the
 * service's exchange over the same socket ahead of this holder, and this
 * holder reads of them only what its phases need: the start, the usage, and
 * the close. It appends no thinking, no commentary, and no reply, decides no
 * briefing, and wants no session of its own, so the `wanted` phase is never
 * announced from here; the renderer's hang-up and the peer's transport are
 * the only reasons a session ends from this side, and the service's idle
 * close reaches it as the `session.closed` the relay forwards.
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
}

interface HeldSession {
  readonly sessionId: string;
  readonly sideband: LiveSideband;
  readonly opened: LiveSessionOpened;
  /** The scope this one session stands in, closed by the fiber that reads it once the end is decided. */
  readonly scope: Scope.CloseableScope;
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

export class LiveSessionHolder {
  readonly #options: LiveSessionHolderOptions;
  #held: HeldSession | undefined;
  /** The release still running for the session last declared over, so an end asked for meanwhile waits for it. */
  #releasing: Deferred.Deferred<void> | undefined;
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
        yield* Effect.clock,
        yield* Scope.fork(scope, ExecutionStrategy.sequential),
      );
      yield* Effect.forkScoped(
        Effect.forever(Effect.flatMap(Queue.take(tasks), (task) => FiberSet.run(fibers, task))),
      );
      return holder;
    });
  }

  /** Begins what nothing waits for, on the holder's own fiber. */
  #start(effect: Effect.Effect<void>): void {
    Queue.unsafeOffer(this.#tasks, effect);
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
    return Effect.gen(this, function* () {
      if (this.#held) yield* this.endSession();
      const source = this.#options.source();
      if (!source) return undefined;
      const seeded = rosterSeed(
        this.#options.roster?.() ?? [],
        this.#clock.unsafeCurrentTimeMillis(),
      );
      const scope = yield* Scope.fork(this.#sessions, ExecutionStrategy.sequential);
      return yield* Effect.onExit(this.#stand(source, sdpOffer, seeded, scope), (exit) =>
        Exit.isSuccess(exit) && exit.value !== undefined
          ? Effect.void
          : Scope.close(scope, Exit.void),
      );
    });
  }

  #stand(
    source: LiveSessionSource,
    sdpOffer: string,
    seeded: RosterSummary | undefined,
    scope: Scope.CloseableScope,
  ): Effect.Effect<{ sessionId: string; sdpAnswer: string } | undefined> {
    return Effect.gen(this, function* () {
      const opened = yield* Scope.extend(
        source.create({ sdpOffer, input: this.#seedInput(seeded) }),
        scope,
      );
      if (!opened) return undefined;
      this.#options.emit({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
      const sideband = yield* Scope.extend(
        Effect.catchAll(opened.attach(), (failure) =>
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
      yield* Effect.forkIn(this.#read(session), this.#sessions);
      this.#held = session;
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
      Effect.gen(this, function* () {
        const arrivals = yield* Effect.fork(this.#arrivals(session));
        yield* Deferred.await(session.torn);
        yield* Fiber.interrupt(arrivals);
        yield* Scope.close(session.scope, Exit.void);
      }),
      Effect.sync(() => {
        Deferred.unsafeDone(session.released, Exit.void);
        if (this.#releasing === session.released) this.#releasing = undefined;
      }),
    );
  }

  /** The one consumer of the session's sideband here; the three events the phases need, and the end. */
  #arrivals(session: HeldSession): Effect.Effect<void> {
    return Stream.runForEach(session.sideband.arrivals, (arrival) => {
      if ("close" in arrival) {
        Deferred.unsafeDone(
          session.settled,
          Exit.succeed({ outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST, close: arrival.close }),
        );
        return session.ended || session.closing
          ? Effect.void
          : this.#lost(session, LIVE_CLOSE_REASON.CONNECTION_LOST);
      }
      if (arrival.event.type === LIVE_SERVER_EVENT.SESSION_CLOSED) {
        Deferred.unsafeDone(
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
    return Effect.gen(this, function* () {
      if (session.ended) return yield* Deferred.await(session.released);
      const standing = session.closing;
      if (standing !== undefined) return yield* Deferred.await(standing);
      const closing = yield* Deferred.make<void>();
      session.closing = closing;
      yield* Effect.onExit(this.#close(session), (exit) => Deferred.done(closing, exit));
    });
  }

  #close(session: HeldSession): Effect.Effect<void> {
    return Effect.gen(this, function* () {
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

  /** The drain: the session is closed gracefully inside the quit's own deadline, and nothing is opened after. */
  stop(): Effect.Effect<void> {
    return this.endSession();
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
    this.#releasing = session.released;
    Deferred.unsafeDone(session.torn, Exit.void);
    this.#options.emit({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSED, reason });
    return Deferred.await(session.released);
  }
}
