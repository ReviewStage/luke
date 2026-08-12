import {
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
  type SessionProviderAdapter,
  type SessionStatus,
} from "@sidecar/core";

const UNKNOWN_REPOSITORY_LABEL = "workspace";
const GIT_SUFFIX = ".git";

const HTTP_METHOD = {
  GET: "GET",
} as const;

const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
} as const;

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
}

/**
 * The only way a subclass reaches its provider. It authenticates, bounds, and
 * parses the request, and it can express nothing but a read, so no adapter
 * built on it can change provider state.
 */
export type CloudRequest = (
  segments: readonly string[],
  query?: Readonly<Record<string, string>>,
) => Promise<Record<string, unknown>>;

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
 */
export abstract class CloudSessionAdapter implements SessionProviderAdapter {
  readonly provider: SessionProvider;

  readonly #readApiKey: () => Promise<string | undefined>;
  readonly #baseUrl: string;
  readonly #fetch: CloudFetch;
  readonly #now: () => number;
  readonly #minimumRefreshIntervalMs: number;

  #credential: string | undefined;
  #observations: readonly ProviderSessionObservation[] = [];
  #lastAttemptAt = Number.NEGATIVE_INFINITY;

  constructor(profile: CloudAdapterProfile, options: CloudAdapterOptions) {
    this.provider = profile.provider;
    this.#readApiKey = options.readApiKey;
    this.#baseUrl = resolveBaseUrl(profile, options.baseUrl);
    this.#fetch = options.fetch ?? defaultFetch;
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

    try {
      this.#observations = uniqueObservations(
        await this.collect((segments, query) => this.#requestJson(apiKey, segments, query), now),
      );
    } catch (error) {
      // A rejected credential clears observed state; a transient network or
      // server failure keeps the previous snapshot until the next attempt.
      if (error instanceof CloudRequestError && error.failure === CLOUD_FAILURE.UNAUTHORIZED) {
        this.#forgetObservedState();
      }
    }
    return this.#observations;
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
    this.forgetCachedIdentity();
    this.#observations = [];
  }

  #url(segments: readonly string[], query: Readonly<Record<string, string>>): string {
    const url = new URL(this.#baseUrl);
    url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url.href;
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
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
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

function uniqueObservations(
  observations: readonly ProviderSessionObservation[],
): readonly ProviderSessionObservation[] {
  const unique = new Map<string, ProviderSessionObservation>();
  for (const observation of observations) {
    if (!unique.has(observation.providerSessionId)) {
      unique.set(observation.providerSessionId, observation);
    }
  }
  return [...unique.values()];
}
