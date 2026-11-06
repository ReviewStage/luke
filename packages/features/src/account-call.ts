import {
  HTTP_STATUS,
  type HttpMethod,
  positiveInteger,
  text,
  type WireBoundaryInput,
  withoutTrailingSlash,
} from "@repo/wire";
import { webResponseFromClientResponse } from "@repo/wire/effect";
import {
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  type Schema as EffectSchema,
  Option,
  Result,
  SubscriptionRef,
} from "effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { AccountRefreshFailed, AccountSessionToken, AccountToken } from "./account-token.js";

const ACCOUNT_CALL_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

export const DEADLINE_ERROR_NAME = "TimeoutError";

const JSON_CONTENT_TYPE = "application/json";

const SILENCE_BEFORE_UNREACHABLE = Duration.seconds(45);

export interface CallCredential {
  authorization?: () => Effect.Effect<string | undefined>;
  renew?: () => Effect.Effect<void, AccountRefreshFailed>;
  holder?: (() => Effect.Effect<string | undefined>) | undefined;
  resolve?: (() => Effect.Effect<CallCredential>) | undefined;
}

export const CALL_FAULT = {
  NO_CREDENTIAL: "no-credential",
  HOLDER_CHANGED: "holder-changed",
  NETWORK: "network",
} as const;

type CallFault = (typeof CALL_FAULT)[keyof typeof CALL_FAULT];

interface CallResponse {
  response: Response;
}

interface CallFailure {
  fault: CallFault;
  errorName?: string;
}

export type CallAnswer = CallResponse | CallFailure;

export interface ServiceReachState {
  readonly reachable: boolean;
  readonly answeredAt: number;
}

export class ServiceReach extends Context.Service<
  ServiceReach,
  SubscriptionRef.SubscriptionRef<ServiceReachState>
>()("@repo/features/ServiceReach") {}

export function callAnswered(answer: CallAnswer): answer is CallResponse {
  return "response" in answer;
}

export function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

export interface CallRequest {
  method: HttpMethod;
  path: string;
  body?: string | undefined;
  headers?: Record<string, string> | undefined;
}

interface AccountCallOptions {
  baseUrl: string;
  credential: CallCredential;
  requestTimeoutMs?: number | undefined;
}

export interface AccountCallEffects {
  readonly requestTimeoutMs: number;
  send(request: CallRequest): Effect.Effect<CallAnswer, never, HttpClient.HttpClient>;
  ask<Answer, Encoded>(
    request: CallRequest,
    answer: EffectSchema.Codec<Answer, Encoded>,
  ): Effect.Effect<Answer | undefined, never, HttpClient.HttpClient>;
}

interface Identity {
  holder: string | undefined;
  authorization: string | undefined;
}

class CallTransportError extends Data.TaggedError("CallTransportError")<{
  readonly errorName: string | undefined;
}> {}

type Reader<Answer> = (
  response: HttpClientResponse.HttpClientResponse,
) => Effect.Effect<Answer, CallTransportError>;

type Attempted<Answer> = { readonly answer: Answer } | Refused;

type CallFailed = { readonly failure: CallFailure };

type Answered<Answer> = { readonly answer: Answer } | CallFailed;

type Refused = { readonly refusal: HttpClientResponse.HttpClientResponse };

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

function transportFailure(error: CallTransportError): CallFailure {
  return {
    fault: CALL_FAULT.NETWORK,
    ...(error.errorName === undefined ? undefined : { errorName: error.errorName }),
  };
}

function toldReach(
  change: (state: ServiceReachState, now: number) => ServiceReachState,
): Effect.Effect<void> {
  return Effect.flatMap(
    Effect.serviceOption(ServiceReach),
    Option.match({
      onNone: () => Effect.void,
      onSome: (reach) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          SubscriptionRef.update(reach, (state) => change(state, now)),
        ),
    }),
  );
}

const heardAnswer = toldReach((_, now) => ({ reachable: true, answeredAt: now }));

const heardNoAnswer = toldReach((state, now) =>
  now - state.answeredAt > Duration.toMillis(SILENCE_BEFORE_UNREACHABLE)
    ? { ...state, reachable: false }
    : state,
);

function readCredential(
  read: (() => Effect.Effect<string | undefined>) | undefined,
): Effect.Effect<string | undefined> {
  return read === undefined ? Effect.succeed(undefined) : read();
}

export function resolvedCredential(credential: CallCredential): Effect.Effect<CallCredential> {
  return credential.resolve === undefined
    ? Effect.succeed(credential)
    : Effect.flatMap(credential.resolve(), resolvedCredential);
}

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
      Effect.timeoutOrElse({
        duration: deadline,
        orElse: () => Effect.fail(new CallTransportError({ errorName: DEADLINE_ERROR_NAME })),
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
    return Effect.catch(HttpClient.execute(httpRequest(request, authorization)), (error) =>
      Effect.fail(new CallTransportError({ errorName: errorName(error.cause) })),
    );
  }

  function attempt<Answer>(
    request: CallRequest,
    authorization: string | undefined,
    read: Reader<Answer>,
  ): Effect.Effect<Answer, CallTransportError, HttpClient.HttpClient> {
    return withinDeadline(
      Effect.flatMap(
        Effect.tap(requested(request, authorization), () => heardAnswer),
        read,
      ),
    ).pipe(Effect.tapError(() => heardNoAnswer));
  }

  function attemptDecidingRefusal<Answer>(
    request: CallRequest,
    authorization: string | undefined,
    read: Reader<Answer>,
  ): Effect.Effect<Attempted<Answer>, CallTransportError, HttpClient.HttpClient> {
    return attempt(
      request,
      authorization,
      (response): Effect.Effect<Attempted<Answer>, CallTransportError> =>
        response.status === HTTP_STATUS.UNAUTHORIZED
          ? Effect.succeed({ refusal: response })
          : Effect.map(read(response), (answer) => ({ answer })),
    );
  }

  const identify = (current: CallCredential): Effect.Effect<Identity | undefined> =>
    Effect.gen(function* () {
      const holder = yield* readCredential(current.holder);
      const authorization = yield* readCredential(current.authorization);
      if (current.authorization && authorization === undefined) return undefined;
      return { holder, authorization };
    });

  const renew = (current: CallCredential): Effect.Effect<void> =>
    Effect.ignore(Effect.suspend(() => current.renew?.() ?? Effect.void));

  function answered<Answer>(
    request: CallRequest,
    read: Reader<Answer>,
  ): Effect.Effect<Answered<Answer>, never, HttpClient.HttpClient> {
    const settled = <Read>(
      effect: Effect.Effect<Read, CallTransportError, HttpClient.HttpClient>,
    ): Effect.Effect<{ readonly read: Read } | CallFailed, never, HttpClient.HttpClient> =>
      Effect.map(
        Effect.result(effect),
        Result.match({
          onFailure: (error) => ({ failure: transportFailure(error) }),
          onSuccess: (read) => ({ read }),
        }),
      );

    return Effect.gen(function* () {
      const current = yield* resolvedCredential(credential);
      const identity = yield* identify(current);
      if (!identity) return { failure: { fault: CALL_FAULT.NO_CREDENTIAL } };

      const first = yield* settled(attemptDecidingRefusal(request, identity.authorization, read));
      if (!("read" in first)) return first;
      if (!("refusal" in first.read)) return first.read;

      yield* renew(current);
      const renewal = yield* identify(current);
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
    send: (request) =>
      Effect.map(answered(request, responseReader), (end) =>
        "answer" in end ? end.answer : end.failure,
      ),
    ask: (request, answer) =>
      reading(request, (response) =>
        Effect.catch(HttpClientResponse.schemaBodyJson(answer)(response), () =>
          Effect.succeed(undefined),
        ),
      ),
  };
}

export function accountBearer(token: AccountToken): CallCredential {
  return {
    authorization: () =>
      Effect.map(token.readAccessToken(), (accessToken) =>
        accessToken ? bearer(accessToken) : undefined,
      ),
    renew: token.refreshAccount,
    holder: token.readAccountKey,
  };
}

export function sessionBearer(token: AccountToken & AccountSessionToken): CallCredential {
  return {
    authorization: () =>
      Effect.map(token.readSessionToken(), (sessionToken) =>
        sessionToken ? bearer(sessionToken) : undefined,
      ),
    renew: token.obtainSession,
    holder: token.readAccountKey,
  };
}

export function sendInSession(
  call: AccountCallEffects,
  session: Pick<CallCredential, "holder" | "renew" | "resolve">,
): AccountCallEffects["send"] {
  const resolved = resolvedCredential(session);
  const holder = Effect.flatMap(resolved, (current) => readCredential(current.holder));
  const renew = Effect.ignore(
    Effect.flatMap(resolved, (current) => current.renew?.() ?? Effect.void),
  );
  return (request) =>
    Effect.gen(function* () {
      const asking = yield* holder;
      const first = yield* call.send(request);
      if (callAnswered(first) || first.fault !== CALL_FAULT.NO_CREDENTIAL) return first;
      yield* renew;
      if ((yield* holder) !== asking) return { fault: CALL_FAULT.HOLDER_CHANGED };
      return yield* call.send(request);
    });
}

export function fixedBearer(credential: string): CallCredential {
  const authorization = bearer(credential);
  return { authorization: () => Effect.succeed(authorization) };
}

export const NO_CREDENTIAL: CallCredential = {};

export function lateCredential(credential: Effect.Effect<CallCredential>): CallCredential {
  return { resolve: () => credential };
}

function bearer(credential: string): string {
  return `Bearer ${credential}`;
}
