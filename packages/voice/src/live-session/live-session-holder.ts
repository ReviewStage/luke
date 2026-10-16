import {
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  type AvatarStartedFrame,
  type AvatarStopReason,
  type AvatarUnavailableFrame,
  type AvatarUnavailableReason,
  type LiveSessionCreated,
  type PlanDraftFrame,
  type TaskActivityFrame,
  type TaskCallEndingFrame,
  type TaskCodeFrame,
  type TaskWorkFrame,
  VOICE_SERVICE_FRAME,
} from "@luke/features";
import type { AvatarGrant } from "@luke/features/avatar-grant";
import { VIDEO_AVATAR, type VideoAvatar } from "@luke/features/video-avatar";
import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type LivePeerEndReason,
  type LiveTransportState,
  type VoiceLiveSessionChanged,
  type VoiceReportLiveTransportParams,
} from "@luke/gateway";
import {
  generalLiveError,
  LIVE_CLOSE_REASON,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  type LiveSessionClosed,
  liveErrorFields,
} from "@luke/live";
import { causeKind, type SerialQueue, serialQueue } from "@luke/runtime/effect";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  PubSub,
  Scope,
  Stream,
} from "effect";
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
 * Built by `make` for the scope of the composition that holds it, on the
 * same terms as `LiveSessionService`: each session stands in a scope of its
 * own forked from a child of that scope, read by one fiber that owns it, and
 * what a report or the stop key begins that nobody waits on runs as a fiber
 * of the holder's own set. `stop` is a drain step the composition runs
 * inside its own deadline, never the scope's finalizer.
 *
 * Luke's avatar on the call is asked for and taken down through the source's
 * doors, and what the service answers is told in process alone: where the
 * avatar stands as `avatarStates`, and the grant that joins it as
 * `avatarGrants`. The grant carries a credential, so it is never emitted,
 * never logged, and never kept: it reaches the subscribers standing when it
 * arrives and nothing after, so a start always draws a grant of its own.
 * Each start is asked under a request id of its own, and only the answer
 * echoing the latest is heard, so an answer to an earlier ask, late or
 * lost, is never mistaken for the current one, and a start nobody answers
 * is given up on after `AVATAR_START_BOUND`. A call opens with the avatar
 * where `videoOnCall` says so, and a close the call window reports that this
 * side did not start asks for it once more on that call (`closed`).
 */

/** Where Luke's avatar stands on the call, as the host knows it; whether the call window drew it is the desktop's to say. */
export const LIVE_AVATAR_STATUS = {
  /** No avatar was asked for on the call. */
  OFF: "off",
  /** The service was asked for the avatar and has not answered. */
  STARTING: "starting",
  /** The service answered with the grant, which went to the grant's subscribers. */
  GRANTED: "granted",
  ENDED: "ended",
} as const;

/** Which hand ended the avatar: a stop the desktop sent, the service's refusal, or the call's own end. */
export const LIVE_AVATAR_END = {
  STOPPED: "stopped",
  UNAVAILABLE: "unavailable",
  CALL_ENDED: "call_ended",
} as const;

export type LiveAvatarEnd =
  | { readonly by: typeof LIVE_AVATAR_END.STOPPED; readonly reason: AvatarStopReason }
  | { readonly by: typeof LIVE_AVATAR_END.UNAVAILABLE; readonly reason: AvatarUnavailableReason }
  | { readonly by: typeof LIVE_AVATAR_END.CALL_ENDED };

export type LiveAvatarState =
  | {
      readonly status:
        | typeof LIVE_AVATAR_STATUS.OFF
        | typeof LIVE_AVATAR_STATUS.STARTING
        | typeof LIVE_AVATAR_STATUS.GRANTED;
    }
  | { readonly status: typeof LIVE_AVATAR_STATUS.ENDED; readonly end: LiveAvatarEnd };

/**
 * How long a start waits on the service's answer before it is given up as
 * unavailable: an answer lost with a connection would otherwise leave the
 * tile saying "Connecting" for the rest of the call.
 */
export const AVATAR_START_BOUND = Duration.seconds(20);

/** How many times a call's avatar is asked for again after a close this side did not start. */
const AVATAR_RESTARTS_PER_CALL = 1;

export interface LiveSessionHolderOptions {
  /** Where a session comes from now, or nothing while voice is unavailable. */
  source: () => LiveSessionSource | undefined;
  /** A fresh id for each avatar start, which the service echoes on its answer. */
  createId: () => string;
  /** Whether a call is to open with Luke's avatar, read as each session comes to stand. */
  videoOnCall?: Effect.Effect<boolean>;
  /** The avatar a call opens with, read with `videoOnCall`; the default where none is given. */
  videoAvatar?: Effect.Effect<VideoAvatar>;
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
  onTaskActivity?: (activity: TaskActivityFrame) => void;
  /** Luke put code on screen on the standing planning call, on the same terms as `onPlanDraft`. */
  onTaskCode?: (code: TaskCodeFrame) => void;
  /** A planning turn's work on the standing planning call changed, on the same terms as `onPlanDraft`. */
  onTaskWork?: (work: TaskWorkFrame) => void;
  /** The planning call about the plan named ended, so what it put on screen goes with it. */
  onTaskCallEnded?: (taskId: string) => void;
}

/**
 * Which hand ended a held session, named in the line the holder logs when a
 * session ends, so a call that dropped says why without anyone reading the
 * code for every path that could have closed it.
 */
export const LIVE_SESSION_END_CAUSE = {
  /** The plan the call is about was deleted. */
  TASK_DELETED: "task_deleted",
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
  readonly taskId: string;
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
  readonly taskId: string;
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
  /** Where the avatar stands now, which `#avatarStates` replays to a subscriber as it joins. */
  #avatar: LiveAvatarState = { status: LIVE_AVATAR_STATUS.OFF };
  /** The request id of the latest start, while the avatar it asked for is starting or up. */
  #avatarRequest: string | undefined;
  /** How many times the standing call's avatar was asked for again after a close this side did not start. */
  #avatarRestarts = 0;
  /** The avatar the latest start asked for, which a restart after a close asks for again. */
  #avatarAsked: VideoAvatar = VIDEO_AVATAR.DEFAULT;
  readonly #avatarStates: PubSub.PubSub<LiveAvatarState>;
  /** The grants as they arrive, and nothing when the avatar they joined is down; replays nothing, so no grant is kept. */
  readonly #avatarGrants: PubSub.PubSub<AvatarGrant | undefined>;
  /** The fibers the tasks run as, one each, all ended by the holder's scope. */
  readonly #fibers: FiberSet.FiberSet<void, unknown>;
  /** The door a synchronous edge starts a task through: the queue forks it into the set. */
  readonly #tasks: SerialQueue;
  readonly #clock: Clock.Clock;
  readonly #sessions: Scope.Scope;

  private constructor(
    options: LiveSessionHolderOptions,
    running: { readonly fibers: FiberSet.FiberSet<void, unknown>; readonly tasks: SerialQueue },
    avatar: {
      readonly states: PubSub.PubSub<LiveAvatarState>;
      readonly grants: PubSub.PubSub<AvatarGrant | undefined>;
    },
    clock: Clock.Clock,
    sessions: Scope.Scope,
  ) {
    this.#options = options;
    this.#fibers = running.fibers;
    this.#tasks = running.tasks;
    this.#avatarStates = avatar.states;
    this.#avatarGrants = avatar.grants;
    this.#clock = clock;
    this.#sessions = sessions;
    PubSub.publishUnsafe(this.#avatarStates, this.#avatar);
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
      const states = yield* Effect.acquireRelease(
        PubSub.unbounded<LiveAvatarState>({ replay: 1 }),
        PubSub.shutdown,
      );
      const grants = yield* Effect.acquireRelease(
        PubSub.unbounded<AvatarGrant | undefined>(),
        PubSub.shutdown,
      );
      const scope = yield* Effect.scope;
      return new LiveSessionHolder(
        options,
        { fibers, tasks },
        { states, grants },
        yield* Clock.Clock,
        yield* Scope.fork(scope, "sequential"),
      );
    });
  }

  /** Begins what nothing waits for, on the holder's own fiber. */
  #start(effect: Effect.Effect<void>): void {
    this.#tasks.offerUnsafe(Effect.asVoid(FiberSet.run(this.#fibers, effect)));
  }

  /** Where the avatar stands now, and then each time it moves, until the holder's scope closes. */
  get avatarStates(): Stream.Stream<LiveAvatarState> {
    return Stream.fromPubSub(this.#avatarStates);
  }

  /**
   * Each grant the service answers a start with, and nothing each time the
   * avatar it joined goes down, told to the subscribers standing at that
   * moment and kept for no one after: the token is single-use and a
   * credential, so it is handed on in process and nowhere else.
   */
  get avatarGrants(): Stream.Stream<AvatarGrant | undefined> {
    return Stream.fromPubSub(this.#avatarGrants);
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
  endTaskCall(taskId: string | undefined): Effect.Effect<void> {
    return Effect.suspend(() => {
      const cause =
        taskId === undefined
          ? LIVE_SESSION_END_CAUSE.SIGNED_OUT
          : LIVE_SESSION_END_CAUSE.TASK_DELETED;
      const about = (candidate: string) => taskId === undefined || candidate === taskId;
      const creating = this.#creating;
      if (creating !== undefined && about(creating.taskId)) creating.endedBy ??= cause;
      const session = this.#held;
      if (session === undefined || !about(session.taskId)) return Effect.void;
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
  createSession(sdpOffer: string, taskId: string): Effect.Effect<LiveSessionCreated | undefined> {
    // The creation is named from its first step to its last, so an end landing
    // anywhere in it (the prior session's end, the create, the attach) is heard.
    const creating: Creating = { taskId, endedBy: undefined };
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
        this.#stand(source, sdpOffer, creating.taskId, scope),
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
    taskId: string,
    scope: Scope.Closeable,
  ): Effect.Effect<LiveSessionCreated | undefined> {
    return Effect.gen({ self: this }, function* () {
      const opened = yield* Scope.provide(source.create({ sdpOffer, taskId }), scope);
      if (!opened) return undefined;
      this.#options.emit({ sessionId: opened.sessionId, phase: LIVE_SESSION_PHASE.CREATED });
      const sideband = yield* Scope.provide(opened.attach(), scope);
      const session: HeldSession = {
        sessionId: opened.sessionId,
        stoodAt: this.#clock.currentTimeMillisUnsafe(),
        endCause: undefined,
        peerReason: undefined,
        taskId,
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
      opened.onPlanDraft?.((draft) => this.#drafted(session, draft));
      opened.onTaskActivity?.((activity) => this.#activity(session, activity));
      opened.onTaskCode?.((code) => this.#code(session, code));
      opened.onTaskWork?.((work) => this.#work(session, work));
      opened.onTaskCallEnding?.((ending) => this.#ending(session, ending));
      opened.onAvatarStarted?.((started) => this.#avatarStarted(session, started));
      opened.onAvatarUnavailable?.((unavailable) => this.#avatarUnavailable(session, unavailable));
      yield* Effect.forkIn(this.#read(session), this.#sessions);
      this.#held = session;
      // Note that a new call starts with no avatar and no restart spent,
      // because the last call's end is not this one's.
      this.#avatarRestarts = 0;
      if (this.#avatar.status !== LIVE_AVATAR_STATUS.OFF) {
        this.#avatarMoved({ status: LIVE_AVATAR_STATUS.OFF });
      }
      this.#options.onSessionCreated?.();
      if (yield* this.#options.videoOnCall ?? Effect.succeed(false)) {
        this.startAvatar(yield* this.#options.videoAvatar ?? Effect.succeed(VIDEO_AVATAR.DEFAULT));
      }
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
   * Asks the service for Luke's avatar on the standing call, under a request
   * id of its own. Answers whether it was asked: a session with no door for
   * it, or an avatar already up, asks nothing, because each start mints a
   * session the plan's concurrency pays for. A start still unanswered is
   * superseded, since its answer may have been lost with a connection, and
   * the service closes whatever the earlier ask put up. An avatar that ended
   * may be asked for again, and draws a grant of its own. The avatar asked
   * for is the one named, or the one the latest start asked for.
   */
  startAvatar(avatar: VideoAvatar = this.#avatarAsked): boolean {
    const session = this.#held;
    if (!session || session.ended) return false;
    const start = session.opened.startAvatar;
    if (start === undefined || this.#avatar.status === LIVE_AVATAR_STATUS.GRANTED) return false;
    const requestId = this.#options.createId();
    this.#avatarRequest = requestId;
    this.#avatarAsked = avatar;
    start(requestId, avatar);
    if (this.#avatar.status !== LIVE_AVATAR_STATUS.STARTING) {
      this.#avatarMoved({ status: LIVE_AVATAR_STATUS.STARTING });
    }
    this.#start(this.#startBound(session, requestId));
    return true;
  }

  /**
   * The bound on one start: where the service has not answered it by then,
   * it is told to close whatever the ask put up and the start ends as
   * unavailable, which the tile offers to restart. A start answered, stopped,
   * or superseded meanwhile is left alone.
   */
  #startBound(session: HeldSession, requestId: string): Effect.Effect<void> {
    return Effect.andThen(
      Effect.sleep(AVATAR_START_BOUND),
      Effect.sync(() => {
        if (!this.#answersLatestStart(session, requestId)) return;
        session.opened.stopAvatar?.(requestId, AVATAR_STOP_REASON.ERROR);
        this.#avatarEnded({
          by: LIVE_AVATAR_END.UNAVAILABLE,
          reason: AVATAR_UNAVAILABLE_REASON.ERROR,
        });
      }),
    );
  }

  /**
   * Takes the avatar down on the standing call, telling the service why:
   * the developer turned it off, or the call window's session closed or
   * failed. The grant's subscribers are told it no longer stands. Answers
   * whether there was an avatar asked for or up to take down.
   */
  stopAvatar(reason: AvatarStopReason): boolean {
    const session = this.#held;
    if (!session || session.ended) return false;
    const stop = session.opened.stopAvatar;
    const requestId = this.#avatarRequest;
    if (stop === undefined || requestId === undefined) return false;
    stop(requestId, reason);
    this.#avatarEnded({ by: LIVE_AVATAR_END.STOPPED, reason });
    return true;
  }

  /**
   * The call window's session closed while the avatar was up, and this side
   * did not close it: Keyframe closed the room, or the session failed. The
   * service is told so, which closes its row and lets a start be asked
   * again, and the avatar is asked for once more on each call before it is
   * left ended, where the tile offers to restart it. Answers whether it was
   * asked for again.
   */
  closed(reason: AvatarStopReason): boolean {
    if (this.#avatar.status !== LIVE_AVATAR_STATUS.GRANTED || !this.stopAvatar(reason)) {
      return false;
    }
    if (this.#avatarRestarts >= AVATAR_RESTARTS_PER_CALL) return false;
    this.#avatarRestarts += 1;
    return this.startAvatar();
  }

  /** The drain: the session is closed gracefully inside the quit's own deadline, and nothing is opened after. */
  stop(): Effect.Effect<void> {
    return this.endSession(LIVE_SESSION_END_CAUSE.DRAIN);
  }

  /** A draft of the plan the session is bound to, passed on while the session stands. */
  #drafted(session: HeldSession, draft: PlanDraftFrame): void {
    if (session.ended || draft.planId !== session.taskId) return;
    this.#options.onPlanDraft?.(draft);
  }

  /** The service's activity about the plan the session is bound to, passed on while the session stands. */
  #activity(session: HeldSession, activity: TaskActivityFrame): void {
    if (session.ended || activity.planId !== session.taskId) return;
    this.#options.onTaskActivity?.(activity);
  }

  /** Code Luke put on screen on the call about the plan the session is bound to, passed on while the session stands. */
  #code(session: HeldSession, code: TaskCodeFrame): void {
    if (session.ended || code.planId !== session.taskId) return;
    this.#options.onTaskCode?.(code);
  }

  /** A planning turn's work on the call about the plan the session is bound to, passed on while the session stands. */
  #work(session: HeldSession, work: TaskWorkFrame): void {
    if (session.ended || work.planId !== session.taskId) return;
    this.#options.onTaskWork?.(work);
  }

  /**
   * Luke ending the call about the plan the session is bound to, told to the
   * peer while the session stands. The peer decides when, once his goodbye
   * has played, and hangs up through its own hang-up, so nothing ends here.
   */
  #ending(session: HeldSession, ending: TaskCallEndingFrame): void {
    if (session.ended || ending.planId !== session.taskId) return;
    this.#options.emit({ sessionId: session.sessionId, phase: LIVE_SESSION_PHASE.ENDING });
  }

  /**
   * The service's grant, handed on while the session stands and the start it
   * answers is the latest and still wanted. A grant for an earlier start, or
   * one that lands after the avatar was stopped or the call ended, is
   * dropped here rather than kept for a later start.
   */
  #avatarStarted(session: HeldSession, started: AvatarStartedFrame): void {
    if (!this.#answersLatestStart(session, started.requestId)) return;
    this.#avatarMoved({ status: LIVE_AVATAR_STATUS.GRANTED });
    PubSub.publishUnsafe(this.#avatarGrants, {
      serverUrl: started.serverUrl,
      participantToken: started.participantToken,
      agentIdentity: started.agentIdentity,
    });
  }

  /** The service's refusal of the latest start still wanted; the call goes on as voice. */
  #avatarUnavailable(session: HeldSession, unavailable: AvatarUnavailableFrame): void {
    if (!this.#answersLatestStart(session, unavailable.requestId)) return;
    this.#avatarEnded({ by: LIVE_AVATAR_END.UNAVAILABLE, reason: unavailable.reason });
  }

  #answersLatestStart(session: HeldSession, requestId: string): boolean {
    return (
      !session.ended &&
      this.#avatar.status === LIVE_AVATAR_STATUS.STARTING &&
      requestId === this.#avatarRequest
    );
  }

  /** The avatar asked for or up has ended, and a grant handed on is withdrawn from its subscribers. */
  #avatarEnded(end: LiveAvatarEnd): void {
    const { status } = this.#avatar;
    if (status !== LIVE_AVATAR_STATUS.STARTING && status !== LIVE_AVATAR_STATUS.GRANTED) return;
    this.#avatarRequest = undefined;
    this.#avatarMoved({ status: LIVE_AVATAR_STATUS.ENDED, end });
    if (status === LIVE_AVATAR_STATUS.GRANTED) PubSub.publishUnsafe(this.#avatarGrants, undefined);
  }

  #avatarMoved(state: LiveAvatarState): void {
    this.#avatar = state;
    PubSub.publishUnsafe(this.#avatarStates, state);
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
    this.#options.onTaskActivity?.({
      type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
      planId: session.taskId,
      notes: false,
    });
    this.#options.onTaskCallEnded?.(session.taskId);
    // The service closes the avatar with the call, so nothing is sent for it.
    this.#avatarEnded({ by: LIVE_AVATAR_END.CALL_ENDED });
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
