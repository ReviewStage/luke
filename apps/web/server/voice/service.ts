import { randomUUID } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import {
  type CloudFetch,
  HOSTED_API_ERROR,
  type HostedApiError,
  HTTP_STATUS,
  isDeviceWireId,
  type SessionAttachedFrame,
  type SessionAttachFrame,
  type SessionCreatedFrame,
  type SessionCreateFrame,
  type SessionOpeningFrame,
  sessionOpeningFrameFromWire,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_HEADER,
} from "../core.js";
import {
  commentaryAppend,
  decodeLivePayload,
  greetingCue,
  greetingInstruction,
  instructionsAppend,
  LIVE_SCENE,
  LIVE_SESSION_OUTCOME,
  type LiveClientEvent,
  liveSessionConfig,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_ROLE,
} from "../live.js";
import type { VoiceAccounts } from "./accounts.js";
import { frameText, routeForPath, VOICE_ROUTE, type VoiceRoute } from "./frames.js";
import type { AttachedSession, ExchangeAttachment, HostedLiveExchange } from "./live-exchange.js";
import { LOG_EVENT, type Log, standardOutputLog } from "./log.js";
import { createLiveUpstream, type LiveUpstream } from "./openai.js";
import {
  OPENING_OUTCOME,
  type OpeningSettled,
  RELAY_DEFAULTS,
  relaySession,
  SOCKET_CLOSE_CODE,
} from "./relay.js";
import type { VoiceSessionRecord } from "./session-record.js";

/**
 * The hosted voice service: the part of Luke's own deployment that holds the
 * GPT Live project key, so it is what creates each hosted session, attaches
 * the trusted sideband, and carries events between the desktop and OpenAI.
 * It runs as two Vercel Functions serving WebSockets, and keeps no
 * conversation and executes nothing: a session's transcript crosses it as
 * bytes it never reads past the `type` field, and what it writes down is
 * status codes and counts.
 *
 * Two upgrades stand. `/api/voice/sessions` takes a signed-in desktop under
 * its account bearer, resolved and spent by the same account code every
 * hosted route uses, before any session exists. `/api/voice/introduction`
 * takes a fresh install with no account under the same durable daily meter
 * the introduction mint spends, so the ceiling is the deployment's and not one
 * function instance's, spent only for an admitted opening frame, and on that
 * route the sideband is the service's alone: once the session starts it
 * sends the greeting, waits for the acknowledgment that says the model took
 * it, cues the model to begin, and shows the caller only captions and
 * status.
 *
 * A connection is one function invocation, and the platform closes it at the
 * function's maximum duration while the WebRTC session between the desktop
 * and OpenAI stands on. So a socket may also open with `session.attach`: the
 * account that created the session, proven by the `voice_sessions` row
 * creation wrote, attaches a fresh sideband to it and the pipe resumes. Whatever the session
 * said between the two connections is not replayed.
 *
 * A refusal has one of two shapes the desktop reads: an HTTP status on the
 * upgrade (401, 403, 503) before any socket stands, or, once one does, a
 * first frame carrying `{ error }` in the hosted vocabulary before the close.
 */

const SERVICE_DEFAULTS = {
  /** How long a fresh socket has to send its opening frame before it is refused. */
  FIRST_FRAME_TIMEOUT_MS: 10_000,
  /** The largest frame either side may send; `ws` closes the connection on a larger one. */
  MAXIMUM_FRAME_BYTES: 2 * 1024 * 1024,
} as const;

/** The statuses an upgrade is refused with, before any socket stands. */
export const UPGRADE_STATUS = {
  /** The handshake named a device in a shape no device id has; a desktop of this build never does. */
  BAD_REQUEST: 400,
  UNAUTHORIZED: HTTP_STATUS.UNAUTHORIZED,
  /** The handshake carried a browser `Origin`; the desktop connects from its main process and never does. */
  FORBIDDEN: HTTP_STATUS.FORBIDDEN,
  NOT_FOUND: HTTP_STATUS.NOT_FOUND,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** A plain request to a socket path: the answer says what the path is for. */
const UPGRADE_REQUIRED = 426;

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

const BEARER_SCHEME = "Bearer ";

export interface VoiceServiceOptions {
  /** The GPT Live project key; absent, every upgrade is refused with 503. */
  apiKey: string | undefined;
  model?: string | undefined;
  accounts: VoiceAccounts;
  /** The `voice_sessions` row of each signed-in session; the introduction, with no account, writes none. */
  record: VoiceSessionRecord;
  /**
   * The hosted exchange to stand on each signed-in session, adopted over the
   * same sideband the relay pipes; absent, the service only pipes, and the
   * desktop's own exchange is the one that answers.
   */
  exchange?: ExchangeAttachment;
  /** The OpenAI `/v1` base; a test points it at a fake. */
  openAiBaseUrl?: string;
  fetch?: CloudFetch;
  log?: Log;
  closeTimeoutMs?: number;
  /** How long the greeting's acknowledgment is waited on before the cue is abandoned. */
  greetingTimeoutMs?: number;
  attachTimeoutMs?: number;
  createTimeoutMs?: number;
  firstFrameTimeoutMs?: number;
}

/**
 * Who an upgrade admitted: a desktop with the `Authorization` value it
 * presented and the device row it claimed to be, or an introduction with
 * nothing. The claim is a well-formed id and no more until the account is
 * resolved; whether that account holds the row is asked then.
 */
type Admission =
  | { route: typeof VOICE_ROUTE.SESSIONS; bearer: string; deviceId: string | undefined }
  | { route: typeof VOICE_ROUTE.INTRODUCTION };

type SessionsAdmission = Extract<Admission, { route: typeof VOICE_ROUTE.SESSIONS }>;

/** The account a desktop's handshake resolved to, its device claim admitted and a session spent, or the reason it is refused. */
type AdmittedAccount =
  | { accountId: string; deviceId: string | undefined; quota: SessionCreatedFrame["quota"] }
  | { refusal: HostedApiError };

type UpgradeDecision = Admission | { status: number };

/** A session standing behind a socket, with the frame that says so, or the reason it is not. */
type Opened =
  | {
      sessionId: string;
      /** The account the session is billed to; none for the introduction. */
      accountId: string | undefined;
      /** The device the handshake named and the account was shown to hold; none for the introduction, for a desktop that sent none, and on a re-attach, which checks the session's owner and not a device. */
      deviceId: string | undefined;
      /** Whether the session is already running: false for one just created, whose peer has yet to connect; true for one re-attached, which spoke its start to an earlier connection. */
      started: boolean;
      sideband: WebSocket;
      answer: SessionCreatedFrame | SessionAttachedFrame;
      logEvent: typeof LOG_EVENT.SESSION_CREATED | typeof LOG_EVENT.SESSION_ATTACHED;
    }
  | { refusal: HostedApiError };

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function presentedBearer(request: IncomingMessage): string | undefined {
  const authorization = headerValue(request.headers.authorization);
  if (authorization === undefined || !authorization.startsWith(BEARER_SCHEME)) return undefined;
  return authorization.slice(BEARER_SCHEME.length).trim().length > 0 ? authorization : undefined;
}

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

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === socket.OPEN;
}

export class VoiceService {
  readonly #options: VoiceServiceOptions;
  readonly #log: Log;
  readonly #accounts: VoiceAccounts;
  readonly #record: VoiceSessionRecord;
  readonly #upstream: LiveUpstream | undefined;
  readonly #sockets: WebSocketServer;
  readonly #http = http.createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    response.writeHead(routeForPath(path) ? UPGRADE_REQUIRED : UPGRADE_STATUS.NOT_FOUND).end();
  });
  /** Every session under way, so a close can wait for each to finalize. */
  readonly #active = new Set<Promise<void>>();
  #admitting = true;

  constructor(options: VoiceServiceOptions) {
    this.#options = options;
    this.#log = options.log ?? standardOutputLog;
    this.#accounts = options.accounts;
    this.#record = options.record;
    const apiKey = options.apiKey?.trim();
    this.#upstream = apiKey
      ? createLiveUpstream({
          apiKey,
          baseUrl: options.openAiBaseUrl,
          fetch: options.fetch,
          createTimeoutMs: options.createTimeoutMs,
          attachTimeoutMs: options.attachTimeoutMs,
        })
      : undefined;
    this.#sockets = new WebSocketServer({
      noServer: true,
      maxPayload: SERVICE_DEFAULTS.MAXIMUM_FRAME_BYTES,
    });
    this.#http.on("upgrade", (request, socket, head) => {
      this.#upgrade(request, socket, head);
    });
  }

  /** The server a function exports: Vercel upgrades each WebSocket into it. */
  get server(): http.Server {
    return this.#http;
  }

  listen(port: number, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.#http.once("error", reject);
      this.#http.listen(port, host, () => {
        this.#http.off("error", reject);
        // SAFETY: a TCP server that is listening answers an AddressInfo, never a pipe path.
        const address = this.#http.address() as AddressInfo;
        resolve(address.port);
      });
    });
  }

  sessions(): number {
    return this.#active.size;
  }

  /**
   * Refuses new upgrades, closes every desktop socket so each relay runs
   * its graceful close upstream, waits for those to finalize under their
   * own timeouts, and then releases the listener.
   */
  async close(): Promise<void> {
    this.#admitting = false;
    for (const socket of this.#sockets.clients) {
      socket.close(SOCKET_CLOSE_CODE.GOING_AWAY);
    }
    await Promise.all(this.#active);
    await new Promise<void>((resolve) => {
      this.#sockets.close(() => {
        this.#http.close(() => resolve());
      });
    });
  }

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on("error", () => socket.destroy());
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const decision = this.#admit(request, routeForPath(path));
    if ("status" in decision) {
      this.#log({ event: LOG_EVENT.UPGRADE_REFUSED, route: path, status: decision.status });
      socket.end(`HTTP/1.1 ${decision.status} Refused\r\nConnection: close\r\n\r\n`);
      return;
    }
    this.#sockets.handleUpgrade(request, socket, head, (webSocket) => {
      const session = this.#serve(webSocket, decision).finally(() => {
        this.#active.delete(session);
      });
      this.#active.add(session);
    });
  }

  /** Who an upgrade admits before any socket stands, or the status it is refused with. */
  #admit(request: IncomingMessage, route: VoiceRoute | undefined): UpgradeDecision {
    if (!this.#admitting || this.#upstream === undefined) {
      return { status: UPGRADE_STATUS.SERVICE_UNAVAILABLE };
    }
    if (route === undefined) return { status: UPGRADE_STATUS.NOT_FOUND };
    if (request.headers.origin !== undefined) return { status: UPGRADE_STATUS.FORBIDDEN };
    if (route === VOICE_ROUTE.SESSIONS) {
      const bearer = presentedBearer(request);
      if (bearer === undefined) return { status: UPGRADE_STATUS.UNAUTHORIZED };
      const deviceId = headerValue(request.headers[VOICE_SERVICE_HEADER.DEVICE_ID]);
      if (deviceId !== undefined && !isDeviceWireId(deviceId)) {
        return { status: UPGRADE_STATUS.BAD_REQUEST };
      }
      return { route, bearer, deviceId };
    }
    return { route };
  }

  /** One socket, one session: the opening frame, the creation or attachment, the pipe. */
  async #serve(desktop: WebSocket, admission: Admission): Promise<void> {
    const upstream = this.#upstream;
    if (upstream === undefined) return;
    const { route } = admission;
    const refuse = (reason: HostedApiError): void => {
      this.#log({ event: LOG_EVENT.SESSION_REFUSED, route, reason });
      if (!isOpen(desktop)) return;
      desktop.send(JSON.stringify({ error: reason }));
      desktop.close(SOCKET_CLOSE_CODE.POLICY_VIOLATION, reason);
    };

    const frame = await this.#firstFrame(desktop);
    if (!isOpen(desktop)) return;
    if (frame === undefined) {
      refuse(HOSTED_API_ERROR.INVALID_REQUEST);
      return;
    }
    const opened =
      frame.type === VOICE_SERVICE_FRAME.SESSION_ATTACH
        ? await this.#openAttached(upstream, admission, frame)
        : await this.#openCreated(upstream, admission, frame);
    if (!isOpen(desktop)) {
      if ("sideband" in opened) this.#release(opened.sideband);
      return;
    }
    if ("refusal" in opened) {
      refuse(opened.refusal);
      return;
    }
    const { sessionId, accountId, sideband } = opened;
    // The exchange stands before the desktop is answered, on the same socket
    // the relay is about to pipe. The socket is paused since the attach, so a
    // frame the session spoke while the exchange stood is read once both
    // consumers listen, by both, in order.
    const standing =
      accountId === undefined
        ? { exchange: undefined }
        : await this.#attachExchange(route, {
            accountId,
            sessionId,
            deviceId: opened.deviceId,
            started: opened.started,
            sideband,
          });
    if ("refused" in standing) {
      this.#release(sideband);
      refuse(HOSTED_API_ERROR.UNAVAILABLE);
      return;
    }
    const { exchange } = standing;
    // The desktop may have gone while the exchange stood: nothing is answered
    // to a socket that is not there, and the exchange and the sideband are
    // released here rather than left standing for the invocation.
    if (!isOpen(desktop)) {
      sideband.resume();
      if (exchange !== undefined) await this.#stopExchange(exchange);
      this.#release(sideband);
      return;
    }
    desktop.send(JSON.stringify(opened.answer));
    this.#log({ event: opened.logEvent, route });

    const relaying = relaySession({
      route,
      desktop,
      upstream: sideband,
      closeTimeoutMs: this.#options.closeTimeoutMs ?? RELAY_DEFAULTS.CLOSE_TIMEOUT_MS,
      openingTimeoutMs: this.#options.greetingTimeoutMs ?? RELAY_DEFAULTS.OPENING_TIMEOUT_MS,
      onSessionStarted:
        route === VOICE_ROUTE.INTRODUCTION
          ? () => {
              this.#log({ event: LOG_EVENT.GREETING_SENT, route });
              return instructionsAppend({
                eventId: randomUUID(),
                delegationId: null,
                content: greetingInstruction(),
              });
            }
          : undefined,
      onOpeningSettled:
        route === VOICE_ROUTE.INTRODUCTION
          ? (settled) => this.#greetingSettled(route, settled)
          : undefined,
      onUsageUpdated:
        accountId === undefined
          ? undefined
          : (seconds) => {
              void this.#record.noteUsage({ sessionId, seconds }).catch(() => undefined);
            },
      onSessionClosed:
        accountId === undefined
          ? undefined
          : async (closed) => {
              await this.#record.close({
                sessionId,
                seconds: closed.usage.seconds,
                reason: closed.reason,
              });
              await this.#recordUsage(accountId, sessionId, closed.usage.seconds);
            },
    });
    // Both consumers listen now: what the session spoke since the attach is read here, by both.
    sideband.resume();
    const summary = await relaying;
    // The relay has settled and closed both transports; the exchange ends its
    // follows and its look, closes the session it holds (already gone, which
    // its sideband reports as the close it held), and waits for every record
    // write already started, so no line begun before the settle is cut.
    if (exchange !== undefined) await this.#stopExchange(exchange);
    this.#log({ event: LOG_EVENT.SESSION_ENDED, route, ...summary });
  }

  /**
   * The exchange the composition offers for the session, standing on the same
   * socket the relay pipes: none where the composition offers none, or the
   * refusal where one was offered and could not stand, since a session with an
   * exchange offered and none standing would have no one to answer its asks.
   * The attachment builds the sideband and adopts; this service hands it the
   * socket and reaches nothing of the exchange itself.
   */
  async #attachExchange(
    route: VoiceRoute,
    session: AttachedSession,
  ): Promise<{ exchange: HostedLiveExchange | undefined } | { refused: true }> {
    const attachment = this.#options.exchange;
    if (attachment === undefined) return { exchange: undefined };
    try {
      const exchange = await attachment(session);
      if (exchange === undefined) return { exchange: undefined };
      this.#log({ event: LOG_EVENT.EXCHANGE_ATTACHED, route });
      return { exchange };
    } catch {
      this.#log({ event: LOG_EVENT.EXCHANGE_FAILED, route });
      return { refused: true };
    }
  }

  /** A sideband let go before any pipe stood: resumed first, since a paused socket cannot complete its close handshake. */
  #release(sideband: WebSocket): void {
    sideband.resume();
    sideband.close(SOCKET_CLOSE_CODE.GOING_AWAY);
  }

  /** The exchange's stop, whose failure is the service's to report and never the relay's to inherit. */
  async #stopExchange(exchange: HostedLiveExchange): Promise<void> {
    try {
      await exchange.stop();
    } catch {
      this.#log({ event: LOG_EVENT.EXCHANGE_FAILED, route: VOICE_ROUTE.SESSIONS });
    }
  }

  /**
   * What follows the greeting's append, in the order the Live conversations
   * guide fixes: the acknowledgment is what licenses the cue, because the
   * greeting depends on application instructions and a cue sent ahead of
   * them would ask the model to begin a greeting it has not been given. A
   * refusal is written down by its kind alone, and a wait that runs out
   * leaves the introduction to the caller's own first word rather than
   * cueing a greeting the session may never have taken.
   */
  #greetingSettled(route: VoiceRoute, settled: OpeningSettled): LiveClientEvent | undefined {
    if (settled.outcome === OPENING_OUTCOME.REFUSED) {
      this.#log({
        event: LOG_EVENT.GREETING_REFUSED,
        route,
        errorType: settled.errorType,
        errorCode: settled.errorCode,
      });
      return undefined;
    }
    if (settled.outcome === OPENING_OUTCOME.UNACKNOWLEDGED) {
      this.#log({ event: LOG_EVENT.GREETING_UNACKNOWLEDGED, route });
      return undefined;
    }
    this.#log({ event: LOG_EVENT.GREETING_ACKNOWLEDGED, route });
    this.#log({ event: LOG_EVENT.GREETING_CUED, route });
    return commentaryAppend({
      eventId: randomUUID(),
      delegationId: null,
      content: greetingCue(),
    });
  }

  /**
   * A new session: authorized and spent, created at OpenAI, registered to its
   * account, and attached. The introduction spends the deployment's shared
   * daily ceiling only once its frame has been admitted, as the mint spends
   * only after reading a valid body, so an empty or malformed handshake costs
   * the ceiling nothing.
   */
  async #openCreated(
    upstream: LiveUpstream,
    admission: Admission,
    frame: SessionCreateFrame,
  ): Promise<Opened> {
    const { route } = admission;
    if (route === VOICE_ROUTE.INTRODUCTION) {
      if (!introductionInputAdmitted(frame)) return { refusal: HOSTED_API_ERROR.INVALID_REQUEST };
      if (!(await this.#accounts.spendIntroduction()).allowed) {
        return { refusal: HOSTED_API_ERROR.QUOTA_EXHAUSTED };
      }
    }
    const account =
      admission.route === VOICE_ROUTE.SESSIONS ? await this.#admitAccount(admission) : undefined;
    if (account && "refusal" in account) return account;
    const answer: SessionCreatedFrame = {
      type: VOICE_SERVICE_FRAME.SESSION_CREATED,
      sessionId: "",
      sdpAnswer: "",
      ...(account?.quota === undefined ? undefined : { quota: account.quota }),
    };

    const config = liveSessionConfig({
      scene: route === VOICE_ROUTE.SESSIONS ? LIVE_SCENE.DESKTOP : LIVE_SCENE.INTRODUCTION,
      model: this.#options.model,
      voice: frame.voice,
      input: frame.input,
      clientEvents: RENDERER_CLIENT_EVENTS,
      serverEvents: RENDERER_SERVER_EVENTS,
    });
    const created = await upstream.create(config, frame.sdp);
    if (created.outcome !== LIVE_SESSION_OUTCOME.SUCCEEDED) {
      return {
        refusal:
          created.outcome === LIVE_SESSION_OUTCOME.HTTP_ERROR &&
          created.status === HTTP_STATUS.TOO_MANY_REQUESTS
            ? HOSTED_API_ERROR.UPSTREAM_THROTTLED
            : HOSTED_API_ERROR.UPSTREAM_ERROR,
      };
    }
    answer.sessionId = created.answer.session.id;
    answer.sdpAnswer = created.answer.transport.sdp;
    if (account) {
      await this.#record.register({
        userId: account.accountId,
        sessionId: answer.sessionId,
        deviceId: account.deviceId,
      });
    }
    const sideband = await this.#attach(upstream, answer.sessionId);
    if (sideband === undefined) return { refusal: HOSTED_API_ERROR.UPSTREAM_ERROR };
    return {
      sessionId: answer.sessionId,
      accountId: account?.accountId,
      deviceId: account?.deviceId,
      started: false,
      sideband,
      answer,
      logEvent: LOG_EVENT.SESSION_CREATED,
    };
  }

  /**
   * The desktop's handshake as an account, in the order the refusals are
   * cheapest: the bearer resolved, the device it claimed to be checked
   * against the rows the account holds, and only then a session spent. A
   * device the account does not hold is refused before the spend, so a claim
   * on someone else's device costs the claimant nothing and creates nothing;
   * the record's own write checks the same fact again, so a row gone between
   * here and there names no device.
   */
  async #admitAccount(admission: SessionsAdmission): Promise<AdmittedAccount> {
    const accountId = await this.#accounts.resolveUserId(admission.bearer);
    if (accountId === undefined) return { refusal: HOSTED_API_ERROR.INVALID_TOKEN };
    if (
      admission.deviceId !== undefined &&
      !(await this.#record.deviceOwned({ userId: accountId, deviceId: admission.deviceId }))
    ) {
      return { refusal: HOSTED_API_ERROR.INVALID_REQUEST };
    }
    const spend = await this.#accounts.spend(accountId);
    if (!spend.allowed) return { refusal: HOSTED_API_ERROR.QUOTA_EXHAUSTED };
    return { accountId, deviceId: admission.deviceId, quota: spend.quota };
  }

  /**
   * A fresh connection to a session that stands: the bearer's account, and
   * only when the session named was created for that very account. A session
   * this deployment never created, or another account's, is refused as the
   * bearer's own failure rather than as a hint that the id exists. The
   * introduction never re-attaches.
   */
  async #openAttached(
    upstream: LiveUpstream,
    admission: Admission,
    frame: SessionAttachFrame,
  ): Promise<Opened> {
    if (admission.route !== VOICE_ROUTE.SESSIONS) {
      return { refusal: HOSTED_API_ERROR.INVALID_REQUEST };
    }
    const accountId = await this.#accounts.resolveUserId(admission.bearer);
    if (
      accountId === undefined ||
      !(await this.#record.owned({ userId: accountId, sessionId: frame.sessionId }))
    ) {
      return { refusal: HOSTED_API_ERROR.INVALID_TOKEN };
    }
    const sideband = await this.#attach(upstream, frame.sessionId);
    if (sideband === undefined) return { refusal: HOSTED_API_ERROR.UPSTREAM_ERROR };
    const answer: SessionAttachedFrame = {
      type: VOICE_SERVICE_FRAME.SESSION_ATTACHED,
      sessionId: frame.sessionId,
    };
    return {
      sessionId: frame.sessionId,
      accountId,
      deviceId: undefined,
      started: true,
      sideband,
      answer,
      logEvent: LOG_EVENT.SESSION_ATTACHED,
    };
  }

  /**
   * The sideband as the upstream hands it over: open and paused, since no
   * consumer listens yet and a frame the session speaks before the relay and
   * the exchange register would otherwise be emitted to nobody. `#serve`
   * resumes it once every listener stands, and what arrived meanwhile is read
   * then, in order.
   */
  async #attach(upstream: LiveUpstream, sessionId: string): Promise<WebSocket | undefined> {
    try {
      return await upstream.attach(sessionId);
    } catch {
      return undefined;
    }
  }

  async #recordUsage(userId: string, sessionId: string, seconds: number): Promise<void> {
    const outcome = await this.#accounts.recordSeconds({ userId, sessionId, seconds });
    this.#log({ event: LOG_EVENT.USAGE_RECORDED, route: VOICE_ROUTE.SESSIONS, seconds, outcome });
  }

  /** The socket's first frame as a `session.create` or `session.attach`, or nothing when it was late, closed, or neither. */
  #firstFrame(desktop: WebSocket): Promise<SessionOpeningFrame | undefined> {
    const timeoutMs = this.#options.firstFrameTimeoutMs ?? SERVICE_DEFAULTS.FIRST_FRAME_TIMEOUT_MS;
    return new Promise((resolve) => {
      const done = (frame: SessionOpeningFrame | undefined): void => {
        clearTimeout(timer);
        desktop.off("message", onMessage);
        desktop.off("close", onClose);
        resolve(frame);
      };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      const onMessage = (data: RawData, isBinary: boolean): void => {
        const payload = decodeLivePayload(frameText(data, isBinary));
        done(payload === undefined ? undefined : sessionOpeningFrameFromWire(payload));
      };
      const onClose = (): void => done(undefined);
      desktop.once("message", onMessage);
      desktop.once("close", onClose);
    });
  }
}
