import {
  ACT_RESULT_STATUS,
  type ProviderActResult,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  type SessionProvider,
} from "@sidecar/session";
import {
  type CloudFetch,
  HTTP_STATUS,
  isRecord,
  resolveOptions,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import {
  ADAPTER_DIAGNOSTIC_KIND,
  type AdapterDiagnosticCallback,
  type AdapterDiagnosticKind,
} from "./adapter-diagnostics.js";
import { ADAPTER_FAILURE, AdapterFailure, clearsObservedState } from "./adapter-failure.js";
import {
  CLOUD_ADAPTER_DEFAULTS,
  type CloudRequest,
  type CloudWriteRoute,
  requestDeadlineMs,
} from "./cloud-wire.js";

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

/**
 * How every provider observed here presents its credential. A provider that
 * authenticates some other way is not supported rather than approximated.
 */
function authorizationHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

const DEFAULT_REQUEST_HEADERS = {
  Accept: "application/json",
};

/**
 * The one body key a POSTed read document rides under. Linear's GraphQL and
 * Conductor's transcripts view both name it `query`, and a provider that names
 * it something else is asking for its own client rather than an option here.
 */
const READ_DOCUMENT_FIELD = "query";

/** What a write acts on, as a refusal should name it. */
export const WRITE_SUBJECT = {
  SESSION: "session",
  PROJECT: "project",
  WORKSPACE: "workspace",
} as const;

export type WriteSubject = (typeof WRITE_SUBJECT)[keyof typeof WRITE_SUBJECT];

/** What one authenticated write became, and whatever the provider answered with. */
export interface CloudWriteOutcome {
  outcome: ProviderActResult;
  body?: WireRecord;
}

/**
 * One read bound to the credential rather than to one pass, for an offer that
 * rides beside the passes and may outlive several. Only a credential change
 * discards it. What the caller does with the answer is handed in rather than
 * returned, so the check and the write share one synchronous step and a
 * credential cleared in the gap between them has no gap to land in.
 */
export type CredentialBoundRead = (
  segments: readonly string[],
  query: Readonly<Record<string, string>> | undefined,
  options: Readonly<{ timeoutMs?: number; document?: string }> | undefined,
  apply: (body: WireRecord) => void,
) => Promise<void>;

export interface CloudPassInput {
  provider: SessionProvider;
  defaultBaseUrl: string;
  baseUrlEnvironmentVariable?: string;
  /** Resolves the credential at observation time so a settings change applies immediately. */
  readApiKey: () => Promise<string | undefined>;
  baseUrl?: string;
  fetch?: CloudFetch;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  /**
   * The headers every request carries besides the credential, for a provider
   * that asks for its own media type or a version pin. The authorization
   * header is layered on after these, so nothing here can replace the
   * credential.
   */
  requestHeaders?: Readonly<Record<string, string>>;
  /**
   * Called when an observation pass fails for a reason other than a network
   * or credential fault — a TypeError in an adapter's parsing, for example —
   * or when an adapter reports a problem of its own, named by the kind.
   * Transient and unauthorized {@link AdapterFailure} never reach it.
   */
  onDiagnostic?: AdapterDiagnosticCallback;
  /**
   * Clears anything the adapter cached across passes. It runs whenever the
   * credential changes or is rejected, so nothing read as one user can be
   * reported as another.
   */
  forget?(): void;
  /** Runs one authenticated pass. Duplicate session ids are dropped here. */
  collect(request: CloudRequest, now: number): Promise<readonly ProviderSessionObservation[]>;
}

/**
 * The shared half of every cloud provider: credential handling, its own
 * refresh cadence, the failure rules that decide whether a snapshot survives,
 * bounded read-only requests, and the one authenticated write. An adapter
 * supplies the provider's routes and how its reported state maps onto Luke's,
 * and reaches its provider through nothing but these.
 */
export interface CloudPass {
  run(): Promise<readonly ProviderSessionObservation[]>;
  latest(): readonly ProviderSessionObservation[];
  /** One authenticated write; answers what became of it, never throws. */
  write(apiKey: string, route: CloudWriteRoute, subject?: WriteSubject): Promise<CloudWriteOutcome>;
  credentialBoundRead: CredentialBoundRead;
  /** The credential as the caller's own act should present it, read afresh. */
  readApiKey(): Promise<string | undefined>;
  reportDiagnostic(kind: AdapterDiagnosticKind, error: Error): void;
}

const defaultFetch: CloudFetch = (url, init) => fetch(url, init);

function resolveBaseUrl(input: CloudPassInput): string {
  const fromEnvironment = input.baseUrlEnvironmentVariable
    ? process.env[input.baseUrlEnvironmentVariable]?.trim()
    : undefined;
  return input.baseUrl?.trim() || fromEnvironment || input.defaultBaseUrl;
}

/**
 * Drops a session an adapter reported twice, and stamps the location the pass
 * already knows: nothing reaches this point except over the network, so an
 * adapter cannot forget to say its sessions run somewhere else.
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

export function cloudPass(input: CloudPassInput): CloudPass {
  const provider = input.provider;
  const baseUrl = resolveBaseUrl(input);
  const performFetch = input.fetch ?? defaultFetch;
  const now = input.now ?? Date.now;
  const { minimumRefreshIntervalMs } = resolveOptions(
    input,
    { minimumRefreshIntervalMs: CLOUD_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS },
    { nonNegative: ["minimumRefreshIntervalMs"] },
  );
  const requestHeaders = input.requestHeaders ?? DEFAULT_REQUEST_HEADERS;

  let credential: string | undefined;
  /**
   * Bumped only when the credential changes or is rejected — unlike the pass
   * counter, which moves on every observation. It is what a slow read that
   * outlives its pass is bound to: several passes may come and go while it
   * runs, and only a different credential makes its answer wrong.
   */
  let credentialEpoch = 0;
  let observations: readonly ProviderSessionObservation[] = [];
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let collectPass = 0;

  const forgetObservedState = (): void => {
    // A pass still in flight was started under a credential that no longer
    // stands, so its result must not land — and neither may a slow read's.
    collectPass += 1;
    credentialEpoch += 1;
    input.forget?.();
    observations = [];
  };

  const url = (
    segments: readonly string[],
    query: Readonly<Record<string, string>>,
    action?: string,
  ): string => {
    const composed = new URL(baseUrl);
    // The action rides after the segments unencoded: `:sendMessage` is part of
    // the route, and encoding its colon would name a different route.
    composed.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}${
      action ? `:${action}` : ""
    }`;
    for (const [name, value] of Object.entries(query)) composed.searchParams.set(name, value);
    return composed.href;
  };

  const requestJson = async (
    apiKey: string,
    segments: readonly string[],
    query: Readonly<Record<string, string>> = {},
    options: Readonly<{ timeoutMs?: number; document?: string }> = {},
  ): Promise<WireRecord> => {
    const name = provider.displayName;
    const timeoutMs = requestDeadlineMs(options.timeoutMs);
    // A read document rides as a POST because that is how its endpoint is
    // documented, not because it writes: the body carries the document and
    // nothing else, so the request can still express nothing but a read.
    const document = options.document;
    let response: Response;
    try {
      response = await performFetch(url(segments, query), {
        method: document === undefined ? HTTP_METHOD.GET : HTTP_METHOD.POST,
        headers: {
          ...requestHeaders,
          ...authorizationHeaders(apiKey),
          ...(document === undefined ? undefined : { "Content-Type": "application/json" }),
        },
        ...(document === undefined
          ? undefined
          : { body: JSON.stringify({ [READ_DOCUMENT_FIELD]: document }) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, `${name} request failed`);
    }

    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
      throw new AdapterFailure(
        ADAPTER_FAILURE.UNAUTHORIZED,
        `${name} rejected the configured API key`,
      );
    }
    if (!response.ok) {
      throw new AdapterFailure(
        ADAPTER_FAILURE.TRANSIENT,
        `${name} responded with status ${response.status}`,
      );
    }

    let body: WireBoundaryInput;
    try {
      body = await response.json();
    } catch {
      throw new AdapterFailure(
        ADAPTER_FAILURE.TRANSIENT,
        `${name} returned an unreadable response`,
      );
    }
    const bodyRecord = wireRecord(unparsedWire(body));
    if (!bodyRecord) {
      throw new AdapterFailure(
        ADAPTER_FAILURE.TRANSIENT,
        `${name} returned an unexpected response`,
      );
    }
    return bodyRecord;
  };

  const assertPassCurrent = (pass: number): void => {
    if (pass !== collectPass) {
      throw new AdapterFailure(
        ADAPTER_FAILURE.TRANSIENT,
        `${provider.displayName} pass was superseded`,
      );
    }
  };

  /**
   * Binds one pass's requests to the credential it started with. A superseded
   * pass fails instead of issuing another request with a replaced key, and
   * whatever a request already read is discarded before an adapter can cache
   * it over state that belongs to the new credential.
   */
  const requestForPass = (pass: number, apiKey: string): CloudRequest => {
    return async (segments, query, options) => {
      assertPassCurrent(pass);
      const body = await requestJson(apiKey, segments, query, options);
      assertPassCurrent(pass);
      return body;
    };
  };

  return {
    async run() {
      // One observer must never abort the shared refresh pass, so a settings
      // read that fails is treated the same as having no credential at all.
      const apiKey = await input.readApiKey().catch(() => undefined);
      if (!apiKey) {
        credential = undefined;
        forgetObservedState();
        return observations;
      }

      const attemptedAt = now();
      if (apiKey === credential) {
        // A network provider refreshes on its own cadence instead of on every
        // tick of the shared observation timer.
        if (attemptedAt - lastAttemptAt < minimumRefreshIntervalMs) return observations;
      } else {
        credential = apiKey;
        forgetObservedState();
      }
      lastAttemptAt = attemptedAt;

      // Observers can overlap: a settings save refreshes this adapter while a
      // timer-driven pass is still in flight with the key it replaced. Only
      // the newest pass may write, or sessions read as one credential would be
      // served as another's until the next refresh.
      const pass = ++collectPass;
      try {
        const collected = await input.collect(requestForPass(pass, apiKey), attemptedAt);
        if (pass === collectPass) observations = cloudObservations(collected);
      } catch (error) {
        // A rejected credential clears observed state; a transient network or
        // server failure keeps the previous snapshot until the next attempt. A
        // superseded pass reports on a credential that no longer stands, so
        // its rejection says nothing about the current one.
        if (pass !== collectPass) return observations;
        if (error instanceof AdapterFailure) {
          if (clearsObservedState(error.failure)) forgetObservedState();
          return observations;
        }
        // Anything else is a bug in this pass — a TypeError thrown by an
        // adapter's parsing is not a network blip, and must not keep serving
        // the stale snapshot with no log, counter, or hook.
        input.onDiagnostic?.(
          ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
      return observations;
    },

    latest: () => observations,

    readApiKey: () => input.readApiKey().catch(() => undefined),

    reportDiagnostic(kind, error) {
      input.onDiagnostic?.(kind, error);
    },

    /**
     * The one authenticated write. It shares the read path's timeout and its
     * refusal to echo anything the provider said into an error a user sees,
     * and it answers with what became of the request rather than throwing: a
     * write is a user's own act, so every outcome has to land back on the row
     * it left. The subject is what the route acts on, so a refusal names the
     * thing that actually went missing. What the provider answered with rides
     * along for the adapter that needs it — a creation response names the
     * thing it created — and travels no further.
     */
    async write(apiKey, route, subject = WRITE_SUBJECT.SESSION) {
      const name = provider.displayName;
      let response: Response;
      try {
        response = await performFetch(url(route.segments, {}, route.action), {
          method: HTTP_METHOD.POST,
          // The same layering as a read: the provider's own headers first, the
          // credential after them so no override can replace it.
          headers: {
            ...requestHeaders,
            ...authorizationHeaders(apiKey),
            // An endpoint that documents an empty request gets exactly that,
            // not an empty JSON object it never asked for.
            ...(route.body === undefined ? undefined : { "Content-Type": "application/json" }),
          },
          ...(route.body === undefined ? undefined : { body: JSON.stringify(route.body) }),
          signal: AbortSignal.timeout(requestDeadlineMs(route.timeoutMs)),
        });
      } catch {
        // A thrown fetch cannot say which side of the wire failed: a
        // connection that never opened sent nothing, but a timeout or a reset
        // while the answer was coming back leaves a request the provider may
        // have already acted on. So the refusal hedges rather than claims, and
        // the refresh that follows must actually ask, so a write that did land
        // is reconciled against the provider instead of the cache still
        // advertising it.
        lastAttemptAt = Number.NEGATIVE_INFINITY;
        return {
          outcome: {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: `${name} did not answer, so the request may not have landed.`,
          },
        };
      }

      if (response.ok) {
        // A write that landed changes what the session is doing, so the
        // refresh that follows must actually ask: served from the cache inside
        // the minimum interval, the row would keep offering what the provider
        // has already taken.
        lastAttemptAt = Number.NEGATIVE_INFINITY;
        // An unreadable body is not a failed write: the provider already said
        // yes, so only a follow-up that needed the body has anything to miss.
        const body = await response.json().catch(() => undefined);
        return {
          outcome: { status: ACT_RESULT_STATUS.ACCEPTED },
          ...(isRecord(body) ? { body } : undefined),
        };
      }
      if (
        response.status === HTTP_STATUS.UNAUTHORIZED ||
        response.status === HTTP_STATUS.FORBIDDEN
      ) {
        return {
          outcome: {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: `${name} rejected the configured API key.`,
          },
        };
      }
      if (response.status === HTTP_STATUS.NOT_FOUND) {
        return {
          outcome: {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: `${name} no longer has this ${subject}.`,
          },
        };
      }
      if (response.status === HTTP_STATUS.CONFLICT) {
        return {
          outcome: {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: `${name} says this ${subject} has moved on since Luke last looked.`,
          },
        };
      }
      // Any other status is an answer that says nothing certain about the act
      // — a gateway that gave up may stand in front of a write that finished —
      // so this hedges the way a thrown fetch does, and the refresh that
      // follows must actually ask rather than keep advertising what the
      // provider may have already taken.
      lastAttemptAt = Number.NEGATIVE_INFINITY;
      return {
        outcome: {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: `${name} answered with status ${response.status}, so the request may not have landed.`,
        },
      };
    },

    async credentialBoundRead(segments, query, options, apply) {
      const epoch = credentialEpoch;
      const apiKey = credential;
      if (!apiKey) {
        throw new AdapterFailure(
          ADAPTER_FAILURE.TRANSIENT,
          `${provider.displayName} has no credential to read with`,
        );
      }
      const body = await requestJson(apiKey, segments, query, options);
      if (epoch !== credentialEpoch) {
        throw new AdapterFailure(
          ADAPTER_FAILURE.TRANSIENT,
          `${provider.displayName} read outlived its credential`,
        );
      }
      apply(body);
    },
  };
}

/** Keeps one failed resource from discarding an otherwise complete pass. */
export async function tolerateItemFailure<Result>(
  operation: () => Promise<Result>,
): Promise<Result | undefined> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AdapterFailure && clearsObservedState(error.failure)) throw error;
    return undefined;
  }
}
