import { Effect, Option, type Schema, type Scope } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { WebSocket } from "ws";
import {
  type DevicePlatform,
  HOSTED_API_ERROR,
  type HostedApiError,
  HTTP_STATUS,
  type SessionAttachedFrame,
  type SessionAttachFrame,
  type SessionAudioCreatedFrame,
  type SessionAudioCreateFrame,
  type SessionCreatedFrame,
  type SessionCreateFrame,
  sessionAudioCreateFrameFromWire,
  sessionOpeningFrameFromWire,
  type UnparsedWireValue,
  VOICE_SERVICE_FRAME,
} from "../core.js";
import {
  decodeLivePayload,
  LIVE_INPUT_BOUNDS,
  LIVE_SCENE,
  LIVE_SESSION_OUTCOME,
  livePrimarySessionConfig,
  liveSessionConfig,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_ROLE,
} from "../live.js";
import type { VoiceAccounts } from "./accounts.js";
import { type SignedInRoute, VOICE_ROUTE } from "./frames.js";
import { LOG_EVENT } from "./log.js";
import type { LiveUpstream } from "./openai.js";
import type { VoiceSessionRecord } from "./session-record.js";
import { frameText, type VoiceSocket } from "./socket.js";

/**
 * What a socket's first frame opens, by the route the socket came in on: a
 * WebRTC session created at OpenAI from the device's offer and attached to
 * over a sideband, a fresh sideband to a session that stands, or, on the
 * audio route, a session of the service's own primary socket, started under
 * the format the device named. Every path here authorizes and spends before
 * it creates, registers what it created to the account, and answers the
 * service one `Opened`: the session behind the socket, or the reason there is
 * none, with the platform of the device row that had been resolved by then.
 * The service stands the exchange and the relay on what this answers; nothing
 * here reads a frame past the opening one.
 */

/**
 * What an accountless introduction may put into a session running on Luke's
 * key: one developer message naming the detected sessions, bounded well
 * under what the takeover composes (at most eight titles of eighty
 * characters), because this is client text entering a prompt with no account
 * to answer for it.
 */
export const INTRODUCTION_INPUT_BOUNDS = {
  MESSAGES: 1,
  CHARS: 1_024,
} as const;

/**
 * What a signed-in device may put into its session's `input`: the API's own
 * message bound, and a per-part bound wide enough for the roster summary a
 * session opens with and the Conversation lines beside it, each of which the
 * device composes under bounds of its own. It is admitted by shape rather
 * than trusted by route: an account behind a request says who is asking, not
 * how much of a prompt this service will pay OpenAI to read.
 */
export const SESSIONS_INPUT_BOUNDS = {
  MESSAGES: LIVE_INPUT_BOUNDS.MESSAGES,
  CHARS: 4_096,
} as const;

/**
 * Who an upgrade admitted: a signed-in device, on either of its two routes,
 * with the `Authorization` value it presented and the device row it claimed
 * to be, or an introduction with nothing. The claim is a well-formed id and
 * no more until the account is resolved; whether that account holds the row,
 * and which platform that row names, is asked then.
 */
export type Admission =
  | { route: SignedInRoute; bearer: string; deviceId: string | undefined }
  | { route: typeof VOICE_ROUTE.INTRODUCTION };

type SignedInAdmission = Extract<Admission, { route: SignedInRoute }>;

/** The account a device's handshake resolved to, its device claim admitted and a session spent, or the reason it is refused. */
type AdmittedAccount =
  | {
      accountId: string;
      deviceId: string | undefined;
      platform: DevicePlatform | undefined;
      quota: SessionCreatedFrame["quota"];
    }
  | Refusal;

/**
 * A refusal as both `Opened` and `AdmittedAccount` state one: the reason, and
 * the platform where a device row had been resolved by the time it was
 * reached — nothing everywhere else, which is every refusal ahead of that row.
 */
interface Refusal {
  refusal: HostedApiError;
  platform: DevicePlatform | undefined;
}

/** A session standing behind a socket, with the frame that says so, or the reason it is not. */
type Opened =
  | {
      sessionId: string;
      /** The account the session is billed to; none for the introduction. */
      accountId: string | undefined;
      /** The device the handshake named and the account was shown to hold; none for the introduction, for a device that sent none, and on a re-attach, which checks the session's owner and not a device. */
      deviceId: string | undefined;
      /** The platform that device row named, which is what the log counts this caller by; none wherever no row was resolved. */
      platform: DevicePlatform | undefined;
      /**
       * Whether the session is already running: false for one just created
       * from a WebRTC offer, whose peer has yet to connect; true for one
       * re-attached, which spoke its start to an earlier connection, and for
       * one the audio route opened, whose start the door read itself.
       */
      started: boolean;
      /** The service's socket to OpenAI, open and paused: the sideband it attached, or the primary socket that is the session. */
      sideband: WebSocket;
      /**
       * The frames the door took off that socket before any consumer stood,
       * in order: what a primary socket said beside `session.started`, and
       * nothing on the routes whose socket the service resumes untouched.
       * The service hands them to each consumer ahead of anything the socket
       * says next, so a frame that arrived with the handshake is heard once
       * and in its place.
       */
      held: readonly string[];
      answer: SessionCreatedFrame | SessionAttachedFrame | SessionAudioCreatedFrame;
      logEvent: typeof LOG_EVENT.SESSION_CREATED | typeof LOG_EVENT.SESSION_ATTACHED;
    }
  | Refusal;

function refused(reason: HostedApiError, platform?: DevicePlatform): Refusal {
  return { refusal: reason, platform };
}

/**
 * What one session's own effect may fail with: the `voice_sessions` writes
 * the service makes on the session's behalf, and nothing else — every other
 * refusal is a frame the device is answered with.
 */
export type SessionFailure = SqlError | Schema.SchemaError;

export type SessionEffect<A> = Effect.Effect<A, SessionFailure, SqlClient.SqlClient | Scope.Scope>;

function introductionInputAdmitted(frame: SessionCreateFrame): boolean {
  return (
    frame.input.length <= INTRODUCTION_INPUT_BOUNDS.MESSAGES &&
    frame.input.every(
      (item) =>
        item.role === SEED_ROLE.DEVELOPER &&
        item.content.every((part) => part.text.length <= INTRODUCTION_INPUT_BOUNDS.CHARS),
    )
  );
}

function sessionsInputAdmitted(frame: SessionCreateFrame): boolean {
  return (
    frame.input.length <= SESSIONS_INPUT_BOUNDS.MESSAGES &&
    frame.input.every((item) =>
      item.content.every((part) => part.text.length <= SESSIONS_INPUT_BOUNDS.CHARS),
    )
  );
}

/**
 * How OpenAI's refusal to create or start a session is answered to the
 * device: a rate limit as the throttle it is, so a device can back off, and
 * everything else as the upstream's error, since which error is nothing a
 * device can act on and nothing this service repeats.
 */
function upstreamRefused(
  result: { outcome: typeof LIVE_SESSION_OUTCOME.HTTP_ERROR; status: number } | { outcome: string },
  platform: DevicePlatform | undefined,
): Refusal {
  return refused(
    result.outcome === LIVE_SESSION_OUTCOME.HTTP_ERROR &&
      "status" in result &&
      result.status === HTTP_STATUS.TOO_MANY_REQUESTS
      ? HOSTED_API_ERROR.UPSTREAM_THROTTLED
      : HOSTED_API_ERROR.UPSTREAM_ERROR,
    platform,
  );
}

export interface SessionOpenerOptions {
  readonly accounts: VoiceAccounts;
  readonly record: VoiceSessionRecord;
  /** A deployment-pinned model; `LIVE_DEFAULTS.MODEL` otherwise. */
  readonly model: string | undefined;
  /** How long a fresh socket has to send its opening frame before it is refused. */
  readonly firstFrameTimeoutMs: number;
}

export interface SessionOpener {
  /**
   * The session behind a socket's first frame, by the route the socket
   * opened on: the WebRTC routes take a `session.create` carrying an offer or,
   * on the sessions route, a `session.attach`; the audio route takes the
   * `session.create` that names a format and nothing else, so a
   * `session.attach` there is a first frame the route does not admit and is
   * refused as one, since a primary socket has no attach to offer. A frame
   * that was late, unreadable, or neither shape is the same refusal; a device
   * gone by the time its frame was read is refused the same way and answered
   * nothing, since nothing is spent on a caller who is not there.
   */
  open(upstream: LiveUpstream, admission: Admission, device: VoiceSocket): SessionEffect<Opened>;
}

export function sessionOpener(options: SessionOpenerOptions): SessionOpener {
  const { accounts, record } = options;

  /** The socket's first frame as the route's reader admits it, or nothing when it was late, closed, or not that shape. */
  const firstFrame = <Frame>(
    device: VoiceSocket,
    read: (payload: UnparsedWireValue) => Frame | undefined,
  ): Effect.Effect<Frame | undefined> =>
    device.next.pipe(
      Effect.map((frame) => {
        const text = Option.flatMapNullishOr(frame, frameText);
        if (Option.isNone(text)) return undefined;
        const payload = decodeLivePayload(text.value);
        return payload === undefined ? undefined : read(payload);
      }),
      Effect.timeoutOrElse({
        duration: options.firstFrameTimeoutMs,
        orElse: () => Effect.succeed(undefined),
      }),
    );

  /**
   * A device's handshake as an account, in the order the refusals are
   * cheapest: the bearer resolved, the device it claimed to be read from the
   * rows the account holds, and only then a session spent. A device the
   * account does not hold is refused before the spend, so a claim on someone
   * else's device — a phone naming a Mac's row, or either naming a row of an
   * account that is not its own — costs the claimant nothing and creates
   * nothing; the record's own write checks the same fact again, so a row gone
   * between here and there names no device. The row that was found is also
   * where the platform the log counts this caller by comes from: a claim
   * refused read no row of the account's, so it counts none.
   */
  const admitAccount = (
    admission: SignedInAdmission,
  ): Effect.Effect<AdmittedAccount, SessionFailure, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const accountId = yield* accounts.resolveUserId(admission.bearer);
      if (accountId === undefined) return refused(HOSTED_API_ERROR.INVALID_TOKEN);
      const claimed =
        admission.deviceId === undefined
          ? undefined
          : yield* record.heldDevice({ userId: accountId, deviceId: admission.deviceId });
      if (admission.deviceId !== undefined && claimed === undefined) {
        return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      }
      const platform = claimed?.platform;
      const spend = yield* accounts.spend(accountId);
      if (!spend.allowed) return refused(HOSTED_API_ERROR.QUOTA_EXHAUSTED, platform);
      return { accountId, deviceId: admission.deviceId, platform, quota: spend.quota };
    });

  /**
   * The sideband as the upstream hands it over: open and paused, since no
   * consumer listens yet and a frame the session speaks before the relay and
   * the exchange register would otherwise be emitted to nobody. The service
   * resumes it once every listener stands, and what arrived meanwhile is read
   * then, in order.
   */
  const attach = (
    upstream: LiveUpstream,
    sessionId: string,
  ): Effect.Effect<WebSocket | undefined, never, Scope.Scope> =>
    Effect.catch(upstream.attach(sessionId), () => Effect.succeed(undefined));

  /**
   * A new WebRTC session: authorized and spent, created at OpenAI, registered
   * to its account, and attached. The introduction spends the deployment's
   * shared daily ceiling only once its frame has been admitted, as the mint
   * spends only after reading a valid body, so an empty or malformed handshake
   * costs the ceiling nothing.
   */
  const openCreated = (
    upstream: LiveUpstream,
    admission: Admission,
    frame: SessionCreateFrame,
  ): SessionEffect<Opened> =>
    Effect.gen(function* () {
      const { route } = admission;
      // The introduction holds no account and names no device, so every
      // refusal on it counts no platform, here and below.
      if (route === VOICE_ROUTE.INTRODUCTION) {
        if (!introductionInputAdmitted(frame)) return refused(HOSTED_API_ERROR.INVALID_REQUEST);
        const introduction = yield* accounts.spendIntroduction();
        if (!introduction.allowed) return refused(HOSTED_API_ERROR.QUOTA_EXHAUSTED);
      } else if (!sessionsInputAdmitted(frame)) {
        return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      }
      const account =
        admission.route === VOICE_ROUTE.INTRODUCTION ? undefined : yield* admitAccount(admission);
      if (account && "refusal" in account) return account;
      const config = liveSessionConfig({
        scene: route === VOICE_ROUTE.SESSIONS ? LIVE_SCENE.DESKTOP : LIVE_SCENE.INTRODUCTION,
        model: options.model,
        voice: frame.voice,
        input: frame.input,
        clientEvents: RENDERER_CLIENT_EVENTS,
        serverEvents: RENDERER_SERVER_EVENTS,
      });
      const created = yield* upstream.create(config, frame.sdp);
      if (created.outcome !== LIVE_SESSION_OUTCOME.SUCCEEDED) {
        return upstreamRefused(created, account?.platform);
      }
      const sessionId = created.answer.session.id;
      // The store's id for the session's row rides the answer, so the device
      // can name its own rows on the Conversation; the introduction has no
      // account and so no row, and is answered none.
      const voiceSessionId = account
        ? yield* record.register({
            userId: account.accountId,
            sessionId,
            deviceId: account.deviceId,
          })
        : undefined;
      const sideband = yield* attach(upstream, sessionId);
      if (sideband === undefined) {
        return refused(HOSTED_API_ERROR.UPSTREAM_ERROR, account?.platform);
      }
      const answer: SessionCreatedFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_CREATED,
        sessionId,
        sdpAnswer: created.answer.transport.sdp,
        ...(voiceSessionId === undefined ? undefined : { voiceSessionId }),
        ...(account?.quota === undefined ? undefined : { quota: account.quota }),
      };
      return {
        sessionId,
        accountId: account?.accountId,
        deviceId: account?.deviceId,
        platform: account?.platform,
        started: false,
        sideband,
        held: [],
        answer,
        logEvent: LOG_EVENT.SESSION_CREATED,
      };
    });

  /**
   * A session of the service's own socket, for a device that streams its
   * audio through the service: authorized and spent as a WebRTC session is,
   * then started at OpenAI over a primary socket under the format the device
   * named, and registered to its account under the id `session.started`
   * carried, which is the only place such a session names itself. The door
   * consumes that event, so the session is handed on as started, and what the
   * socket said beside it is handed on with the socket for the consumers to
   * hear first. Nothing is seeded, as the phone seeds nothing.
   */
  const openAudio = (
    upstream: LiveUpstream,
    admission: SignedInAdmission,
    frame: SessionAudioCreateFrame,
  ): SessionEffect<Opened> =>
    Effect.gen(function* () {
      const account = yield* admitAccount(admission);
      if ("refusal" in account) return account;
      const opened = yield* upstream.openPrimary(
        livePrimarySessionConfig({
          scene: LIVE_SCENE.DESKTOP,
          model: options.model,
          voice: frame.voice,
          format: frame.format,
        }),
      );
      if (opened.outcome !== LIVE_SESSION_OUTCOME.SUCCEEDED) {
        return upstreamRefused(opened, account.platform);
      }
      const { sessionId, socket, held } = opened.session;
      yield* record.register({ userId: account.accountId, sessionId, deviceId: account.deviceId });
      const answer: SessionAudioCreatedFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_CREATED,
        sessionId,
        ...(account.quota === undefined ? undefined : { quota: account.quota }),
      };
      return {
        sessionId,
        accountId: account.accountId,
        deviceId: account.deviceId,
        platform: account.platform,
        started: true,
        sideband: socket,
        held,
        answer,
        logEvent: LOG_EVENT.SESSION_CREATED,
      };
    });

  /**
   * A fresh connection to a session that stands: the bearer's account, and
   * only when the session named was created for that very account. A session
   * this deployment never created, or another account's, is refused as the
   * bearer's own failure rather than as a hint that the id exists. The
   * introduction never re-attaches. What is proven here is the session's
   * owner rather than a device, so no device row is read and nothing this
   * connection logs counts a platform, exactly as its `deviceId` names none.
   */
  const openAttached = (
    upstream: LiveUpstream,
    admission: Admission,
    frame: SessionAttachFrame,
  ): SessionEffect<Opened> =>
    Effect.gen(function* () {
      if (admission.route !== VOICE_ROUTE.SESSIONS) {
        return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      }
      const accountId = yield* accounts.resolveUserId(admission.bearer);
      if (
        accountId === undefined ||
        !(yield* record.owned({ userId: accountId, sessionId: frame.sessionId }))
      ) {
        return refused(HOSTED_API_ERROR.INVALID_TOKEN);
      }
      const sideband = yield* attach(upstream, frame.sessionId);
      if (sideband === undefined) return refused(HOSTED_API_ERROR.UPSTREAM_ERROR);
      const answer: SessionAttachedFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_ATTACHED,
        sessionId: frame.sessionId,
      };
      return {
        sessionId: frame.sessionId,
        accountId,
        deviceId: undefined,
        platform: undefined,
        started: true,
        sideband,
        held: [],
        answer,
        logEvent: LOG_EVENT.SESSION_ATTACHED,
      };
    });

  return {
    open: (upstream, admission, device) =>
      Effect.gen(function* () {
        if (admission.route === VOICE_ROUTE.AUDIO) {
          const frame = yield* firstFrame(device, sessionAudioCreateFrameFromWire);
          if (frame === undefined || !(yield* device.isOpen)) {
            return refused(HOSTED_API_ERROR.INVALID_REQUEST);
          }
          return yield* openAudio(upstream, admission, frame);
        }
        const frame = yield* firstFrame(device, sessionOpeningFrameFromWire);
        if (frame === undefined || !(yield* device.isOpen)) {
          return refused(HOSTED_API_ERROR.INVALID_REQUEST);
        }
        return frame.type === VOICE_SERVICE_FRAME.SESSION_ATTACH
          ? yield* openAttached(upstream, admission, frame)
          : yield* openCreated(upstream, admission, frame);
      }),
  };
}
