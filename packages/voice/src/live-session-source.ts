import {
  type AccountToken,
  CALL_FAULT,
  type CallFailure,
  callAnswered,
  createAccountCall,
  fixedBearer,
  HOSTED_API_ERROR,
  type HostedApiError,
  type HostedQuota,
  hostedErrorSchema,
  hostedQuotaSchema,
  isHostedVoiceServiceAddress,
  type LiveSessionCreated,
  type SessionAttachFrame,
  type SessionCreateFrame,
  sessionAttachedFrameFromWire,
  sessionCreatedFrameFromWire,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_HEADER,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
import {
  decodeLivePayload,
  type InitialItem,
  isLiveVoice,
  LIVE_DEFAULTS,
  LIVE_SCENE,
  LIVE_SESSION_OUTCOME,
  LIVE_SESSIONS_PATH,
  type LiveDiagnostics,
  type LiveSessionOutcome,
  type LiveVoice,
  liveAttachPath,
  liveCreateAnswerSchema,
  liveCreateRequest,
  liveSessionConfig,
} from "@sidecar/live";
import {
  type CloudFetch,
  HTTP_METHOD,
  HTTP_STATUS,
  positiveInteger,
  text,
  unparsedWire,
  type WireRecord,
  withoutTrailingSlash,
} from "@sidecar/wire";
import { Data, Duration, Effect, Fiber, Runtime, Schedule } from "effect";
import { type HeldSocket, holdSocket } from "./held-socket.js";
import {
  type LiveSideband,
  type LiveSocket,
  type OpenSocket,
  SOCKET_OPEN_FAULT,
  type SocketClose,
  type SocketOpenFailure,
  type SocketOpening,
  sidebandOverSocket,
  socketOpened,
} from "./live-socket.js";

/**
 * Where a GPT Live session comes from — the developer's own OpenAI key, the
 * signed-in account through Luke's voice service, or the accountless
 * introduction endpoint — and what each answers with: the session's opaque id
 * and the SDP answer the renderer applies, never a credential. The trusted
 * side of the session (the sideband) is reached only through what a source
 * opened, so the renderer's peer connection and the host's sideband are one
 * session by construction.
 */

export const LIVE_ENVIRONMENT = {
  MODEL: "LUKE_LIVE_MODEL",
  VOICE: "LUKE_LIVE_VOICE",
} as const;

const OPENAI_LIVE_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAVAILABLE_STATUS = 503;

export interface LiveSessionCreateInput {
  /** The renderer's SDP offer, as written. */
  sdpOffer: string;
  /** The startup history, already bounded by `conversationSeedItems`. */
  input: readonly InitialItem[];
}

/** A session that stands: the renderer's half, and the trusted half the host attaches. */
export interface LiveSessionOpened extends LiveSessionCreated {
  /**
   * Opens the trusted sideband on this session. Called once per session; a
   * failure records `SIDEBAND_FAILED` on the source and rejects, and the
   * session it leaves standing is the caller's to close.
   */
  attach(): Promise<LiveSideband>;
}

/**
 * The introduction's session has no trusted half on the desktop; the voice
 * service holds that sideband. What the desktop holds instead is the
 * connection the session was created over: the service closes the session
 * on the caller's behalf the moment that connection ends, so the takeover
 * keeps it for the introduction's duration and `close` is the hang-up.
 */
export interface IntroductionLiveSessionOpened extends LiveSessionCreated {
  close(): void;
}

export interface LiveSessionSource {
  create(input: LiveSessionCreateInput): Promise<LiveSessionOpened | undefined>;
  /** Applies to the next session: a voice is immutable once a session has started. */
  setVoice(voice: string | undefined): void;
  diagnostics(): LiveDiagnostics;
}

/** The introduction's source: the same create, no voice to set, and no sideband on this side. */
export interface IntroductionSessionSource {
  create(input: LiveSessionCreateInput): Promise<IntroductionLiveSessionOpened | undefined>;
  diagnostics(): LiveDiagnostics;
}

/** The launch environment's voice, honoured only when it is one the API speaks. */
export function environmentLiveVoice(
  environment: NodeJS.ProcessEnv = process.env,
): LiveVoice | undefined {
  const value = environment[LIVE_ENVIRONMENT.VOICE]?.trim();
  return isLiveVoice(value) ? value : undefined;
}

function chosenVoice(voice: string | undefined, fallback: LiveVoice): LiveVoice {
  return isLiveVoice(voice) ? voice : fallback;
}

/**
 * What every source records about its last attempt, and the stderr line a
 * failed one writes: the outcome and a status or error name, never a request,
 * a key, or an SDP.
 */
class OutcomeRecord {
  readonly #logLabel: string;
  readonly #now: () => number;
  lastOutcome: LiveSessionOutcome = LIVE_SESSION_OUTCOME.NOT_ATTEMPTED;
  lastDetail: string | undefined;
  lastAttemptAt: number | undefined;

  constructor(logLabel: string, now: () => number) {
    this.#logLabel = logLabel;
    this.#now = now;
  }

  attempt(): void {
    this.lastAttemptAt = this.#now();
  }

  record(outcome: LiveSessionOutcome, detail?: string): void {
    this.lastOutcome = outcome;
    this.lastDetail = detail;
    if (outcome === LIVE_SESSION_OUTCOME.SUCCEEDED) return;
    process.stderr.write(`${this.#logLabel}: ${outcome}${detail ? ` (${detail})` : ""}\n`);
  }

  fields(): Pick<LiveDiagnostics, "lastOutcome" | "lastDetail" | "lastAttemptAt"> {
    return {
      lastOutcome: this.lastOutcome,
      ...(this.lastDetail ? { lastDetail: this.lastDetail } : undefined),
      ...(this.lastAttemptAt === undefined ? undefined : { lastAttemptAt: this.lastAttemptAt }),
    };
  }
}

interface RecordedOutcome {
  outcome: LiveSessionOutcome;
  detail: string;
}

/** A socket that never opened, named by the fault it ended at, for either service-side source. */
function socketFaultOutcome(opening: SocketOpenFailure): RecordedOutcome {
  if (opening.fault === SOCKET_OPEN_FAULT.NETWORK) {
    return {
      outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR,
      detail: opening.errorName ?? "unknown error",
    };
  }
  return { outcome: statusOutcome(opening.status), detail: `status ${opening.status}` };
}

function statusOutcome(status: number): LiveSessionOutcome {
  if (status === HTTP_STATUS.TOO_MANY_REQUESTS) return LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED;
  if (status === UNAVAILABLE_STATUS) return LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE;
  if (status === HTTP_STATUS.UNAUTHORIZED) return LIVE_SESSION_OUTCOME.NOT_SIGNED_IN;
  return LIVE_SESSION_OUTCOME.HTTP_ERROR;
}

/** The hosted refusals that name a distinct way forward; every other reason is a plain HTTP error. */
const HOSTED_ERROR_OUTCOME: ReadonlyMap<HostedApiError, LiveSessionOutcome> = new Map([
  [HOSTED_API_ERROR.INVALID_TOKEN, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN],
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED, LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED],
  [HOSTED_API_ERROR.UNAVAILABLE, LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE],
  [HOSTED_API_ERROR.UPSTREAM_THROTTLED, LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE],
]);

export interface KeyedLiveSessionOptions {
  apiKey: string;
  openSocket: OpenSocket;
  model?: string;
  voice?: string;
  /** The API's `/v1` base; the attach address is derived from it by scheme alone. */
  baseUrl?: string;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

/**
 * Sessions created with the developer's own OpenAI key. The key never leaves
 * the main process: the renderer receives the id and the SDP answer, and the
 * sideband this source attaches carries the same key on its handshake, from
 * here. A failure resolves to nothing rather than an error, leaving voice
 * unavailable and the rest of Luke working.
 */
export class KeyedLiveSessionSource implements LiveSessionSource {
  readonly #apiKey: string;
  readonly #openSocket: OpenSocket;
  readonly #model: string;
  /** The voice from construction, which a cleared setting falls back to. */
  readonly #configuredVoice: LiveVoice;
  #voice: LiveVoice;
  readonly #baseUrl: string;
  readonly #fetch: CloudFetch | undefined;
  readonly #requestTimeoutMs: number;
  readonly #outcome: OutcomeRecord;
  #sidebandAttached = false;

  constructor(options: KeyedLiveSessionOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.#openSocket = options.openSocket;
    this.#model = text(options.model) ?? LIVE_DEFAULTS.MODEL;
    this.#configuredVoice = chosenVoice(options.voice, LIVE_DEFAULTS.VOICE);
    this.#voice = this.#configuredVoice;
    this.#baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? OPENAI_LIVE_DEFAULTS.BASE_URL);
    this.#fetch = options.fetch;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      OPENAI_LIVE_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#outcome = new OutcomeRecord("OpenAI live session", options.now ?? Date.now);
  }

  get model(): string {
    return this.#model;
  }

  setVoice(voice: string | undefined): void {
    this.#voice = chosenVoice(voice, this.#configuredVoice);
  }

  async create(input: LiveSessionCreateInput): Promise<LiveSessionOpened | undefined> {
    this.#outcome.attempt();
    this.#sidebandAttached = false;
    const call = createAccountCall({
      baseUrl: this.#baseUrl,
      credential: fixedBearer(this.#apiKey),
      fetch: this.#fetch,
      requestTimeoutMs: this.#requestTimeoutMs,
    });
    const session = liveSessionConfig({
      scene: LIVE_SCENE.DESKTOP,
      model: this.#model,
      voice: this.#voice,
      input: input.input,
    });
    const answer = await call.send({
      method: HTTP_METHOD.POST,
      path: LIVE_SESSIONS_PATH,
      body: JSON.stringify(liveCreateRequest(session, input.sdpOffer)),
    });
    if (!callAnswered(answer)) {
      this.#refuseCall(answer);
      return undefined;
    }
    const { response } = answer;
    if (!response.ok) {
      // Status alone diagnoses credentials or rate limits without writing the
      // request or the key to the log.
      this.#outcome.record(LIVE_SESSION_OUTCOME.HTTP_ERROR, `status ${response.status}`);
      return undefined;
    }
    const payload = await response.json().catch(() => undefined);
    const created =
      payload === undefined ? undefined : liveCreateAnswerSchema.parse(unparsedWire(payload));
    if (!created) {
      this.#outcome.record(LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE, "no session id and SDP answer");
      return undefined;
    }
    this.#outcome.record(LIVE_SESSION_OUTCOME.SUCCEEDED);
    const sessionId = created.session.id;
    return {
      sessionId,
      sdpAnswer: created.transport.sdp,
      attach: () => this.#attach(sessionId),
    };
  }

  diagnostics(): LiveDiagnostics {
    return {
      apiKeyConfigured: true,
      fixtureMode: false,
      model: this.#model,
      voice: this.#voice,
      sidebandAttached: this.#sidebandAttached,
      ...this.#outcome.fields(),
    };
  }

  /**
   * The attach address is the sessions path under the API's socket scheme,
   * with the id kept unchanged, and the handshake carries the same project
   * key that created the session, as the server-controls guide requires.
   */
  async #attach(sessionId: string): Promise<LiveSideband> {
    const address = new URL(`${this.#baseUrl}${liveAttachPath(sessionId)}`);
    address.protocol = address.protocol === "http:" ? "ws:" : "wss:";
    const opening = await this.#openSocket(address.toString(), {
      authorization: `Bearer ${this.#apiKey}`,
    });
    if (!socketOpened(opening)) {
      const { detail } = socketFaultOutcome(opening);
      this.#outcome.record(LIVE_SESSION_OUTCOME.SIDEBAND_FAILED, detail);
      throw new Error(`sideband attach failed (${detail})`);
    }
    this.#sidebandAttached = true;
    opening.socket.onClose(() => {
      this.#sidebandAttached = false;
    });
    return sidebandOverSocket(opening.socket);
  }

  #refuseCall(failure: CallFailure): void {
    switch (failure.fault) {
      case CALL_FAULT.NETWORK:
        this.#outcome.record(
          LIVE_SESSION_OUTCOME.NETWORK_ERROR,
          failure.errorName ?? "unknown error",
        );
        return;
      case CALL_FAULT.NO_CREDENTIAL:
      case CALL_FAULT.HOLDER_CHANGED:
        this.#outcome.record(LIVE_SESSION_OUTCOME.NO_API_KEY);
        return;
    }
  }
}

interface ServiceSessionOptions {
  /** The voice service origin, `wss://` scheme; a value that is not an origin is refused at construction. */
  serviceOrigin: string;
  servicePath: string;
  openSocket: OpenSocket;
  logLabel: string;
  /**
   * The identity a socket's handshake carries. The introduction's endpoint
   * takes none, so it omits this, and then neither the header nor the
   * refresh-and-retry exists.
   */
  authorization?: AccountToken;
  /**
   * This installation's `devices` row id, read at each creation so a row
   * registered after the source was built is still named; nothing while the
   * device is not registered, and then the handshake carries no such header.
   */
  deviceId?: () => string | undefined;
  voice?: string;
  now?: () => number;
  requestTimeoutMs?: number;
}

/**
 * The frames the voice service exchanges before Live events flow, over one
 * socket per session: the desktop's `session.create` first, the service's
 * `session.created` back, and from then on the same socket carries the
 * session's events as themselves. A refusal comes back as the hosted error
 * document, or as the upgrade's own status.
 */
class ServiceLiveSessionSource {
  readonly #address: string;
  readonly #openSocket: OpenSocket;
  readonly #authorization: AccountToken | undefined;
  readonly #deviceId: (() => string | undefined) | undefined;
  readonly #configuredVoice: LiveVoice;
  #voice: LiveVoice;
  readonly #requestTimeoutMs: number;
  readonly #outcome: OutcomeRecord;
  #quota: HostedQuota | undefined;
  #sidebandAttached = false;

  constructor(options: ServiceSessionOptions) {
    const origin = text(options.serviceOrigin) ?? "";
    const address = `${origin}${options.servicePath}`;
    if (!isHostedVoiceServiceAddress(address, origin)) {
      throw new Error("The voice service origin must be an origin");
    }
    this.#address = address;
    this.#openSocket = options.openSocket;
    this.#authorization = options.authorization;
    this.#deviceId = options.deviceId;
    this.#configuredVoice = chosenVoice(options.voice, LIVE_DEFAULTS.VOICE);
    this.#voice = this.#configuredVoice;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      OPENAI_LIVE_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#outcome = new OutcomeRecord(options.logLabel, options.now ?? Date.now);
  }

  setVoice(voice: string | undefined): void {
    this.#voice = chosenVoice(voice, this.#configuredVoice);
  }

  diagnostics(): LiveDiagnostics {
    return {
      apiKeyConfigured: false,
      hosted: true,
      fixtureMode: false,
      model: LIVE_DEFAULTS.MODEL,
      voice: this.#voice,
      sidebandAttached: this.#sidebandAttached,
      ...this.#outcome.fields(),
      ...(this.#quota ? { quota: this.#quota } : undefined),
    };
  }

  /**
   * One session per socket. The socket is opened with the bearer on its
   * handshake, the offer and seed go as the first frame, and the answer is
   * the first frame back; the socket that answered is the sideband, held for
   * the caller's `attach`. Anything else — a refusal, a frame that is not the
   * answer, a close, or silence past the deadline — closes the socket and
   * resolves to nothing.
   */
  protected async createSession(
    input: LiveSessionCreateInput,
  ): Promise<{ created: LiveSessionCreated; socket: LiveSocket } | undefined> {
    this.#outcome.attempt();
    this.#sidebandAttached = false;
    const bearer = await this.#bearer();
    if (this.#authorization && bearer === undefined) {
      this.#outcome.record(LIVE_SESSION_OUTCOME.NOT_SIGNED_IN, "no access token");
      return undefined;
    }
    const deviceId = this.#deviceId?.();
    let opening = await this.#open(bearer, deviceId);
    if (
      !socketOpened(opening) &&
      opening.fault === SOCKET_OPEN_FAULT.REFUSED &&
      opening.status === HTTP_STATUS.UNAUTHORIZED &&
      this.#authorization
    ) {
      // Routine expiry of an hour-lived token: renew once and retry once, only
      // on a bearer that actually changed and still answers for the same account.
      const holder = await this.#holder();
      await this.#authorization.refreshAccount().catch(() => undefined);
      const renewed = await this.#bearer();
      if (renewed !== undefined && renewed !== bearer) {
        if ((await this.#holder()) !== holder) {
          this.#outcome.record(LIVE_SESSION_OUTCOME.NOT_SIGNED_IN, "the account changed");
          return undefined;
        }
        opening = await this.#open(renewed, deviceId);
      }
    }
    if (!socketOpened(opening)) {
      const { outcome, detail } = socketFaultOutcome(opening);
      this.#refuse(outcome, detail);
      return undefined;
    }
    const socket = holdSocket(opening.socket);
    const frame: SessionCreateFrame = {
      type: VOICE_SERVICE_FRAME.SESSION_CREATE,
      sdp: input.sdpOffer,
      voice: this.#voice,
      input: [...input.input],
    };
    const answer = await this.#firstFrame(socket, () => socket.send(JSON.stringify(frame)));
    const created = answer === undefined ? undefined : this.#readCreated(answer);
    if (!created) {
      socket.close();
      return undefined;
    }
    this.#outcome.record(LIVE_SESSION_OUTCOME.SUCCEEDED);
    return { created, socket };
  }

  /**
   * A refusal is only a signed-out answer where an identity was sent at all;
   * the introduction endpoint takes none, so its 401 is a fault worth chasing.
   */
  #refuse(outcome: LiveSessionOutcome, detail: string): void {
    this.#outcome.record(
      outcome === LIVE_SESSION_OUTCOME.NOT_SIGNED_IN && !this.#authorization
        ? LIVE_SESSION_OUTCOME.HTTP_ERROR
        : outcome,
      detail,
    );
  }

  protected holdSideband(socket: LiveSocket): LiveSideband {
    this.#sidebandAttached = true;
    socket.onClose(() => {
      this.#sidebandAttached = false;
    });
    return sidebandOverSocket(socket);
  }

  /**
   * One attempt to stand a fresh connection on a session that already exists:
   * a new socket under the current bearer, `session.attach` as its first
   * frame, and the service's `session.attached` for the same id as the
   * answer. A socket that would not open or went quiet is a transport
   * failure worth another try; a frame that is not the answer — a hosted
   * refusal, or another session's id — is the service's decision and ends
   * the attempts.
   */
  protected async attachOnce(sessionId: string): Promise<ReattachAttempt> {
    const bearer = await this.#bearer();
    if (this.#authorization && bearer === undefined) return { outcome: REATTACH_ATTEMPT.REFUSED };
    const opening = await this.#open(bearer);
    if (!socketOpened(opening)) {
      return {
        outcome:
          opening.fault === SOCKET_OPEN_FAULT.REFUSED && opening.status === HTTP_STATUS.UNAUTHORIZED
            ? REATTACH_ATTEMPT.REFUSED
            : REATTACH_ATTEMPT.FAILED,
      };
    }
    const socket = holdSocket(opening.socket);
    const frame: SessionAttachFrame = { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId };
    const answer = await this.#firstFrame(socket, () => socket.send(JSON.stringify(frame)));
    if (answer === undefined) {
      socket.close();
      return { outcome: REATTACH_ATTEMPT.FAILED };
    }
    const attached = sessionAttachedFrameFromWire(answer);
    if (attached?.sessionId === sessionId) return { outcome: REATTACH_ATTEMPT.ATTACHED, socket };
    socket.close();
    return { outcome: REATTACH_ATTEMPT.REFUSED };
  }

  async #bearer(): Promise<string | undefined> {
    if (!this.#authorization) return undefined;
    const token = await this.#authorization.readAccessToken().catch(() => undefined);
    return token ? `Bearer ${token}` : undefined;
  }

  async #holder(): Promise<string | undefined> {
    return this.#authorization?.readAccountKey?.().catch(() => undefined);
  }

  /** The handshake's headers: the bearer where one stands, and on a creation the device the session is opened for. */
  #open(bearer: string | undefined, deviceId?: string): Promise<SocketOpening> {
    return this.#openSocket(this.#address, {
      ...(bearer === undefined ? undefined : { authorization: bearer }),
      ...(deviceId === undefined ? undefined : { [VOICE_SERVICE_HEADER.DEVICE_ID]: deviceId }),
    });
  }

  /**
   * Waits for the service's one answer, taken from the held socket without
   * releasing its hold, so a frame the service sends right behind the answer
   * waits for the consumer that subscribes in the continuation rather than
   * being emitted to nobody in between. A frame is decoded but not judged
   * here; a socket closed before it answered, or one silent past the request
   * deadline, is recorded as the service unavailable.
   */
  #firstFrame(socket: HeldSocket, send: () => void): Promise<WireRecord | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: WireRecord | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        // The wait is withdrawn before the outcome is written, so the close the caller answers a
        // deadline with, or a frame arriving late, is held for the consumer and records nothing
        // over the deadline's own outcome.
        withdraw();
        this.#outcome.record(
          LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE,
          "no answer before the deadline",
        );
        settle(undefined);
      }, this.#requestTimeoutMs);
      const withdraw = socket.takeFirst((arrival) => {
        if (settled) return;
        if ("close" in arrival) {
          this.#outcome.record(
            LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE,
            arrival.close.code === undefined
              ? "closed before answering"
              : `closed with code ${arrival.close.code}`,
          );
          settle(undefined);
          return;
        }
        const payload = decodeLivePayload(arrival.frame);
        if (payload === undefined) {
          this.#outcome.record(
            LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE,
            "answer was not a document",
          );
        }
        settle(payload);
      });
      send();
    });
  }

  #readCreated(payload: WireRecord): LiveSessionCreated | undefined {
    const created = sessionCreatedFrameFromWire(payload);
    if (created) {
      this.#quota = created.quota ?? this.#quota;
      return { sessionId: created.sessionId, sdpAnswer: created.sdpAnswer };
    }
    const error = hostedErrorSchema.parse(payload);
    if (error) {
      if (error === HOSTED_API_ERROR.QUOTA_EXHAUSTED) {
        this.#quota = hostedQuotaSchema.parse(unparsedWire(payload.quota)) ?? this.#quota;
      }
      this.#refuse(HOSTED_ERROR_OUTCOME.get(error) ?? LIVE_SESSION_OUTCOME.HTTP_ERROR, error);
      return undefined;
    }
    this.#outcome.record(LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE, "no session id and SDP answer");
    return undefined;
  }
}

const REATTACH_ATTEMPT = {
  ATTACHED: "attached",
  /** The transport did not carry the attempt to an answer; another try may. */
  FAILED: "failed",
  /** The service answered, and the answer was not the attachment; no further try is made. */
  REFUSED: "refused",
} as const;

type ReattachAttempt =
  | { outcome: typeof REATTACH_ATTEMPT.ATTACHED; socket: LiveSocket }
  | { outcome: typeof REATTACH_ATTEMPT.FAILED }
  | { outcome: typeof REATTACH_ATTEMPT.REFUSED };

/**
 * When a lost connection is tried again: three tries over about ten
 * seconds — at once, three seconds later, and seven after that — because a
 * connection to the voice service is one function invocation the platform
 * closes at the function's maximum duration while the session stands on.
 */
export const HOSTED_REATTACH_DELAYS_MS: readonly number[] = [0, 3_000, 7_000];

/** The close code of a connection that ended because the session did, after which nothing is tried again. */
const NORMAL_CLOSE_CODE = 1000;

/** The transport did not carry the attempt to an answer; the schedule's own `while` is what decides whether another try may. */
class ReattachFailed extends Data.TaggedError("ReattachFailed") {}

/** The service answered, and the answer was not the attachment; no further try is made. */
class ReattachRefused extends Data.TaggedError("ReattachRefused") {}

/**
 * The gap between each of `delaysMs`' tries, read the way the hand-rolled loop
 * read it: the first entry is the wait before the very first try, which
 * `Effect.retry`'s own first attempt already stands in for, so what the
 * schedule states is the wait before every try after that — `delaysMs.length`
 * tries in all, `undefined` for no tries at all, and `Schedule.stop` for
 * exactly one.
 */
function reattachRetrySchedule(
  delaysMs: readonly number[],
): Schedule.Schedule<unknown> | undefined {
  if (delaysMs.length === 0) return undefined;
  const [, ...gaps] = delaysMs;
  const [first, ...rest] = gaps;
  if (first === undefined) return Schedule.stop;
  return Schedule.fromDelays(Duration.millis(first), ...rest.map((ms) => Duration.millis(ms)));
}

/**
 * The hosted sideband as one socket that outlives its connections. The host
 * holds this; underneath, the connection to the voice service is replaced
 * whenever it closes for any reason but the session's own end: a new socket
 * opens with `session.attach`, and the pipe resumes on it. What the session
 * said between the two connections is lost — the service replays nothing,
 * and no event that crossed in the gap reaches a listener — which is
 * accepted: the WebRTC media never crossed this socket, and the host reads a
 * sideband that went quiet the same way it reads any other silence. Sends
 * made during the gap are held and sent on the next connection. Only when
 * every try fails, or the service refuses the attachment, does the close
 * reach the listeners, as the connection loss the host already handles.
 *
 * The tries themselves are one fiber, on the runtime the source was handed:
 * closing the socket while it stands is that fiber's interruption, which
 * abandons whichever wait or attempt was in flight rather than polling a flag
 * for it, and an attempt that still lands the instant after is the one race
 * interruption cannot reach, so it is still closed by hand.
 */
class ReattachingSocket implements LiveSocket {
  #inner: LiveSocket;
  readonly #attach: (sessionId: string) => Promise<ReattachAttempt>;
  readonly #sessionId: string;
  readonly #delaysMs: readonly number[];
  readonly #runtime: Runtime.Runtime<never>;
  readonly #messageListeners = new Set<(data: string) => void>();
  readonly #closeListeners = new Set<(close: SocketClose) => void>();
  /** Frames heard before the first listener stands, replayed to it in order; the sideband over this socket subscribes only after construction. */
  #heldForListener: string[] | undefined = [];
  #held: string[] | undefined;
  #closedByClient = false;
  #ended = false;
  #recovery: Fiber.RuntimeFiber<void> | undefined;

  constructor(options: {
    socket: LiveSocket;
    sessionId: string;
    attach: (sessionId: string) => Promise<ReattachAttempt>;
    delaysMs: readonly number[];
    runtime: Runtime.Runtime<never>;
  }) {
    this.#inner = options.socket;
    this.#sessionId = options.sessionId;
    this.#attach = options.attach;
    this.#delaysMs = options.delaysMs;
    this.#runtime = options.runtime;
    this.#adopt(options.socket);
  }

  send(data: string): void {
    if (this.#held !== undefined) {
      this.#held.push(data);
      return;
    }
    this.#inner.send(data);
  }

  close(): void {
    this.#closedByClient = true;
    const recovery = this.#recovery;
    if (recovery) Runtime.runFork(this.#runtime)(Fiber.interrupt(recovery));
    this.#inner.close();
  }

  onMessage(listener: (data: string) => void): () => void {
    this.#messageListeners.add(listener);
    if (this.#heldForListener !== undefined) {
      const replay = this.#heldForListener;
      this.#heldForListener = undefined;
      for (const data of replay) listener(data);
    }
    return () => {
      this.#messageListeners.delete(listener);
    };
  }

  onClose(listener: (close: SocketClose) => void): () => void {
    this.#closeListeners.add(listener);
    return () => {
      this.#closeListeners.delete(listener);
    };
  }

  #adopt(socket: LiveSocket): void {
    socket.onMessage((data) => {
      if (socket !== this.#inner || this.#ended) return;
      if (this.#heldForListener !== undefined) {
        this.#heldForListener.push(data);
        return;
      }
      for (const listener of [...this.#messageListeners]) listener(data);
    });
    socket.onClose((close) => {
      if (socket !== this.#inner || this.#ended) return;
      if (this.#closedByClient || close.code === NORMAL_CLOSE_CODE) {
        this.#end(close);
        return;
      }
      this.#recovery = Runtime.runFork(this.#runtime)(
        this.#recoverEffect(close).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              this.#recovery = undefined;
            }),
          ),
        ),
      );
    });
  }

  #outcomeEffect(
    attempt: ReattachAttempt,
  ): Effect.Effect<LiveSocket, ReattachFailed | ReattachRefused> {
    if (this.#closedByClient) {
      if (attempt.outcome === REATTACH_ATTEMPT.ATTACHED) attempt.socket.close();
      return Effect.fail(new ReattachRefused());
    }
    if (attempt.outcome === REATTACH_ATTEMPT.ATTACHED) return Effect.succeed(attempt.socket);
    if (attempt.outcome === REATTACH_ATTEMPT.REFUSED) return Effect.fail(new ReattachRefused());
    return Effect.fail(new ReattachFailed());
  }

  #attemptEffect(): Effect.Effect<LiveSocket, ReattachFailed | ReattachRefused> {
    return Effect.promise(() => this.#attach(this.#sessionId)).pipe(
      Effect.flatMap((attempt) => this.#outcomeEffect(attempt)),
    );
  }

  #recoverEffect(close: SocketClose): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#held = [];
      const schedule = reattachRetrySchedule(this.#delaysMs);
      if (schedule === undefined) {
        this.#held = undefined;
        this.#end(close);
        return Effect.void;
      }
      return Effect.retry(this.#attemptEffect(), {
        schedule,
        while: (error) => error._tag === "ReattachFailed",
      }).pipe(
        Effect.match({
          onFailure: () => {
            this.#held = undefined;
            this.#end(close);
          },
          onSuccess: (socket) => {
            this.#inner = socket;
            this.#adopt(socket);
            const held = this.#held ?? [];
            this.#held = undefined;
            for (const data of held) socket.send(data);
          },
        }),
      );
    });
  }

  #end(close: SocketClose): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const listener of [...this.#closeListeners]) listener(close);
  }
}

type ServiceSourceOptions = Omit<
  ServiceSessionOptions,
  "servicePath" | "logLabel" | "authorization"
>;

export type HostedLiveSessionOptions = ServiceSourceOptions &
  AccountToken & {
    /** The waits between tries at re-attaching a lost connection; `HOSTED_REATTACH_DELAYS_MS` by default. */
    reattachDelaysMs?: readonly number[];
    /** The runtime the reattach tries are forked on, for a caller (a test today) that holds its own. */
    runtime?: Runtime.Runtime<never>;
  };

/**
 * The signed-in account's sessions, through Luke's voice service, for a
 * developer who has not connected an OpenAI key of their own. The socket the
 * service answered on is the sideband, so attaching opens nothing further;
 * when that connection closes before the session does, the sideband re-attaches
 * to the same session over a fresh one.
 */
export class HostedLiveSessionSource extends ServiceLiveSessionSource implements LiveSessionSource {
  readonly #reattachDelaysMs: readonly number[];
  readonly #runtime: Runtime.Runtime<never>;

  constructor(options: HostedLiveSessionOptions) {
    const { readAccessToken, refreshAccount, readAccountKey, reattachDelaysMs, runtime, ...rest } =
      options;
    super({
      ...rest,
      servicePath: VOICE_SERVICE_PATH.SESSIONS,
      logLabel: "Hosted live session",
      authorization: { readAccessToken, refreshAccount, readAccountKey },
    });
    this.#reattachDelaysMs = reattachDelaysMs ?? HOSTED_REATTACH_DELAYS_MS;
    this.#runtime = runtime ?? Runtime.defaultRuntime;
  }

  async create(input: LiveSessionCreateInput): Promise<LiveSessionOpened | undefined> {
    const opened = await this.createSession(input);
    if (!opened) return undefined;
    // The socket that answered is already the session's: the sideband is held
    // now, so nothing the session says before the host attaches is lost.
    const sideband = this.holdSideband(
      new ReattachingSocket({
        socket: opened.socket,
        sessionId: opened.created.sessionId,
        attach: (sessionId) => this.attachOnce(sessionId),
        delaysMs: this.#reattachDelaysMs,
        runtime: this.#runtime,
      }),
    );
    return { ...opened.created, attach: async () => sideband };
  }
}

export type IntroductionLiveSessionOptions = Omit<ServiceSourceOptions, "voice">;

/**
 * The one-time introduction's session, before any account exists. The
 * handshake deliberately carries no authorization header — the endpoint takes
 * no identity and this source holds none to send — and the session has no
 * sideband on this side by type: the voice service holds it and sends the
 * greeting, so nothing on this machine can append to it. The socket the
 * service answered on is kept open and never read, because the service treats
 * its close as the caller hanging up; the caller closes it to end the session.
 */
export class IntroductionLiveSessionSource
  extends ServiceLiveSessionSource
  implements IntroductionSessionSource
{
  constructor(options: IntroductionLiveSessionOptions) {
    super({
      ...options,
      servicePath: VOICE_SERVICE_PATH.INTRODUCTION,
      logLabel: "Introduction live session",
    });
  }

  async create(input: LiveSessionCreateInput): Promise<IntroductionLiveSessionOpened | undefined> {
    const opened = await this.createSession(input);
    if (!opened) return undefined;
    // Kept open and never read: the frames the service might send are heard and dropped, so the
    // hold on this socket releases at once rather than filling toward its bound.
    opened.socket.onMessage(() => undefined);
    return { ...opened.created, close: () => opened.socket.close() };
  }
}

/**
 * Explains why no source exists, which is the state the panel shows as voice
 * unavailable. A missing key and a fixture run look identical from the panel
 * and have completely different fixes.
 */
export function unavailableLiveDiagnostics(input: {
  fixtureMode: boolean;
  apiKeyConfigured: boolean;
}): LiveDiagnostics {
  return {
    apiKeyConfigured: input.apiKeyConfigured,
    fixtureMode: input.fixtureMode,
    model: text(process.env[LIVE_ENVIRONMENT.MODEL]) ?? LIVE_DEFAULTS.MODEL,
    voice: environmentLiveVoice() ?? LIVE_DEFAULTS.VOICE,
    sidebandAttached: false,
    lastOutcome: input.fixtureMode
      ? LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE
      : LIVE_SESSION_OUTCOME.NO_API_KEY,
  };
}

export type KeyedLiveSessionSourceOptions = Omit<KeyedLiveSessionOptions, "apiKey">;

/**
 * Builds a keyed source only when there is a key to build one from. The key
 * is resolved by the settings store; the model and voice fall back to the
 * launch environment here. `OPENAI_BASE_URL` is deliberately not read: the
 * renderer's peer connection reaches OpenAI's own media servers whatever base
 * a redirect names, so a session created elsewhere would answer an SDP the
 * media path cannot honor.
 */
export function keyedLiveSessions(
  apiKey: string | undefined,
  options: KeyedLiveSessionSourceOptions,
): KeyedLiveSessionSource | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;
  const model = text(options.model) ?? text(process.env[LIVE_ENVIRONMENT.MODEL]);
  const voice = isLiveVoice(options.voice) ? options.voice : environmentLiveVoice();
  return new KeyedLiveSessionSource({
    ...options,
    apiKey: resolved,
    ...(model ? { model } : undefined),
    ...(voice ? { voice } : undefined),
  });
}
