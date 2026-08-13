import {
  type ControllableSessionProviderAdapter,
  type MessageCapableSessionProviderAdapter,
  PROVIDER_MESSAGE_RESULT_STATUS,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionControl,
  type SessionProvider,
  type SessionStatus,
  sessionMessageText,
} from "@sidecar/core";

const UNKNOWN_REPOSITORY_LABEL = "workspace";
const GIT_SUFFIX = ".git";

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
} as const;

/**
 * How a provider expects its credential to be presented. Every provider so far
 * takes a bearer token; Google's alpha APIs take the key in their own header
 * instead, and a provider that authenticates some third way is not supported
 * rather than approximated.
 */
export const CLOUD_AUTH_SCHEME = {
  BEARER: "bearer",
  GOOGLE_API_KEY_HEADER: "google-api-key-header",
} as const;

export type CloudAuthScheme = (typeof CLOUD_AUTH_SCHEME)[keyof typeof CLOUD_AUTH_SCHEME];

const GOOGLE_API_KEY_HEADER = "X-Goog-Api-Key";

const AUTHORIZATION_HEADERS: Readonly<
  Record<CloudAuthScheme, (apiKey: string) => Readonly<Record<string, string>>>
> = {
  [CLOUD_AUTH_SCHEME.BEARER]: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  [CLOUD_AUTH_SCHEME.GOOGLE_API_KEY_HEADER]: (apiKey) => ({ [GOOGLE_API_KEY_HEADER]: apiKey }),
};

const DEFAULT_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  Accept: "application/json",
};

export const CLOUD_FAILURE = {
  UNAUTHORIZED: "unauthorized",
  TRANSIENT: "transient",
} as const;

export type CloudFailure = (typeof CLOUD_FAILURE)[keyof typeof CLOUD_FAILURE];

/**
 * Shared bounds for every cloud provider. They match the local adapters so a
 * session reads the same whether Luke observed it on disk or over the network.
 */
export const CLOUD_ADAPTER_DEFAULTS = {
  MAXIMUM_SESSION_AGE_MS: 24 * 60 * 60 * 1000,
  ACTIVE_SESSION_FRESHNESS_MS: 15 * 60 * 1000,
  MINIMUM_REFRESH_INTERVAL_MS: 15 * 1000,
  REQUEST_TIMEOUT_MS: 8 * 1000,
} as const;

export type CloudFetch = (url: string, init: RequestInit) => Promise<Response>;

export class CloudRequestError extends Error {
  readonly failure: CloudFailure;

  constructor(failure: CloudFailure, message: string) {
    super(message);
    this.name = "CloudRequestError";
    this.failure = failure;
  }
}

export interface CloudAdapterOptions {
  /** Resolves the credential at observation time so a settings change applies immediately. */
  readApiKey: () => Promise<string | undefined>;
  baseUrl?: string;
  fetch?: CloudFetch;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
}

/** The provider-specific identity and endpoint a subclass supplies once. */
export interface CloudAdapterProfile {
  provider: SessionProvider;
  defaultBaseUrl: string;
  baseUrlEnvironmentVariable?: string;
  /** Defaults to a bearer token, which is what every other provider takes. */
  authScheme?: CloudAuthScheme;
}

/**
 * The only way a subclass reaches its provider while observing. It
 * authenticates, bounds, and parses the request, and it can express nothing
 * but a read, so no observation pass built on it can change provider state.
 */
export type CloudRequest = (
  segments: readonly string[],
  query?: Readonly<Record<string, string>>,
) => Promise<Record<string, unknown>>;

/**
 * One documented write a provider takes for one of its sessions: the route and
 * the exact body its endpoint asks for. A subclass describes the request; the
 * base is the only thing that issues one.
 */
export interface CloudWriteRoute {
  segments: readonly string[];
  /**
   * A Google-style custom method, appended to the path as `:action` rather
   * than as a segment: it names what the request does to the resource the
   * segments already name.
   */
  action?: string;
  /** Left off entirely for an endpoint that documents an empty request. */
  body?: Readonly<Record<string, unknown>>;
}

export function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

export function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function textFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export function timestampFromRecord(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = textFromRecord(record, key);
  if (!value) return undefined;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

/**
 * Reads a value a provider reported only when this build knows it, so a state
 * added after this build shipped is left undefined rather than guessed at.
 */
export function knownValue<Value extends string>(
  values: Readonly<Record<string, Value>>,
  reported: string | undefined,
): Value | undefined {
  return Object.values(values).find((candidate) => candidate === reported);
}

/** Reads a list page without assuming which key a given provider wraps it in. */
export function recordsFromPage(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const data = body[key];
  return Array.isArray(data) ? data.filter(isRecord) : [];
}

/**
 * Luke labels a session by its repository, never by a workspace, agent, or
 * session name. Cloud providers derive those names from the opening prompt, so
 * they are transcript content that no adapter may surface.
 */
export function repositoryLabel(
  gitRemote: string | undefined,
  fallbackName: string | undefined,
): string {
  const remote = gitRemote?.trim().replace(/\/+$/, "");
  const lastSegment = remote?.split(/[/:]/).pop()?.trim();
  const repository = lastSegment?.endsWith(GIT_SUFFIX)
    ? lastSegment.slice(0, -GIT_SUFFIX.length)
    : lastSegment;
  return repository || fallbackName?.trim() || UNKNOWN_REPOSITORY_LABEL;
}

const defaultFetch: CloudFetch = (url, init) => fetch(url, init);

function resolveBaseUrl(profile: CloudAdapterProfile, configured: string | undefined): string {
  const fromEnvironment = profile.baseUrlEnvironmentVariable
    ? process.env[profile.baseUrlEnvironmentVariable]?.trim()
    : undefined;
  return configured?.trim() || fromEnvironment || profile.defaultBaseUrl;
}

/**
 * The shared half of every cloud provider adapter: credential handling, its own
 * refresh cadence, the failure rules that decide whether a snapshot survives,
 * and bounded read-only requests. A subclass supplies only the provider's
 * routes and how its reported state maps onto Luke's.
 *
 * The only writes any of this can make are `sendMessage` and `executeControl`,
 * and both act on nothing but what a user asked for against one session the
 * last pass observed and that advertised the capability being used.
 * Observation itself stays read-only.
 */
export abstract class CloudSessionAdapter
  implements MessageCapableSessionProviderAdapter, ControllableSessionProviderAdapter
{
  readonly provider: SessionProvider;

  readonly #readApiKey: () => Promise<string | undefined>;
  readonly #baseUrl: string;
  readonly #fetch: CloudFetch;
  readonly #authorizationHeaders: (apiKey: string) => Readonly<Record<string, string>>;
  readonly #now: () => number;
  readonly #minimumRefreshIntervalMs: number;

  #credential: string | undefined;
  #observations: readonly ProviderSessionObservation[] = [];
  #lastAttemptAt = Number.NEGATIVE_INFINITY;
  #collectPass = 0;

  constructor(profile: CloudAdapterProfile, options: CloudAdapterOptions) {
    this.provider = profile.provider;
    this.#readApiKey = options.readApiKey;
    this.#baseUrl = resolveBaseUrl(profile, options.baseUrl);
    this.#fetch = options.fetch ?? defaultFetch;
    this.#authorizationHeaders =
      AUTHORIZATION_HEADERS[profile.authScheme ?? CLOUD_AUTH_SCHEME.BEARER];
    this.#now = options.now ?? Date.now;
    this.#minimumRefreshIntervalMs = nonNegativeNumber(
      options.minimumRefreshIntervalMs,
      CLOUD_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS,
    );
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    // One observer must never abort the shared refresh pass, so a settings read
    // that fails is treated the same as having no credential at all.
    const apiKey = await this.#readApiKey().catch(() => undefined);
    if (!apiKey) {
      this.#credential = undefined;
      this.#forgetObservedState();
      return this.#observations;
    }

    const now = this.#now();
    if (apiKey === this.#credential) {
      // A network provider refreshes on its own cadence instead of on every
      // tick of the shared observation timer.
      if (now - this.#lastAttemptAt < this.#minimumRefreshIntervalMs) return this.#observations;
    } else {
      this.#credential = apiKey;
      this.#forgetObservedState();
    }
    this.#lastAttemptAt = now;

    // Observers can overlap: a settings save refreshes this adapter while a
    // timer-driven pass is still in flight with the key it replaced. Only the
    // newest pass may write, or sessions read as one credential would be
    // served as another's until the next refresh.
    const pass = ++this.#collectPass;
    try {
      const collected = await this.collect(this.#requestForPass(pass, apiKey), now);
      if (pass === this.#collectPass) this.#observations = cloudObservations(collected);
    } catch (error) {
      // A rejected credential clears observed state; a transient network or
      // server failure keeps the previous snapshot until the next attempt. A
      // superseded pass reports on a credential that no longer stands, so its
      // rejection says nothing about the current one.
      if (
        pass === this.#collectPass &&
        error instanceof CloudRequestError &&
        error.failure === CLOUD_FAILURE.UNAUTHORIZED
      ) {
        this.#forgetObservedState();
      }
    }
    return this.#observations;
  }

  /**
   * Sends one user-typed message to one observed session, through the
   * provider's documented message endpoint. Everything that could make this a
   * different kind of write is refused before a request exists: a session the
   * last pass did not observe, one that did not advertise `canReceiveMessage`,
   * text outside the message bound, and a missing credential all answer
   * without touching the network.
   */
  async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    const observation = this.#observations.find(
      (candidate) => candidate.providerSessionId === message.providerSessionId,
    );
    if (!observation?.canReceiveMessage) {
      return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
    }

    const text = sessionMessageText(message.text);
    if (!text) {
      return {
        status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
        reason: "A message has to be shorter than a document and longer than nothing.",
      };
    }

    // The credential is read at send time, not held from the observation pass,
    // so a key the user just replaced or removed is honoured immediately.
    const apiKey = await this.#readApiKey().catch(() => undefined);
    if (!apiKey) return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };

    const route = this.messageRoute(message.providerSessionId, text);
    if (!route) return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
    return this.#postWrite(apiKey, route);
  }

  /**
   * Runs one provider-defined control against one observed session, through
   * the endpoint the provider documents for it. The same refusals guard it
   * that guard a message: no request exists for a session the last pass did
   * not observe, for a control that session did not advertise, or without a
   * credential.
   */
  async executeControl(request: ProviderControlRequest): Promise<ProviderControlResult> {
    const observation = this.#observations.find(
      (candidate) => candidate.providerSessionId === request.providerSessionId,
    );
    // The advertised control — not the caller's copy of it — is what the route
    // is built from, so whatever it targets is the thing the last pass actually
    // saw, and nothing a caller sends can redirect it.
    const advertised = observation?.controls?.find((control) => control.id === request.control.id);
    if (!advertised) return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };

    const apiKey = await this.#readApiKey().catch(() => undefined);
    if (!apiKey) return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };

    const route = this.controlRoute(request.providerSessionId, advertised);
    if (!route) return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
    return this.#postWrite(apiKey, route);
  }

  /**
   * Where this provider's documented message endpoint lives and what it takes.
   * Returning nothing says this adapter cannot form the request — a provider
   * that documents no message endpoint at all, or an identity it has not
   * learned — never that the send failed. The default is that a provider takes
   * no messages, so a read-only adapter stays read-only by writing nothing.
   */
  protected messageRoute(_providerSessionId: string, _text: string): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * Where a documented control's endpoint lives. The control handed in is the
   * one the latest observation advertised, so a route built from its `target`
   * acts on what the user was shown. The default is that a provider advertises
   * no controls, so only an adapter that advertised one has anything to answer
   * here.
   */
  protected controlRoute(
    _providerSessionId: string,
    _control: SessionControl,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /** Runs one authenticated pass. Duplicate session ids are dropped by the base. */
  protected abstract collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]>;

  /**
   * Clears anything a subclass cached across passes. It runs whenever the
   * credential changes or is rejected, so nothing read as one user can be
   * reported as another.
   */
  protected forgetCachedIdentity(): void {}

  /**
   * Holds a status only while its timestamp is recent. Luke cannot tell a turn
   * that just finished from a chat abandoned hours ago once a session goes
   * stale, and reporting the stale state would speak at the wrong moment.
   */
  protected statusWhileRecent(
    status: SessionStatus,
    observedAt: number,
    now: number,
  ): SessionStatus {
    return now - observedAt <= CLOUD_ADAPTER_DEFAULTS.ACTIVE_SESSION_FRESHNESS_MS
      ? status
      : SESSION_STATUS.UNKNOWN;
  }

  /**
   * The headers every request carries besides the credential. A subclass
   * overrides this only when its provider asks for its own media type or a
   * version pin; the authorization header is layered on after these, so no
   * override can replace the credential.
   */
  protected requestHeaders(): Readonly<Record<string, string>> {
    return DEFAULT_REQUEST_HEADERS;
  }

  /** Keeps one failed resource from discarding an otherwise complete pass. */
  protected async tolerateItemFailure<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result | undefined> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CloudRequestError && error.failure === CLOUD_FAILURE.UNAUTHORIZED) {
        throw error;
      }
      return undefined;
    }
  }

  #forgetObservedState(): void {
    // A pass still in flight was started under a credential that no longer
    // stands, so its result must not land.
    this.#collectPass += 1;
    this.forgetCachedIdentity();
    this.#observations = [];
  }

  /**
   * Binds one pass's requests to the credential it started with. A superseded
   * pass fails instead of issuing another request with a replaced key, and
   * whatever a request already read is discarded before a subclass can cache
   * it over state that belongs to the new credential.
   */
  #requestForPass(pass: number, apiKey: string): CloudRequest {
    return async (segments, query) => {
      this.#assertPassCurrent(pass);
      const body = await this.#requestJson(apiKey, segments, query);
      this.#assertPassCurrent(pass);
      return body;
    };
  }

  #assertPassCurrent(pass: number): void {
    if (pass !== this.#collectPass) {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${this.provider.displayName} pass was superseded`,
      );
    }
  }

  #url(
    segments: readonly string[],
    query: Readonly<Record<string, string>>,
    action?: string,
  ): string {
    const url = new URL(this.#baseUrl);
    // The action rides after the segments unencoded: `:sendMessage` is part of
    // the route, and encoding its colon would name a different route.
    url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}${
      action ? `:${action}` : ""
    }`;
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url.href;
  }

  /**
   * The one authenticated write. It shares the read path's timeout and its
   * refusal to echo anything the provider said into an error a user sees, and
   * it answers with what became of the request rather than throwing: a write
   * is a user's own act, so every outcome has to land back on the row it left.
   */
  async #postWrite(apiKey: string, route: CloudWriteRoute): Promise<ProviderMessageResult> {
    const name = this.provider.displayName;
    let response: Response;
    try {
      response = await this.#fetch(this.#url(route.segments, {}, route.action), {
        method: HTTP_METHOD.POST,
        // The same layering as a read: the provider's own headers first, the
        // credential after them so no override can replace it.
        headers: {
          ...this.requestHeaders(),
          ...this.#authorizationHeaders(apiKey),
          // An endpoint that documents an empty request gets exactly that,
          // not an empty JSON object it never asked for.
          ...(route.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
        signal: AbortSignal.timeout(CLOUD_ADAPTER_DEFAULTS.REQUEST_TIMEOUT_MS),
      });
    } catch {
      return {
        status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
        reason: `${name} could not be reached, so nothing was sent.`,
      };
    }

    if (response.ok) {
      // A write that landed changes what the session is doing, so the refresh
      // that follows must actually ask: served from the cache inside the
      // minimum interval, the row would keep offering what the provider has
      // already taken.
      this.#lastAttemptAt = Number.NEGATIVE_INFINITY;
      return { status: PROVIDER_MESSAGE_RESULT_STATUS.ACCEPTED };
    }
    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
      return {
        status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
        reason: `${name} rejected the configured API key.`,
      };
    }
    if (response.status === HTTP_STATUS.NOT_FOUND) {
      return {
        status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
        reason: `${name} no longer has this session.`,
      };
    }
    if (response.status === HTTP_STATUS.CONFLICT) {
      return {
        status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
        reason: `${name} says this session has moved on since Luke last looked.`,
      };
    }
    return {
      status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
      reason: `${name} answered with status ${response.status}, so the request may not have landed.`,
    };
  }

  async #requestJson(
    apiKey: string,
    segments: readonly string[],
    query: Readonly<Record<string, string>> = {},
  ): Promise<Record<string, unknown>> {
    const name = this.provider.displayName;
    let response: Response;
    try {
      response = await this.#fetch(this.#url(segments, query), {
        method: HTTP_METHOD.GET,
        headers: {
          ...this.requestHeaders(),
          ...this.#authorizationHeaders(apiKey),
        },
        signal: AbortSignal.timeout(CLOUD_ADAPTER_DEFAULTS.REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CloudRequestError(CLOUD_FAILURE.TRANSIENT, `${name} request failed`);
    }

    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
      throw new CloudRequestError(
        CLOUD_FAILURE.UNAUTHORIZED,
        `${name} rejected the configured API key`,
      );
    }
    if (!response.ok) {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${name} responded with status ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${name} returned an unreadable response`,
      );
    }
    if (!isRecord(body)) {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${name} returned an unexpected response`,
      );
    }
    return body;
  }
}

/**
 * Drops a session a subclass reported twice, and stamps the location the base
 * already knows: nothing reaches this point except over the network, so a
 * subclass cannot forget to say its sessions run somewhere else.
 */
function cloudObservations(
  observations: readonly ProviderSessionObservation[],
): readonly ProviderSessionObservation[] {
  const unique = new Map<string, ProviderSessionObservation>();
  for (const observation of observations) {
    if (!unique.has(observation.providerSessionId)) {
      unique.set(observation.providerSessionId, {
        ...observation,
        location: SESSION_LOCATION.CLOUD,
      });
    }
  }
  return [...unique.values()];
}
