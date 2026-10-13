import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type LivePeerEndReason,
  type LiveTransportState,
  type VoiceLiveSessionChanged,
  type VoiceReportLiveTransportParams,
} from "@sidecar/gateway";
import {
  AVATAR_STOP_REASON,
  type AvatarEndedFrame,
  type AvatarEndReason,
  type AvatarStartedFrame,
  type AvatarStopReason,
  type AvatarUnavailableFrame,
  type AvatarUnavailableReason,
  type LiveSessionCreated,
  type PlanActivityFrame,
  type PlanCallEndingFrame,
  type PlanCodeFrame,
  type PlanDraftFrame,
  type PlanWorkFrame,
  VOICE_SERVICE_FRAME,
} from "@sidecar/hosted";
import {
  generalLiveError,
  LIVE_CLOSE_REASON,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  type LiveSessionClosed,
  liveErrorFields,
} from "@sidecar/live";
import { causeKind, type SerialQueue, serialQueue } from "@sidecar/runtime/effect";
import {
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { AvatarMedia } from "../avatar/avatar-media.js";
import {
  createdOf,
  type LiveSessionOpened,
  type LiveSessionSource,
} from "../live-session-source.js";
import type { LiveSideband } from "../live-socket.js";
import {
  requestClose,
  SIDEBAND_CLOSE_OUTCOME,
  type SidebandCloseResult,
} from "./graceful-close.js";

/**
 * The peer's side of one hosted planning call, which is everything the Mac
 * still holds of a session once the exchange is the service's. It creates
 * the session about the open plan for the renderer's offer, and holds the
 * sideband the service answered on for three things: the graceful close,
 * which asks the service for the `session.close` it owns and waits for
 * `session.closed` as the conversations guide prescribes; and the stop key
 * and the idle report, each told to the service in its own vocabulary
 * through the door the source opened, because the instruction the stop
 * appends and the idle decision belong to the exchange the service holds.
 * Nothing else leaves this side, and no append at all: the desktop never
 * appends to a session. Every delegation the session creates, every
 * transcript delta, and every acknowledgment reaches the service's exchange
 * over the same socket ahead of this holder, and this holder reads of them
 * only what its phases need: the start, the usage, and the close, beside the
 * plan's drafts and activity it passes on. The renderer's hang-up and the
 * peer's transport are the only reasons a session ends from this side, and
 * the service's idle close
 * reaches it as the `session.closed` the relay forwards.
 *
 * Luke's face on the call is the one other thing held here: the video switch
 * asks the service for it and takes it down, the room the service answers
 * is published in process, never as an event, since its viewer token is a
 * credential, and the media socket Luke's voice is spoken into stands in a
 * scope of the face's own inside the session's, told to the service as media
 * lost when it gives up.
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
  emit: (change: VoiceLiveSessionChanged) => void;
  /** A session was created: the one count the holder makes. */
  onSessionCreated?: () => void;
  /**
   * The service's notetaker sent a draft of the plan the standing planning
   * call is about: a draft for any other plan, or from a session already
   * ended, never reaches it. What the draft is shown as is the caller's.
   */
  onPlanDraft?: (draft: PlanDraftFrame) => void;
  /**
   * The service said what each part of Luke is doing on the standing
   * planning call, on the same terms as `onPlanDraft`. A planning call's end
   * is told as a snapshot with nothing doing, so none outlives the call.
   */
  onPlanActivity?: (activity: PlanActivityFrame) => void;
  /** Luke put code on screen on the standing planning call, on the same terms as `onPlanDraft`. */
  onPlanCode?: (code: PlanCodeFrame) => void;
  /** A planning turn's work on the standing planning call changed, on the same terms as `onPlanDraft`. */
  onPlanWork?: (work: PlanWorkFrame) => void;
  /** The planning call about the plan named ended, so what it put on screen goes with it. */
  onPlanCallEnded?: (planId: string) => void;
  /**
   * Opens the media socket Luke's voice is spoken into for the face, standing
   * for the scope it is acquired in. Without it the holder puts no face up.
   */
  acquireAvatarMedia?: (url: string) => Effect.Effect<AvatarMedia, never, Scope.Scope>;
}

/**
 * Where Luke's face on the standing call is, as the host holds it: `OFF`
 * until video is asked for, `STARTING` while the service mints it, `STARTED`
 * once its room stands and its media socket is opening, `ENDED` once it is down
 * with the call going on, and `UNAVAILABLE` where the service could not put
 * one up. Whether its first frame has drawn is the call window's to say.
 */
export const HELD_AVATAR_STATUS = {
  OFF: "off",
  STARTING: "starting",
  STARTED: "started",
  ENDED: "ended",
  UNAVAILABLE: "unavailable",
} as const;

export type HeldAvatarState =
  | { readonly status: typeof HELD_AVATAR_STATUS.OFF }
  | { readonly status: typeof HELD_AVATAR_STATUS.STARTING }
  | { readonly status: typeof HELD_AVATAR_STATUS.STARTED }
  | { readonly status: typeof HELD_AVATAR_STATUS.ENDED; readonly reason: AvatarEndReason }
  | {
      readonly status: typeof HELD_AVATAR_STATUS.UNAVAILABLE;
      readonly reason: AvatarUnavailableReason;
    };

/**
 * The room the face is published into and the token the call window watches
 * it with. The token is a credential: it is handed on in process to the call
 * window alone, and never into a Gateway answer or event, app state, a
 * counted event, a trace, or a fixture.
 */
export interface AvatarRoom {
  readonly livekitUrl: string;
  readonly viewerToken: string;
}

const AVATAR_OFF: HeldAvatarState = { status: HELD_AVATAR_STATUS.OFF };

/**
 * Which hand ended a held session, named in the line the holder logs when a
 * session ends, so a call that dropped says why without anyone reading the
 * code for every path that could have closed it.
 */
export const LIVE_SESSION_END_CAUSE = {
  /** The plan the call is about was deleted. */
  PLAN_DELETED: "plan_deleted",
  /** The account signed out. */
  SIGNED_OUT: "signed_out",
  /** The peer asked the host to hang up. */
  HANG_UP: "hang_up",
  /** The stored voice changed, which a standing session cannot follow. */
  VOICE_CHANGED: "voice_changed",
  /** The quit's drain. */
  DRAIN: "drain",
  /** The peer offered a new session while one stood. */
  REPLACED: "replaced",
  /** The peer reported its transport closed. */
  PEER_CLOSED: "peer_closed",
  /** The peer reported its transport failed. */
  PEER_FAILED: "peer_failed",
  /** The service's `session.closed` arrived unasked. */
  SERVICE_CLOSED: "service_closed",
  /** The sideband socket ended unasked. */
  SIDEBAND_LOST: "sideband_lost",
} as const;

export type LiveSessionEndCause =
  (typeof LIVE_SESSION_END_CAUSE)[keyof typeof LIVE_SESSION_END_CAUSE];

/** A creation under way: the plan it is about, and the end a delete or a sign-out asked for meanwhile. */
interface Creating {
  readonly planId: string;
  endedBy: LiveSessionEndCause | undefined;
}

interface HeldSession {
  readonly sessionId: string;
  /** When the session came to stand, for the seconds its end reports. */
  readonly stoodAt: number;
  /** The hand that first decided the end, and the peer's own reason where it reported one. */
  endCause: LiveSessionEndCause | undefined;
  peerReason: LivePeerEndReason | undefined;
  /** The plan the call is about, which the session is bound to for its life. */
  readonly planId: string;
  readonly sideband: LiveSideband;
  readonly opened: LiveSessionOpened;
  /** The scope this one session stands in, closed by the fiber that reads it once the end is decided. */
  readonly scope: Scope.Closeable;
  /** The face's media on this call, from `avatar.started` until the face is down. */
  avatar: HeldAvatar | undefined;
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

/** One face's media: the scope its socket stands in, a child of the session's, and the socket once open. */
interface HeldAvatar {
  readonly scope: Scope.Closeable;
  media: AvatarMedia | undefined;
}

/** What a line names of a session: its id, never its words. */
function sessionFields(session: HeldSession | undefined): string {
  if (session === undefined) return "session=none";
  return `session=${session.sessionId}`;
}

function transportLine(
  state: LiveTransportState,
  peerReason: LivePeerEndReason | undefined,
  sessionId: string,
): string {
  const reason = peerReason === undefined ? "" : ` peer_reason=${peerReason}`;
  return `voice transport: state=${state}${reason} session=${sessionId}`;
}

function endedLine(session: HeldSession, reason: string, seconds: number): string {
  const peer = session.peerReason === undefined ? "" : ` peer_reason=${session.peerReason}`;
  return `voice call ended: cause=${session.endCause}${peer} close_reason=${reason} ${sessionFields(session)} seconds=${seconds}`;
}

export class LiveSessionHolder {
  readonly #options: LiveSessionHolderOptions;
  #held: HeldSession | undefined;
  /**
   * The session being created and not yet held: the plan it is about, and
   * whether a delete or a sign-out has meanwhile asked for a call about that
   * plan to end, so the session is ended the moment it stands rather than
   * left standing about a plan that is gone.
   */
  #creating: Creating | undefined;
  /** The release still running for the session last declared over, so an end asked for meanwhile waits for it. */
  #releasing: Deferred.Deferred<void> | undefined;
  /** The fibers the tasks run as, one each, all ended by the holder's scope. */
  readonly #fibers: FiberSet.FiberSet<void, unknown>;
  /** The door a synchronous edge starts a task through: the queue forks it into the set. */
  readonly #tasks: SerialQueue;
  readonly #clock: Clock.Clock;
  readonly #sessions: Scope.Scope;
  /**
   * The face as the holder decided it, set on the hand that decides, and the
   * room it stands in; each is published to its observable from here.
   */
  #avatar: HeldAvatarState = AVATAR_OFF;
  #room: AvatarRoom | undefined;
  readonly #avatarRef: SubscriptionRef.SubscriptionRef<HeldAvatarState>;
  readonly #roomRef: SubscriptionRef.SubscriptionRef<AvatarRoom | undefined>;

  private constructor(
    options: LiveSessionHolderOptions,
    running: { readonly fibers: FiberSet.FiberSet<void, unknown>; readonly tasks: SerialQueue },
    clock: Clock.Clock,
    sessions: Scope.Scope,
    refs: {
      readonly avatar: SubscriptionRef.SubscriptionRef<HeldAvatarState>;
      readonly room: SubscriptionRef.SubscriptionRef<AvatarRoom | undefined>;
    },
  ) {
    this.#options = options;
    this.#fibers = running.fibers;
    this.#tasks = running.tasks;
    this.#clock = clock;
    this.#sessions = sessions;
    this.#avatarRef = refs.avatar;
    this.#roomRef = refs.room;
  }

  /** The holder for one composition, standing for the scope it is built in. */
  static make(
    options: LiveSessionHolderOptions,
  ): Effect.Effect<LiveSessionHolder, never, Scope.Scope> {
    return Effect.gen(function* () {
      const fibers = yield* FiberSet.make<void>();
      const tasks = yield* serialQueue({
        onDefect: (cause) =>
          Effect.logError(`a live session task could not be started: ${causeKind(cause)}`),
      });
      const scope = yield* Effect.scope;
      return new LiveSessionHolder(
        options,
        { fibers, tasks },
        yield* Clock.Clock,
        yield* Scope.fork(scope, "sequential"),
        {
          avatar: yield* SubscriptionRef.make(AVATAR_OFF),
          room: yield* SubscriptionRef.make<AvatarRoom | undefined>(undefined),
        },
      );
    });
  }

  /** Begins what nothing waits for, on the holder's own fiber. */
  #start(effect: Effect.Effect<void>): void {
    this.#tasks.offerUnsafe(Effect.asVoid(FiberSet.run(this.#fibers, effect)));
  }

  /** Whether a session stands that the stop and the reports can reach. */
  sessionStands(): boolean {
    return this.#held !== undefined && !this.#held.ended;
  }

  /**
   * Ends the standing session where it is a planning call about `planId`,
   * or whatever it is about where none is named: the plan is being deleted,
   * and a call still standing would go on writing a document that is gone,
   * or the account signed out. The panel opening another plan or leaving
   * this one ends nothing, because the call outlives the plan on screen.
   */
  endPlanCall(planId: string | undefined): Effect.Effect<void> {
    return Effect.suspend(() => {
      const cause =
        planId === undefined
          ? LIVE_SESSION_END_CAUSE.SIGNED_OUT
          : LIVE_SESSION_END_CAUSE.PLAN_DELETED;
      const about = (candidate: string) => planId === undefined || candidate === planId;
      const creating = this.#creating;
      if (creating !== undefined && about(creating.planId)) creating.endedBy ??= cause;
      const session = this.#held;
      if (session === undefined || !about(session.planId)) return Effect.void;
      return this.#end(session, cause);
    });
  }

  /**
   * Creates the one session for the peer's offer, about its plan, and
   * attaches the sideband before the answer is returned, so no transcript
   * precedes attachment. The session is seeded with nothing: what it knows
   * is the plan's, and the service holds that. A session already standing is
   * closed gracefully first: there is one. The scope the session stands in
   * is opened before anything is created into it and closed again unless a
   * session came to stand there.
   */
  createSession(sdpOffer: string, planId: string): Effect.Effect<LiveSessionCreated | undefined> {
    // The creation is named from its first step to its last, so an end landing
    // anywhere in it (the prior session's end, the create, the attach) is heard.
    const creating: Creating = { planId, endedBy: undefined };
    return Effect.ensuring(
      Effect.suspend(() => {
        this.#creating = creating;
        return this.#create(sdpOffer, creating);
      }),
      Effect.sync(() => {
        if (this.#creating === creating) this.#creating = undefined;
      }),
    );
  }

  #create(sdpOffer: string, creating: Creating): Effect.Effect<LiveSessionCreated | undefined> {
    return Effect.gen({ self: this }, function* () {
      if (this.#held) yield* this.endSession(LIVE_SESSION_END_CAUSE.REPLACED);
      const source = this.#options.source();
      if (!source || creating.endedBy !== undefined) return undefined;
      const scope = yield* Scope.fork(this.#sessions, "sequential");
      const created = yield* Effect.onExit(
        this.#stand(source, sdpOffer, creating.planId, scope),
        (exit) =>
          Exit.isSuccess(exit) && exit.value !== undefined
            ? Effect.void
            : Scope.close(scope, Exit.void),
      );
      // An end that landed while the call was being created ends it now that
      // it stands, so the peer is told to hang up and nothing is said into it.
      const held = this.#held;
      if (created !== undefined && creating.endedBy !== undefined && held !== undefined) {
        yield* this.#end(held, creating.endedBy);
        return undefined;
      }
      return created;
    });
  }

  #stand(
    source: LiveSessionSource,
    sdpOffer: string,
    planId: string,
    scope: Scope.Closeable,
  ): Effect.Effect<LiveSessionCreated | undefined> {
    return Effect.gen({ self: this }, function* () {
      const opened = yield* Scope.provide(source.create({ sdpOffer, planId }), scope);
      if (!opened) return undefined;
      this.#options.emit({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
      const sideband = yield* Scope.provide(opened.attach(), scope);
      const session: HeldSession = {
        sessionId: opened.sessionId,
        stoodAt: this.#clock.currentTimeMillisUnsafe(),
        endCause: undefined,
        peerReason: undefined,
        planId,
        sideband,
        opened,
        scope,
        avatar: undefined,
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
      opened.onPlanDraft?.((draft) => this.#drafted(session, draft));
      opened.onPlanActivity?.((activity) => this.#activity(session, activity));
      opened.onPlanCode?.((code) => this.#code(session, code));
      opened.onPlanWork?.((work) => this.#work(session, work));
      opened.onPlanCallEnding?.((ending) => this.#ending(session, ending));
      opened.onAvatarStarted?.((started) => this.#avatarStarted(session, started));
      opened.onAvatarEnded?.((ended) => this.#avatarEnded(session, ended));
      opened.onAvatarUnavailable?.((unavailable) => this.#avatarUnavailable(session, unavailable));
      yield* Effect.forkIn(this.#read(session), this.#sessions);
      this.#held = session;
      this.#options.onSessionCreated?.();
      return createdOf(opened);
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
          : this.#lost(
              session,
              LIVE_CLOSE_REASON.CONNECTION_LOST,
              LIVE_SESSION_END_CAUSE.SIDEBAND_LOST,
            );
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
        return Effect.void;
      case LIVE_SERVER_EVENT.USAGE_UPDATED:
        session.usageSeconds = event.usage.seconds;
        return Effect.void;
      case LIVE_SERVER_EVENT.SESSION_CLOSED:
        return this.#onClosed(session, event);
      case LIVE_SERVER_EVENT.ERROR:
        // The holder sends no command an error could name, so the general
        // handler is the only one an error reaches here.
        return generalLiveError(event)
          ? Effect.logWarning(`voice error: ${liveErrorFields(event)} ${sessionFields(session)}`)
          : Effect.void;
      default:
        return Effect.void;
    }
  }

  /**
   * The host's own ends of the session (the drain, a changed voice, a
   * replacement) name no session, because each means whichever stands when
   * the ask is run, or, where one was declared over a turn ago and is still
   * being released, that release, so the drain answers with the socket
   * closed. `cause` is the hand asking, named in the line the end is logged
   * under.
   */
  endSession(cause: LiveSessionEndCause): Effect.Effect<void> {
    return Effect.suspend(() => {
      const session = this.#held;
      if (session !== undefined) return this.#end(session, cause);
      const releasing = this.#releasing;
      return releasing === undefined ? Effect.void : Deferred.await(releasing);
    });
  }

  #end(session: HeldSession, cause: LiveSessionEndCause): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (session.ended) return yield* Deferred.await(session.released);
      const standing = session.closing;
      if (standing !== undefined) return yield* Deferred.await(standing);
      session.endCause ??= cause;
      const closing = yield* Deferred.make<void>();
      session.closing = closing;
      yield* Effect.onExit(this.#close(session), (exit) => Deferred.done(closing, exit));
    });
  }

  #close(session: HeldSession): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.#options.emit({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSING });
      // Note that we ask rather than send, because the session's one
      // `session.close` is the service's: its `session.closed` still reaches
      // this reader, which stood before the ask went.
      const result = yield* requestClose(
        session.sideband,
        Effect.sync(() => session.opened.hangUp()),
        { settled: Deferred.await(session.settled) },
      );
      if (result.outcome === SIDEBAND_CLOSE_OUTCOME.CLOSED) {
        return yield* this.#onClosed(session, result.closed);
      }
      // Note that the cause stands already: it is the hand that asked for this close.
      yield* this.#lost(
        session,
        result.outcome === SIDEBAND_CLOSE_OUTCOME.TIMED_OUT
          ? "close timed out"
          : LIVE_CLOSE_REASON.CONNECTION_LOST,
        LIVE_SESSION_END_CAUSE.SIDEBAND_LOST,
      );
    });
  }

  /**
   * The peer's hang-up of the session it names. A peer still closing a call
   * the host has already let go of names that call's session, so its ask
   * ends nothing standing after it.
   */
  hangUp(sessionId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const session = this.#held;
      if (session === undefined || session.sessionId !== sessionId) return Effect.void;
      return this.#end(session, LIVE_SESSION_END_CAUSE.HANG_UP);
    });
  }

  /**
   * The peer's transport as it saw it change, acted on here where the
   * transport is: a failed transport is a lost connection whatever the
   * sideband still shows, and a peer closed without a hang-up asked of the
   * host ends the session gracefully from here. Neither is told to the
   * service; both reach it as the close they cause. Every report is logged,
   * with the peer's reason where it gave one, since the peer's own view of
   * its connection is what a dropped call is read back from. A report about
   * any session but the one held is an old peer's late word and acts on
   * nothing.
   */
  reportTransport(report: VoiceReportLiveTransportParams): void {
    const { sessionId, state, reason: peerReason } = report;
    this.#start(Effect.logInfo(transportLine(state, peerReason, sessionId)));
    const session = this.#held;
    if (!session || session.ended || session.sessionId !== sessionId) return;
    session.peerReason ??= peerReason;
    if (state === LIVE_TRANSPORT_STATE.FAILED) {
      this.#start(this.#lost(session, "peer transport failed", LIVE_SESSION_END_CAUSE.PEER_FAILED));
      return;
    }
    if (state === LIVE_TRANSPORT_STATE.CLOSED && !session.closing) {
      this.#start(this.#end(session, LIVE_SESSION_END_CAUSE.PEER_CLOSED));
    }
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
   * Where Luke's face on the standing call is, the current state first and
   * then each change, in process: what the desktop draws its tile from.
   */
  get avatarStatus(): Stream.Stream<HeldAvatarState> {
    return SubscriptionRef.changes(this.#avatarRef);
  }

  /**
   * The room the face stands in, the current one first and then each change,
   * nothing while no face is up. It carries the viewer token, so it is read
   * in process and handed to the call window alone, never into an event.
   */
  get avatarRoom(): Stream.Stream<AvatarRoom | undefined> {
    return SubscriptionRef.changes(this.#roomRef);
  }

  /**
   * The developer's video switch on the standing call. On asks the service
   * for the face where none is up or coming; off takes the face that is up or
   * coming down, and the voice goes on either way. A session opened through
   * no service, or a holder with no media socket to speak into, puts no face
   * up.
   */
  setVideo(on: boolean): void {
    const session = this.#held;
    if (!session || session.ended) return;
    const up =
      this.#avatar.status === HELD_AVATAR_STATUS.STARTING ||
      this.#avatar.status === HELD_AVATAR_STATUS.STARTED;
    if (!on) {
      if (up) this.#takeAvatarDown(session, AVATAR_STOP_REASON.USER);
      return;
    }
    const start = session.opened.startAvatar;
    if (up || start === undefined || this.#options.acquireAvatarMedia === undefined) return;
    start();
    this.#showAvatar({ status: HELD_AVATAR_STATUS.STARTING }, undefined);
  }

  /**
   * One chunk of Luke's voice, spoken into the face's media socket while it
   * is open. A chunk with no socket to take it, before the socket opens or
   * after the face is down, is dropped: the voice itself still plays.
   */
  avatarAudio(pcm: Uint8Array): Effect.Effect<void> {
    return Effect.suspend(() => this.#openMedia()?.speak(pcm) ?? Effect.void);
  }

  /** The face told to drop what it was handed, as Luke is cut off; nothing where no socket is open. */
  avatarInterrupt(): Effect.Effect<void> {
    return Effect.suspend(() => this.#openMedia()?.interrupt() ?? Effect.void);
  }

  /** The standing call's open media socket, if its face has one. */
  #openMedia(): AvatarMedia | undefined {
    const session = this.#held;
    if (!session || session.ended) return undefined;
    return session.avatar?.media;
  }

  /** The drain: the session is closed gracefully inside the quit's own deadline, and nothing is opened after. */
  stop(): Effect.Effect<void> {
    return this.endSession(LIVE_SESSION_END_CAUSE.DRAIN);
  }

  /** A draft of the plan the session is bound to, passed on while the session stands. */
  #drafted(session: HeldSession, draft: PlanDraftFrame): void {
    if (session.ended || draft.planId !== session.planId) return;
    this.#options.onPlanDraft?.(draft);
  }

  /** The service's activity about the plan the session is bound to, passed on while the session stands. */
  #activity(session: HeldSession, activity: PlanActivityFrame): void {
    if (session.ended || activity.planId !== session.planId) return;
    this.#options.onPlanActivity?.(activity);
  }

  /** Code Luke put on screen on the call about the plan the session is bound to, passed on while the session stands. */
  #code(session: HeldSession, code: PlanCodeFrame): void {
    if (session.ended || code.planId !== session.planId) return;
    this.#options.onPlanCode?.(code);
  }

  /** A planning turn's work on the call about the plan the session is bound to, passed on while the session stands. */
  #work(session: HeldSession, work: PlanWorkFrame): void {
    if (session.ended || work.planId !== session.planId) return;
    this.#options.onPlanWork?.(work);
  }

  /**
   * Luke ending the call about the plan the session is bound to, told to the
   * peer while the session stands. The peer decides when, once his goodbye
   * has played, and hangs up through its own hang-up, so nothing ends here.
   */
  #ending(session: HeldSession, ending: PlanCallEndingFrame): void {
    if (session.ended || ending.planId !== session.planId) return;
    this.#options.emit({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.ENDING });
  }

  /**
   * The service's room for the face it was asked for: the room is shown, and
   * the media socket is opened into a scope of the face's own, a child of the
   * session's, so the call's end closes it whoever ends the call. A room for
   * a face no longer wanted, turned off while it was minted, is passed over:
   * the stop already sent is the service's to honour.
   */
  #avatarStarted(session: HeldSession, started: AvatarStartedFrame): void {
    const acquire = this.#options.acquireAvatarMedia;
    if (session.ended || acquire === undefined) return;
    if (this.#avatar.status !== HELD_AVATAR_STATUS.STARTING) return;
    const avatar: HeldAvatar = {
      scope: Scope.forkUnsafe(session.scope, "sequential"),
      media: undefined,
    };
    session.avatar = avatar;
    this.#start(
      Effect.asVoid(
        Effect.forkIn(this.#runMedia(session, avatar, acquire(started.mediaUrl)), avatar.scope),
      ),
    );
    this.#showAvatar(
      { status: HELD_AVATAR_STATUS.STARTED },
      { livekitUrl: started.livekitUrl, viewerToken: started.viewerToken },
    );
  }

  /**
   * The face's media socket, opened and then watched for its end on a fiber
   * of the face's own scope, so taking the face down interrupts both. A
   * socket that ends for good, its reconnects spent, takes the face down as
   * media lost and tells the service so; the call goes on as voice.
   */
  #runMedia(
    session: HeldSession,
    avatar: HeldAvatar,
    acquire: Effect.Effect<AvatarMedia, never, Scope.Scope>,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const media = yield* Scope.provide(acquire, avatar.scope);
      avatar.media = media;
      // Note that a socket refused and a socket lost are one end here, media
      // lost, because either way the face can no longer be spoken into.
      const end = yield* media.ended;
      if (session.ended || session.avatar !== avatar) return;
      yield* Effect.logWarning(`voice avatar: media ended=${end.reason} ${sessionFields(session)}`);
      this.#takeAvatarDown(session, AVATAR_STOP_REASON.MEDIA_LOST);
    });
  }

  /**
   * The service's word that the face is down. One the holder already took
   * down itself, whose stop this echoes, or one never up, says nothing new.
   */
  #avatarEnded(session: HeldSession, ended: AvatarEndedFrame): void {
    if (session.ended) return;
    const status = this.#avatar.status;
    if (status !== HELD_AVATAR_STATUS.STARTING && status !== HELD_AVATAR_STATUS.STARTED) return;
    this.#releaseAvatar(session);
    this.#showAvatar({ status: HELD_AVATAR_STATUS.ENDED, reason: ended.reason }, undefined);
  }

  /** The service could not put up the face asked for; the call goes on as voice. */
  #avatarUnavailable(session: HeldSession, unavailable: AvatarUnavailableFrame): void {
    if (session.ended || this.#avatar.status !== HELD_AVATAR_STATUS.STARTING) return;
    this.#showAvatar(
      { status: HELD_AVATAR_STATUS.UNAVAILABLE, reason: unavailable.reason },
      undefined,
    );
  }

  /** The face taken down from this side: the service is told why, and its media released. */
  #takeAvatarDown(session: HeldSession, reason: AvatarStopReason): void {
    session.opened.stopAvatar?.(reason);
    this.#releaseAvatar(session);
    this.#showAvatar({ status: HELD_AVATAR_STATUS.ENDED, reason }, undefined);
  }

  /**
   * The face's scope closed on the holder's own fiber, never on the face's,
   * since the hand letting go may be the face's own watcher.
   */
  #releaseAvatar(session: HeldSession): void {
    const avatar = session.avatar;
    session.avatar = undefined;
    if (avatar !== undefined) this.#start(Scope.close(avatar.scope, Exit.void));
  }

  /**
   * The face and its room decided here, on the hand that decides, and
   * published to their observables on the holder's fiber. Note that what is
   * published is read when the publish runs rather than when it was asked,
   * because the publishes run as fibers of their own and the last to run must
   * leave the latest decision standing.
   */
  #showAvatar(state: HeldAvatarState, room: AvatarRoom | undefined): void {
    this.#avatar = state;
    this.#room = room;
    this.#start(
      Effect.suspend(() =>
        Effect.andThen(
          SubscriptionRef.set(this.#avatarRef, this.#avatar),
          SubscriptionRef.set(this.#roomRef, this.#room),
        ),
      ),
    );
  }

  #onClosed(session: HeldSession, closed: LiveSessionClosed): Effect.Effect<void> {
    if (session.ended) return Deferred.await(session.released);
    session.usageSeconds = closed.usage.seconds;
    return this.#tearDown(session, closed.reason, LIVE_SESSION_END_CAUSE.SERVICE_CLOSED);
  }

  /** The session ended without `session.closed`: the latest usage stands unconfirmed. */
  #lost(session: HeldSession, reason: string, cause: LiveSessionEndCause): Effect.Effect<void> {
    if (session.ended) return Deferred.await(session.released);
    return this.#tearDown(session, reason, cause);
  }

  /**
   * The session is over the instant this is called: `#held` and the phase
   * are settled here, on the hand that decided it. The release is the
   * reader's own to run, so what is handed back is that release to wait for.
   * `cause` stands where no hand asked for the end before it was decided.
   */
  #tearDown(session: HeldSession, reason: string, cause: LiveSessionEndCause): Effect.Effect<void> {
    session.ended = true;
    session.endCause ??= cause;
    if (this.#held === session) this.#held = undefined;
    // Note that we say a planning call's end as nothing doing, because the
    // service's own last word may never arrive once the socket is gone.
    this.#options.onPlanActivity?.({
      type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY,
      planId: session.planId,
      notes: false,
    });
    this.#options.onPlanCallEnded?.(session.planId);
    // Note that the face's media needs no release of its own here, because
    // its scope is a child of the session's, closed with it by the reader.
    session.avatar = undefined;
    this.#showAvatar(AVATAR_OFF, undefined);
    this.#releasing = session.released;
    Deferred.doneUnsafe(session.torn, Exit.void);
    this.#options.emit({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.CLOSED, reason });
    // Note that the line is the holder's own task, because the hand that tore
    // the session down may be its reader, interrupted the moment `torn` settles.
    const seconds = Math.round((this.#clock.currentTimeMillisUnsafe() - session.stoodAt) / 1000);
    this.#start(Effect.logInfo(endedLine(session, reason, seconds)));
    return Deferred.await(session.released);
  }
}
