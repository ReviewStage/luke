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
  type SessionCreateFrame,
  sessionCreatedFrameSchema,
  VOICE_SERVICE_FRAME,
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
import {
  type LiveSideband,
  type LiveSocket,
  type OpenSocket,
  SOCKET_OPEN_FAULT,
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

/** The introduction's session has no trusted half on the desktop; the voice service holds that sideband. */
export type IntroductionLiveSessionOpened = LiveSessionCreated;

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
    let opening = await this.#open(bearer);
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
        opening = await this.#open(renewed);
      }
    }
    if (!socketOpened(opening)) {
      const { outcome, detail } = socketFaultOutcome(opening);
      this.#refuse(outcome, detail);
      return undefined;
    }
    const { socket } = opening;
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

  async #bearer(): Promise<string | undefined> {
    if (!this.#authorization) return undefined;
    const token = await this.#authorization.readAccessToken().catch(() => undefined);
    return token ? `Bearer ${token}` : undefined;
  }

  async #holder(): Promise<string | undefined> {
    return this.#authorization?.readAccountKey?.().catch(() => undefined);
  }

  #open(bearer: string | undefined): Promise<SocketOpening> {
    return this.#openSocket(this.#address, bearer === undefined ? {} : { authorization: bearer });
  }

  /**
   * Waits for the service's one answer. A frame is decoded but not judged
   * here; a socket closed before it answered, or one silent past the request
   * deadline, is recorded as the service unavailable.
   */
  #firstFrame(socket: LiveSocket, send: () => void): Promise<WireRecord | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: WireRecord | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stopMessages();
        stopClose();
        resolve(value);
      };
      const timer = setTimeout(() => {
        this.#outcome.record(
          LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE,
          "no answer before the deadline",
        );
        settle(undefined);
      }, this.#requestTimeoutMs);
      const stopMessages = socket.onMessage((data) => {
        const payload = decodeLivePayload(data);
        if (payload === undefined) {
          this.#outcome.record(
            LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE,
            "answer was not a document",
          );
        }
        settle(payload);
      });
      const stopClose = socket.onClose((close) => {
        this.#outcome.record(
          LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE,
          close.code === undefined ? "closed before answering" : `closed with code ${close.code}`,
        );
        settle(undefined);
      });
      send();
    });
  }

  #readCreated(payload: WireRecord): LiveSessionCreated | undefined {
    const created = sessionCreatedFrameSchema.parse(payload);
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

type ServiceSourceOptions = Omit<
  ServiceSessionOptions,
  "servicePath" | "logLabel" | "authorization"
>;

export type HostedLiveSessionOptions = ServiceSourceOptions & AccountToken;

/**
 * The signed-in account's sessions, through Luke's voice service, for a
 * developer who has not connected an OpenAI key of their own. The socket the
 * service answered on is the sideband, so attaching opens nothing further.
 */
export class HostedLiveSessionSource extends ServiceLiveSessionSource implements LiveSessionSource {
  constructor(options: HostedLiveSessionOptions) {
    const { readAccessToken, refreshAccount, readAccountKey, ...rest } = options;
    super({
      ...rest,
      servicePath: VOICE_SERVICE_PATH.SESSIONS,
      logLabel: "Hosted live session",
      authorization: { readAccessToken, refreshAccount, readAccountKey },
    });
  }

  async create(input: LiveSessionCreateInput): Promise<LiveSessionOpened | undefined> {
    const opened = await this.createSession(input);
    if (!opened) return undefined;
    // The socket that answered is already the session's: the sideband is held
    // now, so nothing the session says before the host attaches is lost.
    const sideband = this.holdSideband(opened.socket);
    return { ...opened.created, attach: async () => sideband };
  }
}

export type IntroductionLiveSessionOptions = Omit<ServiceSourceOptions, "voice">;

/**
 * The one-time introduction's session, before any account exists. The
 * handshake deliberately carries no authorization header — the endpoint takes
 * no identity and this source holds none to send — and the session has no
 * sideband on this side by type: the voice service holds it and sends the
 * greeting, so nothing on this machine can append to it.
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
    opened.socket.close();
    return opened.created;
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
