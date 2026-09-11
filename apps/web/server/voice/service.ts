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
  type SessionAttachedFrame,
  type SessionAttachFrame,
  type SessionCreatedFrame,
  type SessionCreateFrame,
  type SessionOpeningFrame,
  sessionOpeningFrameFromWire,
  VOICE_SERVICE_FRAME,
} from "../core.js";
import {
  decodeLivePayload,
  greetingInstruction,
  instructionsAppend,
  LIVE_SCENE,
  LIVE_SESSION_OUTCOME,
  liveSessionConfig,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_ROLE,
} from "../live.js";
import type { VoiceAccounts } from "./accounts.js";
import { frameText, routeForPath, VOICE_ROUTE, type VoiceRoute } from "./frames.js";
import { LOG_EVENT, type Log, standardOutputLog } from "./log.js";
import { createLiveUpstream, type LiveUpstream } from "./openai.js";
import { RELAY_DEFAULTS, relaySession, SOCKET_CLOSE_CODE } from "./relay.js";
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
 * route the sideband is the service's alone: it sends the greeting
 * once the session starts and shows the caller only captions and status.
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
  /** The OpenAI `/v1` base; a test points it at a fake. */
  openAiBaseUrl?: string;
  fetch?: CloudFetch;
  log?: Log;
  closeTimeoutMs?: number;
  attachTimeoutMs?: number;
  createTimeoutMs?: number;
  firstFrameTimeoutMs?: number;
}

/** Who an upgrade admitted: a desktop with the `Authorization` value it presented, or an introduction with nothing. */
type Admission =
  | { route: typeof VOICE_ROUTE.SESSIONS; bearer: string }
  | { route: typeof VOICE_ROUTE.INTRODUCTION };

type UpgradeDecision = Admission | { status: number };

/** A session standing behind a socket, with the frame that says so, or the reason it is not. */
type Opened =
  | {
      sessionId: string;
      /** The account the session is billed to; none for the introduction. */
      accountId: string | undefined;
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
      return bearer === undefined ? { status: UPGRADE_STATUS.UNAUTHORIZED } : { route, bearer };
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
      if ("sideband" in opened) opened.sideband.close(SOCKET_CLOSE_CODE.GOING_AWAY);
      return;
    }
    if ("refusal" in opened) {
      refuse(opened.refusal);
      return;
    }
    desktop.send(JSON.stringify(opened.answer));
    this.#log({ event: opened.logEvent, route });

    const { sessionId, accountId, sideband } = opened;
    const summary = await relaySession({
      route,
      desktop,
      upstream: sideband,
      closeTimeoutMs: this.#options.closeTimeoutMs ?? RELAY_DEFAULTS.CLOSE_TIMEOUT_MS,
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
    this.#log({ event: LOG_EVENT.SESSION_ENDED, route, ...summary });
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
    const answer: SessionCreatedFrame = {
      type: VOICE_SERVICE_FRAME.SESSION_CREATED,
      sessionId: "",
      sdpAnswer: "",
    };
    let accountId: string | undefined;
    if (admission.route === VOICE_ROUTE.SESSIONS) {
      accountId = await this.#accounts.resolveUserId(admission.bearer);
      if (accountId === undefined) return { refusal: HOSTED_API_ERROR.INVALID_TOKEN };
      const spend = await this.#accounts.spend(accountId);
      if (!spend.allowed) return { refusal: HOSTED_API_ERROR.QUOTA_EXHAUSTED };
      answer.quota = spend.quota;
    }

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
    if (accountId !== undefined) {
      await this.#record.register({ userId: accountId, sessionId: answer.sessionId });
    }
    const sideband = await this.#attach(upstream, answer.sessionId);
    if (sideband === undefined) return { refusal: HOSTED_API_ERROR.UPSTREAM_ERROR };
    return {
      sessionId: answer.sessionId,
      accountId,
      sideband,
      answer,
      logEvent: LOG_EVENT.SESSION_CREATED,
    };
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
      sideband,
      answer,
      logEvent: LOG_EVENT.SESSION_ATTACHED,
    };
  }

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
