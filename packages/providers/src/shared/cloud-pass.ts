import * as Headers from "@effect/platform/Headers";
import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import type * as HttpClientError from "@effect/platform/HttpClientError";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import {
  ACTION_RESULT_STATUS,
  type ProviderActionResult,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  type SessionProvider,
  type SessionProviderPlugin,
} from "@sidecar/session";
import {
  type CloudFetch,
  HTTP_STATUS,
  resolveOptions,
  unparsedWire,
  type WireRecord,
  WireValueSchema,
  wireRecord,
} from "@sidecar/wire";
import { httpClientFromCloudFetch } from "@sidecar/wire/effect";
import { Cause, Duration, Effect, Option } from "effect";
import {
  ADAPTER_DIAGNOSTIC_KIND,
  type AdapterDiagnosticCallback,
  type AdapterDiagnosticKind,
} from "./adapter-diagnostics.js";
import {
  ADAPTER_FAILURE,
  AdapterFailure,
  type AdapterFailureKind,
  clearsObservedState,
} from "./adapter-failure.js";
import {
  type BackoffBudget,
  backoffBudget,
  CLOUD_ADAPTER_DEFAULTS,
  type CloudRequest,
  type CloudWriteRoute,
  RateLimitedRead,
  rateLimitSchedule,
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

/** The content type a serialized read document or write body names. */
const JSON_CONTENT_TYPE = "application/json";

/**
 * The range `fetch` called `ok`, restated because what a client's answer hands
 * back is a status rather than a `Response`.
 */
const OK_STATUS = {
  FIRST: 200,
  PAST: 300,
} as const;

/** What a write acts on, as a refusal should name it. */
export const WRITE_SUBJECT = {
  SESSION: "session",
  PROJECT: "project",
  WORKSPACE: "workspace",
} as const;

type WriteSubject = (typeof WRITE_SUBJECT)[keyof typeof WRITE_SUBJECT];

/** What one authenticated write became, and whatever the provider answered with. */
interface CloudWriteOutcome {
  outcome: ProviderActionResult;
  body?: WireRecord;
}

/**
 * One read bound to the credential rather than to one pass, for an offer that
 * rides beside the passes and may outlive several. Only a credential change
 * discards it. What the caller does with the answer is handed in rather than
 * returned, so the check and the write share one synchronous step and a
 * credential cleared in the gap between them has no gap to land in.
 */
type CredentialBoundRead = (
  segments: readonly string[],
  query: Readonly<Record<string, string>> | undefined,
  options: Readonly<{ timeoutMs?: number; document?: string }> | undefined,
  apply: (body: WireRecord) => void,
) => Effect.Effect<void, AdapterFailure>;

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
  collect(
    request: CloudRequest,
    now: number,
  ): Effect.Effect<readonly ProviderSessionObservation[], AdapterFailure>;
}

/**
 * A cloud provider's plugin says one thing more than the plugin contract asks:
 * how its latest pass ended. A host that keeps the roster between passes
 * needs it, and nothing else does.
 */
export interface CloudSessionPlugin extends SessionProviderPlugin {
  lastObservationFailure(): AdapterFailureKind | undefined;
}

/**
 * The shared half of every cloud provider: credential handling, its own
 * refresh cadence, the failure rules that decide whether a snapshot survives,
 * bounded read-only requests, and the one authenticated write. An adapter
 * supplies the provider's routes and how its reported state maps onto Luke's,
 * and reaches its provider through nothing but these.
 */
export interface CloudPass {
  run(): Effect.Effect<readonly ProviderSessionObservation[]>;
  latest(): readonly ProviderSessionObservation[];
  /**
   * How the latest `run` ended, or nothing for one that read the whole roster.
   * `latest()` answers the same either way — the previous snapshot stands
   * through a transient failure — so a caller writing the roster down has to
   * ask this to tell a roster read whole from one merely still standing.
   */
  lastFailure(): AdapterFailureKind | undefined;
  /** One authenticated write; answers what became of it, never fails. */
  write(
    apiKey: string,
    route: CloudWriteRoute,
    subject?: WriteSubject,
  ): Effect.Effect<CloudWriteOutcome>;
  credentialBoundRead: CredentialBoundRead;
  /** The credential as the caller's own action should present it, read afresh. */
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

/** What one read answered with: the record it carried, or why it did not. */
type Answered = WireRecord | AdapterFailure;

const readBody = HttpClientResponse.schemaBodyJson(WireValueSchema);

/**
 * The shared half of every cloud provider: credential handling, its own
 * refresh cadence, the failure rules that decide whether a snapshot survives,
 * bounded read-only requests over an `HttpClient` built from the adapter's own
 * `CloudFetch`, and the one authenticated write.
 */
export function cloudPass(input: CloudPassInput): CloudPass {
  const provider = input.provider;
  const baseUrl = resolveBaseUrl(input);
  const client = httpClientFromCloudFetch(input.fetch ?? defaultFetch);
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
  let lastFailure: AdapterFailureKind | undefined;
  let collectPass = 0;

  const provideClient = <Answer, Error>(
    effect: Effect.Effect<Answer, Error, HttpClient.HttpClient>,
  ): Effect.Effect<Answer, Error> => Effect.provideService(effect, HttpClient.HttpClient, client);

  /**
   * One observer must never abort the shared refresh pass, so a settings read
   * that fails is treated the same as having no credential at all — here, and
   * for the action that reads the credential again at its own moment.
   */
  const readApiKey = (): Promise<string | undefined> => input.readApiKey().catch(() => undefined);

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

  const sent = (
    apiKey: string,
    address: string,
    document: string | undefined,
  ): HttpClientRequest.HttpClientRequest =>
    HttpClientRequest.make(document === undefined ? HTTP_METHOD.GET : HTTP_METHOD.POST)(address, {
      headers: {
        ...requestHeaders,
        ...authorizationHeaders(apiKey),
      },
      ...(document === undefined
        ? undefined
        : {
            body: HttpBody.raw(JSON.stringify({ [READ_DOCUMENT_FIELD]: document }), {
              contentType: JSON_CONTENT_TYPE,
            }),
          }),
    });

  /**
   * What one answered read became: the record it carried, or the failure its
   * status or its body decided. A failure rides back as a value rather than in
   * the error channel because the cadence above reacts to a rate limit and to
   * nothing else.
   */
  const readAnswer = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<Answered> => {
    const name = provider.displayName;
    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
      return Effect.succeed(
        new AdapterFailure(ADAPTER_FAILURE.UNAUTHORIZED, `${name} rejected the configured API key`),
      );
    }
    if (response.status < OK_STATUS.FIRST || response.status >= OK_STATUS.PAST) {
      return Effect.succeed(
        new AdapterFailure(
          ADAPTER_FAILURE.TRANSIENT,
          `${name} responded with status ${response.status}`,
        ),
      );
    }
    return Effect.catchAll(
      Effect.map(readBody(response), (body) => {
        const record = wireRecord(unparsedWire(body));
        return (
          record ??
          new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, `${name} returned an unexpected response`)
        );
      }),
      () =>
        Effect.succeed(
          new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, `${name} returned an unreadable response`),
        ),
    );
  };

  /**
   * One attempt, read to whatever the answer turned out to be. The deadline
   * covers the reading as well as the request, because a body that never
   * arrives is a request that never ended: a provider that sends its headers
   * and then stalls its body has to end the same way an unanswered request
   * does. A client that could not carry the request at all, and the deadline
   * itself, are the same transient failure an aborted request was, and a rate
   * limit is the one thing that reaches the error channel, because it is the
   * one thing the cadence retries.
   */
  const readOnce = (
    apiKey: string,
    segments: readonly string[],
    query: Readonly<Record<string, string>>,
    document: string | undefined,
    timeoutMs: number,
  ): Effect.Effect<Answered, RateLimitedRead, HttpClient.HttpClient> => {
    const transient = () =>
      new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, `${provider.displayName} request failed`);
    return Effect.flatMap(
      Effect.either(HttpClient.execute(sent(apiKey, url(segments, query), document))),
      (answer): Effect.Effect<Answered, RateLimitedRead> => {
        if (answer._tag === "Left") return Effect.succeed(transient());
        if (answer.right.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
          return Effect.fail(
            new RateLimitedRead({
              retryAfter: Option.getOrNull(Headers.get(answer.right.headers, "retry-after")),
            }),
          );
        }
        return readAnswer(answer.right);
      },
    ).pipe(
      Effect.timeout(Duration.millis(timeoutMs)),
      Effect.catchTag("TimeoutException", () => Effect.succeed(transient())),
    );
  };

  const requestJson = (
    apiKey: string,
    budget: BackoffBudget,
    segments: readonly string[],
    query: Readonly<Record<string, string>> = {},
    options: Readonly<{ timeoutMs?: number; document?: string }> = {},
  ): Effect.Effect<WireRecord, AdapterFailure, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const name = provider.displayName;
      const timeoutMs = requestDeadlineMs(options.timeoutMs);
      // A read document rides as a POST because that is how its endpoint is
      // documented, not because it writes: the body carries the document and
      // nothing else, so the request can still express nothing but a read.
      const document = options.document;
      // A 429 is retried on the cadence the pass's one budget allows, each
      // attempt under its own deadline. Once that cadence stops, the pass is
      // rate limited rather than merely failed: every further read would meet
      // the same door, so the roster stops here whole as it was rather than
      // continuing as a partial one.
      const cadence = rateLimitSchedule(budget, now);
      const answered: Answered = yield* Effect.retry(
        readOnce(apiKey, segments, query, document, timeoutMs),
        cadence,
      ).pipe(
        Effect.catchTag("RateLimitedRead", () =>
          Effect.fail(new AdapterFailure(ADAPTER_FAILURE.RATE_LIMITED, `${name} is rate limiting`)),
        ),
      );
      if (answered instanceof AdapterFailure) return yield* Effect.fail(answered);
      return answered;
    });

  const assertPassCurrent = (pass: number): Effect.Effect<void, AdapterFailure> =>
    pass === collectPass
      ? Effect.void
      : Effect.fail(
          new AdapterFailure(
            ADAPTER_FAILURE.TRANSIENT,
            `${provider.displayName} pass was superseded`,
          ),
        );

  /**
   * Binds one pass's requests to the credential it started with. A superseded
   * pass fails instead of issuing another request with a replaced key, and
   * whatever a request already read is discarded before an adapter can cache
   * it over state that belongs to the new credential.
   */
  const requestForPass = (pass: number, apiKey: string): CloudRequest => {
    const budget = backoffBudget();
    return (segments, query, options) =>
      Effect.gen(function* () {
        yield* assertPassCurrent(pass);
        const body = yield* provideClient(requestJson(apiKey, budget, segments, query, options));
        yield* assertPassCurrent(pass);
        return body;
      });
  };

  /**
   * The one authenticated write. It shares the read path's timeout and its
   * refusal to echo anything the provider said into an error a user sees, and
   * it answers with what became of the request rather than failing: a write is
   * a user's own action, so every outcome has to land back on the row it left.
   * The subject is what the route acts on, so a refusal names the thing that
   * actually went missing. What the provider answered with rides along for the
   * adapter that needs it — a creation response names the thing it created —
   * and travels no further.
   */
  const writeAttempt = (
    apiKey: string,
    route: CloudWriteRoute,
    subject: WriteSubject,
  ): Effect.Effect<CloudWriteOutcome, HttpClientError.HttpClientError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const name = provider.displayName;
      const requested = HttpClientRequest.post(url(route.segments, {}, route.action), {
        // The same layering as a read: the provider's own headers first, the
        // credential after them so no override can replace it.
        headers: {
          ...requestHeaders,
          ...authorizationHeaders(apiKey),
        },
        // An endpoint that documents an empty request gets exactly that, not
        // an empty JSON object it never asked for.
        ...(route.body === undefined
          ? undefined
          : {
              body: HttpBody.raw(JSON.stringify(route.body), { contentType: JSON_CONTENT_TYPE }),
            }),
      });
      const response = yield* HttpClient.execute(requested);
      if (response.status >= OK_STATUS.FIRST && response.status < OK_STATUS.PAST) {
        // A write that landed changes what the session is doing, so the
        // refresh that follows must actually ask: served from the cache inside
        // the minimum interval, the row would keep offering what the provider
        // has already taken.
        lastAttemptAt = Number.NEGATIVE_INFINITY;
        // An unreadable body is not a failed write: the provider already said
        // yes, so only a follow-up that needed the body has anything to miss.
        const body = yield* Effect.option(readBody(response));
        const record = Option.isSome(body) ? wireRecord(unparsedWire(body.value)) : undefined;
        return {
          outcome: { status: ACTION_RESULT_STATUS.ACCEPTED },
          ...(record === undefined ? undefined : { body: record }),
        };
      }
      if (
        response.status === HTTP_STATUS.UNAUTHORIZED ||
        response.status === HTTP_STATUS.FORBIDDEN
      ) {
        return {
          outcome: {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: `${name} rejected the configured API key.`,
          },
        };
      }
      if (response.status === HTTP_STATUS.NOT_FOUND) {
        return {
          outcome: {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: `${name} no longer has this ${subject}.`,
          },
        };
      }
      if (response.status === HTTP_STATUS.CONFLICT) {
        return {
          outcome: {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: `${name} says this ${subject} has moved on since Luke last looked.`,
          },
        };
      }
      // Any other status is an answer that says nothing certain about the
      // action — a gateway that gave up may stand in front of a write that
      // finished — so this hedges the way a failed request does, and the
      // refresh that follows must actually ask rather than keep advertising
      // what the provider may have already taken.
      lastAttemptAt = Number.NEGATIVE_INFINITY;
      return {
        outcome: {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: `${name} answered with status ${response.status}, so the request may not have landed.`,
        },
      };
    });

  /**
   * The write under the route's own deadline, which covers reading the answer
   * as well as sending it: a provider that sends its headers and then stalls
   * its body must not hold an action open for ever. A request that could not
   * be carried and one the deadline cut short end the same way, because
   * neither can say which side of the wire failed: a connection that never
   * opened sent nothing, but a deadline or a reset while the answer was coming
   * back leaves a request the provider may have already acted on. So the
   * refusal hedges rather than claims, and the refresh that follows must
   * actually ask, so a write that did land is reconciled against the provider
   * instead of the cache still advertising it.
   */
  const writeOnce = (
    apiKey: string,
    route: CloudWriteRoute,
    subject: WriteSubject,
  ): Effect.Effect<CloudWriteOutcome, never, HttpClient.HttpClient> =>
    Effect.catchAll(
      Effect.timeout(
        writeAttempt(apiKey, route, subject),
        Duration.millis(requestDeadlineMs(route.timeoutMs)),
      ),
      () =>
        Effect.sync(() => {
          lastAttemptAt = Number.NEGATIVE_INFINITY;
          return {
            outcome: {
              status: ACTION_RESULT_STATUS.REJECTED,
              reason: `${provider.displayName} did not answer, so the request may not have landed.`,
            },
          };
        }),
    );

  const run: Effect.Effect<readonly ProviderSessionObservation[]> = Effect.gen(function* () {
    const apiKey = yield* Effect.promise(readApiKey);
    if (!apiKey) {
      credential = undefined;
      forgetObservedState();
      lastFailure = ADAPTER_FAILURE.UNAVAILABLE;
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
    return yield* Effect.catchAllCause(
      Effect.map(input.collect(requestForPass(pass, apiKey), attemptedAt), (collected) => {
        if (pass === collectPass) {
          observations = cloudObservations(collected);
          lastFailure = undefined;
        }
        return observations;
      }),
      (cause) => {
        // A rejected credential clears observed state; a transient network or
        // server failure, or a rate limit that outlasted its backoff, keeps
        // the previous snapshot until the next attempt. A superseded pass
        // reports on a credential that no longer stands, so its rejection
        // says nothing about the current one.
        if (pass !== collectPass) return Effect.succeed(observations);
        const failure = Cause.failureOption(cause);
        if (Option.isSome(failure)) {
          if (clearsObservedState(failure.value.failure)) forgetObservedState();
          lastFailure = failure.value.failure;
          return Effect.succeed(observations);
        }
        // Anything else is a bug in this pass — a TypeError thrown by an
        // adapter's parsing is not a network blip, and must not keep serving
        // the stale snapshot with no log, counter, or hook.
        const squashed = Cause.squash(cause);
        input.onDiagnostic?.(
          ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE,
          squashed instanceof Error ? squashed : new Error(String(squashed)),
        );
        // SAFETY: `failureOption` answered `None` above, so this cause carries
        // no typed `AdapterFailure` — only a defect or an interruption — and
        // rethrowing it can never join the typed failure channel below.
        return Effect.failCause(cause as Cause.Cause<never>);
      },
    );
  });

  return {
    run: () => run,

    latest: () => observations,

    lastFailure: () => lastFailure,

    readApiKey,

    reportDiagnostic(kind, error) {
      input.onDiagnostic?.(kind, error);
    },

    write: (apiKey, route, subject = WRITE_SUBJECT.SESSION) =>
      provideClient(writeOnce(apiKey, route, subject)),

    credentialBoundRead: (segments, query, options, apply) =>
      Effect.gen(function* () {
        // A read on a pass that has not run — the hosted brain reads a chat
        // against the roster its stored snapshot holds — takes the credential
        // the way a pass would, so the read is bound to it from here on.
        if (credential === undefined) credential = yield* Effect.promise(readApiKey);
        const epoch = credentialEpoch;
        const apiKey = credential;
        if (!apiKey) {
          return yield* Effect.fail(
            new AdapterFailure(
              ADAPTER_FAILURE.TRANSIENT,
              `${provider.displayName} has no credential to read with`,
            ),
          );
        }
        const body = yield* provideClient(
          requestJson(apiKey, backoffBudget(), segments, query, options),
        );
        if (epoch !== credentialEpoch) {
          return yield* Effect.fail(
            new AdapterFailure(
              ADAPTER_FAILURE.TRANSIENT,
              `${provider.displayName} read outlived its credential`,
            ),
          );
        }
        apply(body);
      }),
  };
}
