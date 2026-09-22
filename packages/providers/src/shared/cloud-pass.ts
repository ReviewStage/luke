import { catchAllButInterrupt, unlessInterrupted } from "@sidecar/runtime/effect";
import {
  ACTION_RESULT_STATUS,
  type ProviderActionResult,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  type SessionProvider,
  type SessionProviderPlugin,
} from "@sidecar/session";
import {
  HTTP_STATUS,
  unparsedWire,
  type WireRecord,
  WireValueSchema,
  wireRecord,
} from "@sidecar/wire";
import { Cause, Clock, Duration, Effect, type Layer, Option, Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import {
  ADAPTER_FAILURE,
  AdapterFailure,
  type AdapterFailureKind,
  clearsObservedState,
} from "./adapter-failure.js";
import {
  type BackoffBudget,
  backoffBudget,
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
function authorizationHeaders(apiKey: Redacted.Redacted) {
  // The one place a credential is revealed: onto the header the provider reads.
  return { Authorization: `Bearer ${Redacted.value(apiKey)}` };
}

const DEFAULT_REQUEST_HEADERS = {
  Accept: "application/json",
};

/**
 * The one body key a POSTed read document rides under. Conductor's transcripts
 * view names it `query`, and a provider that names it something else is asking
 * for its own client rather than an option here.
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

export interface CloudPassInput {
  provider: SessionProvider;
  defaultBaseUrl: string;
  baseUrlEnvironmentVariable?: string;
  /** Resolves the credential at observation time so a settings change applies immediately; sealed until the header is written. */
  readApiKey: () => Effect.Effect<Redacted.Redacted | undefined>;
  baseUrl?: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
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
 * The shared half of every cloud provider: credential handling, the failure
 * rules that decide whether a snapshot survives, bounded read-only requests,
 * and the one authenticated write. An adapter supplies the provider's routes
 * and how its reported state maps onto Luke's, and reaches its provider
 * through nothing but these.
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
    apiKey: Redacted.Redacted,
    route: CloudWriteRoute,
    subject?: WriteSubject,
  ): Effect.Effect<CloudWriteOutcome>;
  /** One authenticated read outside a pass, under the credential read afresh for it. */
  read(
    segments: readonly string[],
    query?: Readonly<Record<string, string>>,
    options?: Readonly<{ timeoutMs?: number; document?: string }>,
  ): Effect.Effect<WireRecord, AdapterFailure>;
  /** The credential as the caller's own action should present it, read afresh and still sealed. */
  readApiKey(): Effect.Effect<Redacted.Redacted | undefined>;
}

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
 * The shared half of every cloud provider: credential handling, the failure
 * rules that decide whether a snapshot survives, bounded read-only requests
 * over the ambient `HttpClient`, and the one authenticated write.
 */
export function cloudPass(input: CloudPassInput): CloudPass {
  const provider = input.provider;
  const baseUrl = resolveBaseUrl(input);
  const client = input.httpClient ?? FetchHttpClient.layer;
  let observations: readonly ProviderSessionObservation[] = [];
  let lastFailure: AdapterFailureKind | undefined;

  const provideClient = <Answer, Failure extends AdapterFailure>(
    effect: Effect.Effect<Answer, Failure, HttpClient.HttpClient>,
  ): Effect.Effect<Answer, Failure> => Effect.provide(effect, client);

  /**
   * One observer must never abort the shared refresh pass, so a settings read
   * that fails is treated the same as having no credential at all — here, and
   * for the action that reads the credential again at its own moment.
   */
  const readApiKey = (): Effect.Effect<Redacted.Redacted | undefined> =>
    // A caller ending the fiber is not a settings read that failed, so an
    // interruption is re-raised rather than read as a missing credential.
    catchAllButInterrupt(input.readApiKey(), () => Effect.succeed(undefined));

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
    apiKey: Redacted.Redacted,
    address: string,
    document: string | undefined,
  ): HttpClientRequest.HttpClientRequest =>
    HttpClientRequest.make(document === undefined ? HTTP_METHOD.GET : HTTP_METHOD.POST)(address, {
      headers: {
        ...DEFAULT_REQUEST_HEADERS,
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
        new AdapterFailure({
          failure: ADAPTER_FAILURE.UNAUTHORIZED,
          message: `${name} rejected the configured API key`,
        }),
      );
    }
    if (response.status < OK_STATUS.FIRST || response.status >= OK_STATUS.PAST) {
      return Effect.succeed(
        new AdapterFailure({
          failure: ADAPTER_FAILURE.TRANSIENT,
          message: `${name} responded with status ${response.status}`,
        }),
      );
    }
    return Effect.catch(
      Effect.map(readBody(response), (body) => {
        const record = wireRecord(unparsedWire(body));
        return (
          record ??
          new AdapterFailure({
            failure: ADAPTER_FAILURE.TRANSIENT,
            message: `${name} returned an unexpected response`,
          })
        );
      }),
      () =>
        Effect.succeed(
          new AdapterFailure({
            failure: ADAPTER_FAILURE.TRANSIENT,
            message: `${name} returned an unreadable response`,
          }),
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
    apiKey: Redacted.Redacted,
    segments: readonly string[],
    query: Readonly<Record<string, string>>,
    document: string | undefined,
    timeoutMs: number,
  ): Effect.Effect<Answered, RateLimitedRead, HttpClient.HttpClient> => {
    const transient = () =>
      new AdapterFailure({
        failure: ADAPTER_FAILURE.TRANSIENT,
        message: `${provider.displayName} request failed`,
      });
    return Effect.flatMap(
      Effect.result(HttpClient.execute(sent(apiKey, url(segments, query), document))),
      (answer): Effect.Effect<Answered, RateLimitedRead> => {
        if (answer._tag === "Failure") return Effect.succeed(transient());
        if (answer.success.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
          return Effect.fail(
            new RateLimitedRead({
              retryAfter: Option.getOrNull(Headers.get(answer.success.headers, "retry-after")),
            }),
          );
        }
        return readAnswer(answer.success);
      },
    ).pipe(
      Effect.timeout(Duration.millis(timeoutMs)),
      Effect.catchTag("TimeoutError", () => Effect.succeed(transient())),
    );
  };

  const requestJson = /* @__PURE__ */ Effect.fn("providers/requestJson")(function* (
    apiKey: Redacted.Redacted,
    budget: BackoffBudget,
    segments: readonly string[],
    query: Readonly<Record<string, string>> = {},
    options: Readonly<{ timeoutMs?: number; document?: string }> = {},
  ): Effect.fn.Return<WireRecord, AdapterFailure, HttpClient.HttpClient> {
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
    const cadence = rateLimitSchedule(budget);
    const answered: Answered = yield* Effect.retry(
      readOnce(apiKey, segments, query, document, timeoutMs),
      cadence,
    ).pipe(
      Effect.catchTag("RateLimitedRead", () =>
        Effect.fail(
          new AdapterFailure({
            failure: ADAPTER_FAILURE.RATE_LIMITED,
            message: `${name} is rate limiting`,
          }),
        ),
      ),
    );
    if (answered instanceof AdapterFailure) return yield* Effect.fail(answered);
    return answered;
  });

  /** One pass's requests, under the credential it started with and one shared backoff budget. */
  const requestForPass = (apiKey: Redacted.Redacted): CloudRequest => {
    const budget = backoffBudget();
    return (segments, query, options) =>
      provideClient(requestJson(apiKey, budget, segments, query, options));
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
  const writeAttempt = /* @__PURE__ */ Effect.fn("providers/writeAttempt")(function* (
    apiKey: Redacted.Redacted,
    route: CloudWriteRoute,
    subject: WriteSubject,
  ): Effect.fn.Return<CloudWriteOutcome, HttpClientError.HttpClientError, HttpClient.HttpClient> {
    const name = provider.displayName;
    const requested = HttpClientRequest.post(url(route.segments, {}, route.action), {
      // The same layering as a read: the shared headers first, the credential
      // after them so no header of the route's can replace it.
      headers: {
        ...DEFAULT_REQUEST_HEADERS,
        ...authorizationHeaders(apiKey),
      },
      // An endpoint that documents an empty request gets exactly that, not
      // an empty JSON object it never asked for.
      ...(route.body === undefined
        ? undefined
        : {
            body: HttpBody.raw(JSON.stringify(route.body), {
              contentType: JSON_CONTENT_TYPE,
            }),
          }),
    });
    const response = yield* HttpClient.execute(requested);
    if (response.status >= OK_STATUS.FIRST && response.status < OK_STATUS.PAST) {
      // An unreadable body is not a failed write: the provider already said
      // yes, so only a follow-up that needed the body has anything to miss.
      const body = yield* Effect.option(readBody(response));
      const record = Option.isSome(body) ? wireRecord(unparsedWire(body.value)) : undefined;
      return {
        outcome: { status: ACTION_RESULT_STATUS.ACCEPTED },
        ...(record === undefined ? undefined : { body: record }),
      };
    }
    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
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
    // finished — so this hedges the way a failed request does.
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
   * refusal hedges rather than claims.
   */
  const writeOnce = (
    apiKey: Redacted.Redacted,
    route: CloudWriteRoute,
    subject: WriteSubject,
  ): Effect.Effect<CloudWriteOutcome, never, HttpClient.HttpClient> =>
    Effect.catch(
      Effect.timeout(
        writeAttempt(apiKey, route, subject),
        Duration.millis(requestDeadlineMs(route.timeoutMs)),
      ),
      () =>
        Effect.succeed({
          outcome: {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: `${provider.displayName} did not answer, so the request may not have landed.`,
          },
        }),
    );

  const run: Effect.Effect<readonly ProviderSessionObservation[]> = Effect.gen(function* () {
    const apiKey = yield* readApiKey();
    if (!apiKey) {
      observations = [];
      lastFailure = ADAPTER_FAILURE.UNAVAILABLE;
      return observations;
    }

    const attemptedAt = yield* Clock.currentTimeMillis;
    return yield* Effect.catchCause(
      Effect.map(input.collect(requestForPass(apiKey), attemptedAt), (collected) => {
        observations = cloudObservations(collected);
        lastFailure = undefined;
        return observations;
      }),
      (cause) => {
        // A rejected credential clears observed state; a transient network or
        // server failure, or a rate limit that outlasted its backoff, keeps
        // the previous snapshot until the next attempt. A caller ending the
        // pass is neither and is re-raised as it came, below.
        const failure = Cause.findErrorOption(cause);
        if (Option.isSome(failure)) {
          if (clearsObservedState(failure.value.failure)) observations = [];
          lastFailure = failure.value.failure;
          return Effect.succeed(observations);
        }
        // Anything else is a bug in this pass — a TypeError thrown by an
        // adapter's parsing is not a network blip, and must not keep serving
        // the stale snapshot as if the pass had run.
        return unlessInterrupted(cause, (other) =>
          // SAFETY: `findErrorOption` answered `None` above, so this cause carries
          // no typed `AdapterFailure` — only a defect — and rethrowing it can never
          // join the typed failure channel below.
          Effect.failCause(other as Cause.Cause<never>),
        );
      },
    );
  });

  return {
    run: () => run,

    latest: () => observations,

    lastFailure: () => lastFailure,

    readApiKey,

    write: (apiKey, route, subject = WRITE_SUBJECT.SESSION) =>
      provideClient(writeOnce(apiKey, route, subject)),

    read: (segments, query, options) =>
      Effect.gen(function* () {
        // A read outside a pass — the hosted brain reads a chat against the
        // roster its stored snapshot holds — takes the credential the way a
        // pass would, read afresh at its own moment.
        const apiKey = yield* readApiKey();
        if (!apiKey) {
          return yield* Effect.fail(
            new AdapterFailure({
              failure: ADAPTER_FAILURE.TRANSIENT,
              message: `${provider.displayName} has no credential to read with`,
            }),
          );
        }
        return yield* provideClient(requestJson(apiKey, backoffBudget(), segments, query, options));
      }),
  };
}
