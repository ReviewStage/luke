import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import {
  type CloudFetch,
  HTTP_STATUS,
  type HttpMethod,
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
  WireValueSchema,
  withoutTrailingSlash,
} from "@sidecar/wire";
import { layerFromCloudFetch, webResponseFromClientResponse } from "@sidecar/wire/effect";
import { Cause, Data, Duration, Effect, type Schema as EffectSchema, Exit } from "effect";
import type { AccountToken } from "./account-token.js";

const ACCOUNT_CALL_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

/**
 * The name a deadline ends a request under. The deadline is the runtime's own
 * timeout rather than an `AbortSignal.timeout`, and this is the name that
 * signal's reason carried, kept so a caller reporting an end reports the same
 * word it always did.
 */
const DEADLINE_ERROR_NAME = "TimeoutError";

/** The content type a serialized body names, the one type this call sends. */
const JSON_CONTENT_TYPE = "application/json";

/**
 * What authorizes one call, and what may be done about a refusal. Three
 * members rather than a token, because the three questions a refused call
 * asks — what header to send, who can renew it, and who it answers for — are
 * answered by three different owners.
 */
export interface CallCredential {
  /**
   * The header one attempt carries. A credential with no `authorization` at
   * all is an endpoint that takes no identity, so an attempt without a header
   * is its own answer; a credential that has one and reads nothing is a call
   * that cannot be made.
   */
  authorization?: () => Promise<string | undefined>;
  /** Asks whoever owns the credential to renew it; one with nothing to renew omits this. */
  renew?: () => Promise<void>;
  /**
   * Who the credential answers for, as an opaque identity. Read before an
   * attempt and again before its one retry, because the retry re-reads the
   * credential: a sign-out and sign-in between the two must read as the
   * caller's account gone, never as a fresh bearer to carry the old account's
   * payload under.
   */
  holder?: (() => Promise<string | undefined>) | undefined;
}

/** The ends a call reaches before any status is read. */
export const CALL_FAULT = {
  NO_CREDENTIAL: "no-credential",
  HOLDER_CHANGED: "holder-changed",
  NETWORK: "network",
} as const;

type CallFault = (typeof CALL_FAULT)[keyof typeof CALL_FAULT];

/** The service answered; every status, including a refusal, is the caller's to read. */
export interface CallResponse {
  response: Response;
}

export interface CallFailure {
  fault: CallFault;
  /**
   * The kind of error a network fault ended with, never its words, which
   * could carry a credential.
   */
  errorName?: string;
}

export type CallAnswer = CallResponse | CallFailure;

/** Whether the service answered at all, as distinct from the call never reaching it. */
export function callAnswered(answer: CallAnswer): answer is CallResponse {
  return "response" in answer;
}

/** One request, as the build fixes it: nothing here is composed from what a service answered. */
interface CallRequest {
  method: HttpMethod;
  /** The path under the call's own base address. */
  path: string;
  /** The serialized body, which is also what names the request's content type. */
  body?: string | undefined;
  /** Extra headers the build fixes; the authorization and content type are the call's own. */
  headers?: Record<string, string> | undefined;
  /**
   * The caller's own cancellation. An Effect caller has interruption instead
   * and hands none: the deadline and the cancellation are both the fiber's,
   * and only {@link createAccountCall}'s promise reads this.
   */
  signal?: AbortSignal | undefined;
}

export interface AccountCallOptions {
  /** The service origin; any trailing separator is trimmed once. */
  baseUrl: string;
  credential: CallCredential;
  requestTimeoutMs?: number | undefined;
}

/**
 * @deprecated The `fetch` seam a caller not yet holding an `HttpClient` hands
 * over; deleted with `CloudFetch` in P12-04.
 */
export interface AccountFetchCallOptions extends AccountCallOptions {
  fetch?: CloudFetch | undefined;
}

/**
 * One call to Luke's own service, however it is authorized: the base address
 * trimmed once, the credential read fresh for every attempt, the header
 * written once, a request the ambient `HttpClient` carries under the call's
 * own deadline, a client that failed read as a network fault by the error's
 * kind alone, and one reading of a 401 — renew the credential and retry
 * exactly once, only on a credential that actually changed and only while it
 * still answers for the same holder. Nothing here retries a status other than
 * that one: a rate limit, a server error, and a refusal are each the caller's
 * to read.
 */
export interface AccountCallEffects {
  /**
   * The deadline in force, for a caller that reports which deadline its
   * requests are under.
   */
  readonly requestTimeoutMs: number;
  /** The address a path is asked at, for a caller that reports its endpoint. */
  address(path: string): string;
  send(request: CallRequest): Effect.Effect<CallAnswer, never, HttpClient.HttpClient>;
  /**
   * The whole of an answer a caller only wants read: anything but a body the
   * answer's own schema admitted — a fault, a refusal, a body that is not
   * JSON — is no answer.
   */
  ask<Answer, Encoded>(
    request: CallRequest,
    answer: EffectSchema.Schema<Answer, Encoded>,
  ): Effect.Effect<Answer | undefined, never, HttpClient.HttpClient>;
  /**
   * The same reading, through a caller's own reader rather than the schema
   * beneath it.
   *
   * @deprecated Kept while a client here still holds a `Schema<Value>` facade
   * rather than the Effect schema {@link AccountCallEffects.ask} decodes with;
   * deleted with the last reader-taking client of this package.
   */
  read<Answer>(
    request: CallRequest,
    read: (payload: UnparsedWireValue) => Answer | undefined,
  ): Effect.Effect<Answer | undefined, never, HttpClient.HttpClient>;
}

/** The promise-answering face of {@link AccountCallEffects}. */
export interface AccountCall {
  readonly requestTimeoutMs: number;
  address(path: string): string;
  send(request: CallRequest): Promise<CallAnswer>;
  ask<Answer>(
    request: CallRequest,
    read: (payload: UnparsedWireValue) => Answer | undefined,
  ): Promise<Answer | undefined>;
}

interface Identity {
  holder: string | undefined;
  authorization: string | undefined;
}

/**
 * What a request ended with before any status was read, as the one failure the
 * attempt below raises: a client that could not carry it, a body that would
 * not decode, or the deadline. The name is the error's kind and never its
 * words, which could carry a credential.
 */
class CallTransportError extends Data.TaggedError("CallTransportError")<{
  readonly errorName: string | undefined;
}> {}

/** How a caller reads one answer of the service, whatever its status. */
type Reader<Answer> = (
  response: HttpClientResponse.HttpClientResponse,
) => Effect.Effect<Answer, CallTransportError>;

/** One attempt's end: what the caller wanted read, or a 401 not yet decided about. */
type Attempted<Answer> = { readonly answer: Answer } | Refused;

/** A request that reached no status at all, as the failure it answers with. */
type CallFailed = { readonly failure: CallFailure };

/** What the call as a whole ended with, before a caller words it. */
type Answered<Answer> = { readonly answer: Answer } | CallFailed;

/** A 401 the retry has not been decided about yet. */
type Refused = { readonly refusal: HttpClientResponse.HttpClientResponse };

/**
 * The range a `Response` calls `ok`, restated because what is read here is a
 * status rather than a `Response`.
 */
const OK_STATUS = {
  FIRST: 200,
  PAST: 300,
} as const;

function answeredOk(status: number): boolean {
  return status >= OK_STATUS.FIRST && status < OK_STATUS.PAST;
}

function errorName(cause: unknown): string | undefined {
  return cause instanceof Error ? cause.name : undefined;
}

/** The end a caller's own cancellation names, as their signal's reason named it. */
function cancelled(signal: AbortSignal): CallFailure {
  const name = errorName(signal.reason);
  return {
    fault: CALL_FAULT.NETWORK,
    ...(name === undefined ? undefined : { errorName: name }),
  };
}

function transportFailure(error: CallTransportError): CallFailure {
  return {
    fault: CALL_FAULT.NETWORK,
    ...(error.errorName === undefined ? undefined : { errorName: error.errorName }),
  };
}

function readCredential(
  read: (() => Promise<string | undefined>) | undefined,
): Effect.Effect<string | undefined, Cause.UnknownException> {
  return read === undefined ? Effect.succeed(undefined) : Effect.tryPromise(() => read());
}

/** The call as effects over the ambient `HttpClient`. */
export function accountCall(options: AccountCallOptions): AccountCallEffects {
  const baseUrl = text(options.baseUrl);
  if (!baseUrl) throw new Error("A call's base URL must not be empty");
  const address = withoutTrailingSlash(baseUrl);
  const credential = options.credential;
  const requestTimeoutMs = positiveInteger(
    options.requestTimeoutMs,
    ACCOUNT_CALL_DEFAULTS.REQUEST_TIMEOUT_MS,
  );
  const deadline = Duration.millis(requestTimeoutMs);

  function withinDeadline<Answer, Requirements>(
    effect: Effect.Effect<Answer, CallTransportError, Requirements>,
  ): Effect.Effect<Answer, CallTransportError, Requirements> {
    return effect.pipe(
      Effect.timeoutFail({
        duration: deadline,
        onTimeout: () => new CallTransportError({ errorName: DEADLINE_ERROR_NAME }),
      }),
    );
  }

  function httpRequest(
    request: CallRequest,
    authorization: string | undefined,
  ): HttpClientRequest.HttpClientRequest {
    return HttpClientRequest.make(request.method)(`${address}${request.path}`, {
      headers: {
        ...request.headers,
        ...(authorization === undefined ? undefined : { authorization }),
      },
      // The body a caller hands over is already the serialized text the
      // service reads, so it travels as it came: `HttpBody.text` would encode
      // it here, and the encoding is the client's own business.
      ...(request.body === undefined
        ? undefined
        : { body: HttpBody.raw(request.body, { contentType: JSON_CONTENT_TYPE }) }),
    });
  }

  function requested(
    request: CallRequest,
    authorization: string | undefined,
  ): Effect.Effect<
    HttpClientResponse.HttpClientResponse,
    CallTransportError,
    HttpClient.HttpClient
  > {
    return Effect.catchAll(HttpClient.execute(httpRequest(request, authorization)), (error) =>
      Effect.fail(new CallTransportError({ errorName: errorName(error.cause) })),
    );
  }

  /**
   * One attempt, read to whatever the caller wanted of the answer. The
   * deadline covers the reading as well as the request, because a body that
   * never arrives is a request that never ended.
   */
  function attempt<Answer>(
    request: CallRequest,
    authorization: string | undefined,
    read: Reader<Answer>,
  ): Effect.Effect<Answer, CallTransportError, HttpClient.HttpClient> {
    return withinDeadline(Effect.flatMap(requested(request, authorization), read));
  }

  /**
   * The first attempt, whose 401 is handed back unread because whether it
   * stands is decided above; the retry takes the reader unconditionally, so a
   * second refusal is read like any other status.
   */
  function attemptDecidingRefusal<Answer>(
    request: CallRequest,
    authorization: string | undefined,
    read: Reader<Answer>,
  ): Effect.Effect<Attempted<Answer>, CallTransportError, HttpClient.HttpClient> {
    return withinDeadline(
      Effect.flatMap(
        requested(request, authorization),
        (response): Effect.Effect<Attempted<Answer>, CallTransportError> =>
          response.status === HTTP_STATUS.UNAUTHORIZED
            ? Effect.succeed({ refusal: response })
            : Effect.map(read(response), (answer) => ({ answer })),
      ),
    );
  }

  /**
   * Who the credential answers for and what one attempt carries, read
   * together. A credential that cannot be read at all — a store that failed,
   * not an account that is absent — reads as nothing rather than failing,
   * because a caller that took work off a queue to send it has to be able to
   * put it back.
   */
  const identify: Effect.Effect<Identity | undefined> = Effect.gen(function* () {
    const holder = yield* readCredential(credential.holder);
    const authorization = yield* readCredential(credential.authorization);
    if (credential.authorization && authorization === undefined) return undefined;
    return { holder, authorization };
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

  const renew: Effect.Effect<void> = Effect.ignore(
    Effect.tryPromise(() => credential.renew?.() ?? Promise.resolve()),
  );

  /**
   * The answer, read as the caller asked, under the one reading of a 401:
   * renew the credential and retry exactly once, only on a credential that
   * actually changed and only while it still answers for the same holder. A
   * renewal that itself failed, or that produced the same credential, leaves
   * the refusal standing, because retrying it would only repeat the no.
   */
  function answered<Answer>(
    request: CallRequest,
    read: Reader<Answer>,
  ): Effect.Effect<Answered<Answer>, never, HttpClient.HttpClient> {
    const settled = <Read>(
      effect: Effect.Effect<Read, CallTransportError, HttpClient.HttpClient>,
    ): Effect.Effect<{ readonly read: Read } | CallFailed, never, HttpClient.HttpClient> =>
      Effect.map(Effect.either(effect), (end) =>
        end._tag === "Left" ? { failure: transportFailure(end.left) } : { read: end.right },
      );

    return Effect.gen(function* () {
      const identity = yield* identify;
      if (!identity) return { failure: { fault: CALL_FAULT.NO_CREDENTIAL } };

      const first = yield* settled(attemptDecidingRefusal(request, identity.authorization, read));
      if (!("read" in first)) return first;
      if (!("refusal" in first.read)) return first.read;

      yield* renew;
      const renewal = yield* identify;
      if (!renewal || renewal.authorization === identity.authorization) {
        const standing = yield* settled(withinDeadline(read(first.read.refusal)));
        return "read" in standing ? { answer: standing.read } : standing;
      }
      if (renewal.holder !== identity.holder) {
        return { failure: { fault: CALL_FAULT.HOLDER_CHANGED } };
      }
      const retried = yield* settled(attempt(request, renewal.authorization, read));
      return "read" in retried ? { answer: retried.read } : retried;
    });
  }

  const responseReader: Reader<CallResponse> = (response) =>
    Effect.map(webResponseFromClientResponse(response), (web) => ({ response: web }));

  function reading<Answer>(
    request: CallRequest,
    read: Reader<Answer | undefined>,
  ): Effect.Effect<Answer | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      answered<Answer | undefined>(request, (response) =>
        answeredOk(response.status) ? read(response) : Effect.succeed(undefined),
      ),
      (end) => ("answer" in end ? end.answer : undefined),
    );
  }

  return {
    requestTimeoutMs,
    address: (path) => `${address}${path}`,
    send: (request) =>
      Effect.map(answered(request, responseReader), (end) =>
        "answer" in end ? end.answer : end.failure,
      ),
    ask: (request, answer) =>
      reading(request, (response) =>
        Effect.catchAll(HttpClientResponse.schemaBodyJson(answer)(response), () =>
          Effect.succeed(undefined),
        ),
      ),
    read: (request, read) =>
      reading(request, (response) =>
        Effect.catchAll(
          Effect.map(HttpClientResponse.schemaBodyJson(WireValueSchema)(response), (payload) =>
            read(unparsedWire(payload)),
          ),
          () => Effect.succeed(undefined),
        ),
      ),
  };
}

/**
 * The same call as a promise, over the caller's own `fetch`.
 *
 * @deprecated Superseded by {@link accountCall}, which takes the ambient
 * `HttpClient` and answers effects; deleted with `CloudFetch` in P12-04.
 */
export function createAccountCall(options: AccountFetchCallOptions): AccountCall {
  const call = accountCall(options);
  const client = layerFromCloudFetch(options.fetch ?? ((input, init) => fetch(input, init)));

  async function run<Answer>(
    effect: Effect.Effect<Answer, never, HttpClient.HttpClient>,
    fallback: (signal: AbortSignal) => Answer,
    signal: AbortSignal | undefined,
  ): Promise<Answer> {
    const exit = await Effect.runPromiseExit(Effect.provide(effect, client), {
      ...(signal === undefined ? undefined : { signal }),
    });
    if (Exit.isSuccess(exit)) return exit.value;
    // The caller's own cancellation is the run's interruption here, so the end
    // it names is the reason their signal carried, exactly as an aborted fetch
    // named it.
    if (signal?.aborted === true && Cause.isInterruptedOnly(exit.cause)) return fallback(signal);
    throw Cause.squash(exit.cause);
  }

  return {
    requestTimeoutMs: call.requestTimeoutMs,
    address: call.address,
    send: (request) => run(call.send(request), cancelled, request.signal),
    ask: (request, read) => run(call.read(request, read), () => undefined, request.signal),
  };
}

/** The signed-in account's bearer, read fresh for every attempt and renewed by the account lifecycle. */
export function accountBearer(token: AccountToken): CallCredential {
  return {
    authorization: async () => {
      const accessToken = await token.readAccessToken();
      return accessToken ? bearer(accessToken) : undefined;
    },
    renew: token.refreshAccount,
    holder: token.readAccountKey,
  };
}

/** A credential the build or the developer fixed: one header, one attempt, nothing to renew. */
export function fixedBearer(credential: string): CallCredential {
  const authorization = bearer(credential);
  return { authorization: () => Promise.resolve(authorization) };
}

/** An endpoint that takes no identity: nothing to send, nothing to renew, nobody to answer for. */
export const NO_CREDENTIAL: CallCredential = {};

function bearer(credential: string): string {
  return `Bearer ${credential}`;
}
