import { LIVE_POLL } from "./live-wire.js";

/**
 * hosted-link.ts -- the hosted contract's oRPC client, carried by the one account call.
 *
 * An `OpenAPILink` over `hostedContract` whose transport is `accountCall`'s
 * `send`, so everything that call owns stays its own: the credential read
 * fresh for every attempt, the one renew-and-retry of a 401 while the
 * holder stands, the no-credential fault, and the ambient `HttpClient` a
 * test fakes with `fakeCloudApi`. The answer's body is read whole before
 * oRPC reads it, and the one deadline covers the call whole, its headers and
 * its body together, so a body that stalls after its headers is let go when
 * the call's deadline ends rather than awaited past it. Wrapped in
 * `createEffectClient`, so a procedure is a lazy Effect.
 *
 * The link reads the wire as the service writes it (`contract/errors.ts`):
 * a success is the output's wire schema encoded, so it is decoded here with
 * that schema, a key a newer service added dropped as `readServiceAnswer`
 * drops one; a refusal is `{ error: slug, ...data }`, read into the slug
 * and the fields its declared error carries. A refusal the procedure's
 * contract does not declare is read as no answer, kept with its status and
 * slug, so a caller only ever hears a refusal its procedure says it may
 * answer. Each procedure's client is typed with the errors its contract
 * declares, which `hostedCall` (`hosted-call.ts`) reads its failures from.
 *
 * Note that the link's transport is a promise door: oRPC calls `fetch` and
 * awaits it, so the account call is run there, on the services the calling
 * fiber handed over through the link's client context (`askHosted`), never
 * on a runtime of its own. The fake `HttpClient` and `TestClock` a test
 * provides are therefore the ones the call runs under, and an interrupted
 * caller aborts the run.
 */

import {
  type Client,
  createORPCClient,
  isORPCErrorJson,
  MalformedResponseError,
  ORPCError,
} from "@orpc/client";
import type {
  ErrorMap,
  InferSchemaInput,
  ORPCErrorFromErrorMap,
  ProcedureContract,
} from "@orpc/contract";
import { createEffectClient, type EffectClient } from "@orpc/experimental-effect";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { HTTP_METHOD, type HttpMethod, type UnparsedWireValue } from "@repo/wire";
import {
  Cause,
  Clock,
  type Context,
  Data,
  Duration,
  Effect,
  Exit,
  Random,
  Result,
  Schema,
  Tracer,
} from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  CALL_FAULT,
  type CallAnswer,
  type CallCredential,
  type CallRequest,
  callAnswered,
  DEADLINE_ERROR_NAME,
  sendInSession,
} from "./account-call.js";
import { MAC_PRESENCE } from "./agent-wire.js";
import { HOSTED_REFUSAL_DATA, refusalCarriesData } from "./contract/errors.js";
import { hostedContract } from "./contract/index.js";
import { outputWireSchema, refusalDeclared } from "./contract/output-schema.js";
import { FAILURE_FACT, type FailureFacts } from "./failure-facts.js";
import {
  SENTRY_TRACES_SAMPLE_RATE,
  type SendTrace,
  SentSendTrace,
  sendTraceHeaders,
} from "./sentry-tracing.js";
import {
  type HostedApiError,
  hostedErrorSchema,
  IDEMPOTENCY_KEY,
  readServiceAnswer,
} from "./service-wire.js";

/**
 * The deadlines a procedure is asked under, by how long its answer may
 * take: the usual one, a held read the service keeps open for as long as it
 * waits on the next change (or a dictated clip the model hears through), a
 * read of the account's devices' beats, which must land or fail inside a
 * poll, a message to an agent, which waits on the agent's conversation and on
 * its session taking the words before it answers, and a Start, which may copy another
 * agent's work before it answers.
 */
export const HOSTED_DEADLINE = {
  USUAL: "usual",
  HELD: "held",
  STEER: "steer",
  START: "start",
  CHAPTERS: "chapters",
  BROWSER_OPEN: "browser-open",
  PRESENCE: "presence",
} as const;

export type HostedDeadline = (typeof HOSTED_DEADLINE)[keyof typeof HOSTED_DEADLINE];

/**
 * The deadlines longer than the usual one, which is the account call's own
 * default or the one a client keeps: a held read's is the service's hold and
 * room for the answer to travel after it, a message's outlasts the service's
 * wait for the conversation's lock (five seconds) and its hand-over to the
 * agent's session under it (thirty, `@repo/database/models/writer`'s bounds) with room for
 * the reads before them, so a send that lands slowly is never read as one
 * that did not answer, a Start's outlasts the copy, and a
 * Generate of a pull request's chapters outlasts the function it runs in
 * (`@repo/service/chapters/chapters-function`'s 240 seconds), and a Browser
 * tab opened in an agent's browser outlasts its sandbox's resume (a minute)
 * and its bridge's bound (twenty seconds, `agent-browser.ts`), and a read
 * of the devices' beats is `MAC_PRESENCE.READ_TIMEOUT_MS`.
 */
const LONG_DEADLINE_MS = {
  [HOSTED_DEADLINE.HELD]: 35_000,
  [HOSTED_DEADLINE.STEER]: 45_000,
  [HOSTED_DEADLINE.START]: 120_000,
  [HOSTED_DEADLINE.CHAPTERS]: 250_000,
  [HOSTED_DEADLINE.BROWSER_OPEN]: 120_000,
  [HOSTED_DEADLINE.PRESENCE]: MAC_PRESENCE.READ_TIMEOUT_MS,
} as const satisfies Record<Exclude<HostedDeadline, typeof HOSTED_DEADLINE.USUAL>, number>;

/** The span a hosted ask runs under, whose trace every attempt it sends carries. */
const HOSTED_ASK_SPAN = "hosted.ask";

/** The code the link's own error names an error the service declares no refusal for under, its status and oRPC code kept beneath. */
const UNDECLARED_CODE = "UNDECLARED";

/** The monotonic clock's nanoseconds in a millisecond, which a budget is counted in. */
const NANOS_PER_MILLI = 1_000_000;

/** The content type the link names a JSON body with, which the account call writes itself. */
const CONTENT_TYPE_HEADER = "content-type";

/** What one ask hands the link: the caller's own services to run the call on, its deadline, the idempotency key it is sent under, where it has one, and the send's trace, where a press began it. */
interface HostedLinkContext {
  readonly services: Context.Context<HttpClient.HttpClient>;
  readonly deadline: HostedDeadline;
  readonly idempotencyKey?: string;
  readonly trace?: SendTrace;
}

/** Sentry's `sentry-trace`: the trace's id, the span's, and the sampling decision, which a send's span always made. */
const SENTRY_TRACE_PATTERN = /^([0-9a-f]{32})-([0-9a-f]{16})-([01])$/;

/** The span a send's trace names, as the parent its ask continues; none where it does not parse. */
function sendParent(trace: SendTrace): Tracer.ExternalSpan | undefined {
  const named = SENTRY_TRACE_PATTERN.exec(trace.sentryTrace.trim());
  if (named === null) return undefined;
  const [, traceId, spanId, sampled] = named;
  if (traceId === undefined || spanId === undefined) return undefined;
  return Tracer.externalSpan({ traceId, spanId, sampled: sampled === "1" });
}

/** The refusals that carry fields beside their slug. */
type RefusalWithData = keyof typeof HOSTED_REFUSAL_DATA;

/** A union of records as the one record that holds each of their fields. */
type Merged<Union> = (Union extends unknown ? (record: Union) => void : never) extends (
  record: infer Record,
) => void
  ? Record
  : never;

/** The fields a refusal carries beside its slug, by the declared error that carries them, every one optional. */
type HostedRefusalData = Merged<(typeof HOSTED_REFUSAL_DATA)[RefusalWithData]["Type"]>;

/** The service refused the procedure: its slug, and the fields its declared error carries where they read. */
export class HostedRefused extends Data.TaggedError("HostedRefused")<{
  readonly refusal: HostedApiError;
  readonly data?: HostedRefusalData;
  /** The trace the call traveled under, once `askHosted` has answered it. */
  readonly traceId?: string;
}> {}

/** What of an answer that arrived the link could not read. */
const HOSTED_UNREAD = {
  /** The answer's body did not end within its deadline, or could not be read. */
  BODY: "body-unread",
  /** The answer was not the procedure's output as its wire schema reads it. */
  OUTPUT: "output-unread",
} as const;

/**
 * The procedure reached no answer the link could read: the call ended before
 * any status (no credential, the holder changed, the network, the deadline),
 * its answer could not be read, or the service answered an error it declares
 * no refusal for, such as a server error. A fault names where a call ended
 * before any status, so a caller can tell a call that never reached the
 * service from one it answered; an answer that arrived names what of it went
 * unread, and an undeclared error keeps its HTTP status and oRPC code. The
 * error's kind is a name, never its words, which could carry a credential.
 */
export class HostedUnanswered extends Data.TaggedError("HostedUnanswered")<{
  readonly fault?: (typeof CALL_FAULT)[keyof typeof CALL_FAULT];
  readonly unread?: (typeof HOSTED_UNREAD)[keyof typeof HOSTED_UNREAD];
  readonly errorName?: string;
  readonly status?: number;
  readonly code?: string;
  /** The trace the call traveled under, once `askHosted` has answered it. */
  readonly traceId?: string;
}> {}

export type HostedFailure = HostedRefused | HostedUnanswered;

/**
 * A hosted failure as it crosses to a window beside the answer it was
 * flattened to (`failure-facts.ts`): the refusal a caller names no failure
 * for, or where the call ended, what the service answered, and the error's
 * kind.
 */
export function hostedFailureFacts(failed: HostedFailure): FailureFacts {
  const { traceId } = failed;
  const trace = traceId === undefined ? undefined : { traceId };
  if (failed._tag === "HostedRefused") {
    return { _tag: FAILURE_FACT.HOSTED_REFUSED, refusal: failed.refusal, ...trace };
  }
  const { fault, unread, errorName, status } = failed;
  // Note that what went unread is sent as the code, which an answer the link could not read has no other of.
  const code = failed.code ?? unread;
  return {
    _tag: FAILURE_FACT.HOSTED_UNANSWERED,
    ...(fault === undefined ? undefined : { fault }),
    ...(errorName === undefined ? undefined : { errorName }),
    ...(status === undefined ? undefined : { status }),
    ...(code === undefined ? undefined : { code }),
    ...trace,
  };
}

/**
 * What a procedure's call may fail with: a refusal its contract declares,
 * as oRPC names one (its slug the code), or any other error the link or
 * oRPC throws.
 */
type HostedLinkError<Errors extends ErrorMap> = ORPCErrorFromErrorMap<Errors> | Error;

/**
 * Each procedure as the link answers it: the output as the wire schema
 * decodes it, so its type is the schema's own (the contract declares the
 * schema flipped, which oRPC would read as the encoded side), and the
 * refusals its contract declares.
 */
type HostedLinkClient<Router> =
  Router extends ProcedureContract<infer InputSchema, infer OutputSchema, infer Errors>
    ? Client<
        HostedLinkContext,
        InferSchemaInput<InputSchema>,
        InferSchemaInput<OutputSchema>,
        HostedLinkError<Errors>
      >
    : { readonly [Key in keyof Router]: HostedLinkClient<Router[Key]> };

/** Every hosted procedure, one lazy Effect each. */
export type HostedClient = EffectClient<HostedLinkClient<typeof hostedContract>>;

/** One procedure of the client, asked with its input and the link's context, failing with what its contract declares. */
export type HostedProcedure<Input, Output, Failure = unknown> = (
  input: Input,
  options: { readonly context: HostedLinkContext },
) => Effect.Effect<Output, Failure>;

export interface HostedClientOptions {
  /** The service origin; any trailing separator is trimmed once. */
  baseUrl: string;
  credential: CallCredential;
  /** The usual deadline, where a client keeps one of its own. */
  requestTimeoutMs?: number | undefined;
  /** Whether the credential is the Mac's Better Auth session, asked for once where none is held yet (`sendInSession`). */
  inSession?: boolean | undefined;
}

const isJsonText = Schema.is(Schema.String);

function isHttpMethod(method: string | undefined): method is HttpMethod {
  return Object.values<string | undefined>(HTTP_METHOD).includes(method);
}

/** The request the link built, as the account call sends it; a body is only ever the JSON text the link serialized. */
function callRequest(url: string, init: RequestInit): CallRequest {
  const method = init.method?.toUpperCase();
  if (!isHttpMethod(method)) throw new TypeError(`A hosted procedure cannot be asked by ${method}`);
  const body = init.body ?? undefined;
  if (body !== undefined && !isJsonText(body)) {
    throw new TypeError("A hosted procedure's body is JSON text");
  }
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    if (name !== CONTENT_TYPE_HEADER) headers[name] = value;
  });
  return {
    method,
    path: url,
    ...(body === undefined ? undefined : { body }),
    ...(Object.keys(headers).length === 0 ? undefined : { headers }),
  };
}

/**
 * A refusal as the service writes it, `{ error: slug, ...data }`, read into
 * its slug and the fields its declared error carries; fields this build
 * cannot read, or none at all, leave the bare refusal. Anything else is no refusal, which
 * oRPC then reads as a malformed answer.
 */
function refusalOf(payload: UnparsedWireValue): HostedRefused | undefined {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  if (refusal === undefined) return undefined;
  if (!refusalCarriesData(refusal)) return new HostedRefused({ refusal });
  const data: HostedRefusalData | undefined = Result.getOrUndefined(
    readServiceAnswer(HOSTED_REFUSAL_DATA[refusal])(payload),
  );
  // Note that a refusal that carries none of its fields is the bare refusal, as one that declares none is.
  const carried = data !== undefined && Object.keys(data).length > 0;
  return new HostedRefused({ refusal, ...(carried ? { data } : undefined) });
}

/** What the link's own error for a refusal carries beside it: the status the refusal came under. */
const isRefusedStatus = Schema.is(Schema.Struct({ status: Schema.Number }));

/**
 * A procedure's failure, a refusal its contract does not declare read as no
 * answer, kept with the status it came under and its slug as the code.
 */
function declaredOnly(path: readonly string[], error: unknown): unknown {
  if (!(error instanceof ORPCError) || !(error.cause instanceof HostedRefused)) return error;
  const { refusal } = error.cause;
  if (refusalDeclared(path, refusal)) return error;
  const status = isRefusedStatus(error.data) ? error.data.status : undefined;
  return new HostedUnanswered({
    code: refusal,
    ...(status === undefined ? undefined : { status }),
  });
}

/** A body's text, read to its end. */
function textOf(reader: ReadableStreamDefaultReader<Uint8Array>): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = yield* Effect.tryPromise(() => reader.read());
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
    }
  });
}

/**
 * A response's body read whole within the deadline, so the link reads it
 * from memory; nothing, its stream's cancel started so its connection is let
 * go, where it has not ended by then or could not be read.
 */
export function textWithin(
  response: Response,
  deadline: Duration.Duration,
): Effect.Effect<string | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return Effect.succeed("");
  return textOf(reader).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.timeoutOrElse({
      duration: deadline,
      // Note that the cancel is started rather than awaited, because a stream whose cancel never settles would otherwise hold the call past its deadline.
      orElse: () =>
        Effect.as(
          Effect.forkDetach(Effect.ignore(Effect.tryPromise(() => reader.cancel()))),
          undefined,
        ),
    }),
  );
}

/**
 * The request sent and its answer's body read, within one budget for the
 * whole call: the headers, and a 401's renewal and retry among them, are
 * bounded by it, and the body is given only what is left of it. Note that a
 * renewal shares the budget rather than getting a fresh one, because the
 * deadline is what a caller bounds its own wait by, and a call that could
 * run past it would have every caller stack a timeout of its own on top; a
 * renewal that spends the budget ends the call as the deadline, as a slow
 * first attempt does.
 */
function readWhole(
  send: AccountCallEffects["send"],
  request: CallRequest,
  budgetMs: number,
): Effect.Effect<
  { readonly answer: CallAnswer; readonly text?: string | undefined },
  never,
  HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    // Note that the time spent is read off the monotonic clock, so a wall clock set back or forward moves no budget.
    const startedAt = yield* Clock.monotonicTimeNanos;
    const answer = yield* send(request).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(budgetMs),
        orElse: () =>
          Effect.succeed<CallAnswer>({ fault: CALL_FAULT.NETWORK, errorName: DEADLINE_ERROR_NAME }),
      }),
    );
    if (!callAnswered(answer)) return { answer };
    // The body gets what the headers left of the budget, never a deadline of its own.
    const spentMs = Number((yield* Clock.monotonicTimeNanos) - startedAt) / NANOS_PER_MILLI;
    const leftMs = Math.max(0, budgetMs - spentMs);
    const text = yield* textWithin(answer.response, Duration.millis(leftMs));
    return { answer, text };
  });
}

/**
 * The account call run on the services the caller handed over, under the
 * deadline it named, aborted with the caller. A call that ended before any
 * status is thrown as the fault it is, since a transport that answers must
 * answer a `Response`.
 */
async function sent(
  options: HostedClientOptions,
  url: string,
  init: RequestInit,
  context: HostedLinkContext,
): Promise<Response> {
  const call = accountCall({
    baseUrl: options.baseUrl,
    credential: options.credential,
    requestTimeoutMs:
      context.deadline === HOSTED_DEADLINE.USUAL
        ? options.requestTimeoutMs
        : LONG_DEADLINE_MS[context.deadline],
  });
  const send = options.inSession === true ? sendInSession(call, options.credential) : call.send;
  const request = callRequest(url, init);
  const { idempotencyKey, trace } = context;
  const keyed: CallRequest =
    idempotencyKey === undefined && trace === undefined
      ? request
      : {
          ...request,
          headers: {
            ...request.headers,
            ...(idempotencyKey === undefined
              ? undefined
              : { [IDEMPOTENCY_KEY.HEADER]: idempotencyKey }),
            ...(trace === undefined ? undefined : sendTraceHeaders(trace)),
          },
        };
  const exit = await Effect.runPromiseExitWith(context.services)(
    readWhole(send, keyed, call.requestTimeoutMs),
    init.signal ? { signal: init.signal } : undefined,
  );
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  const { answer, text } = exit.value;
  if (!callAnswered(answer)) {
    throw new HostedUnanswered({
      fault: answer.fault,
      ...(answer.errorName === undefined ? undefined : { errorName: answer.errorName }),
    });
  }
  const { response } = answer;
  if (text === undefined) {
    throw new HostedUnanswered({ unread: HOSTED_UNREAD.BODY, status: response.status });
  }
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** The hosted contract's client over the account call. */
export function hostedClient(options: HostedClientOptions): HostedClient {
  const link = new OpenAPILink<HostedLinkContext>(hostedContract, {
    fetch: (url, init, call) => sent(options, url, init, call.context),
    customErrorResponseBodyDecoder: (body, response) => {
      // SAFETY: the link's serializer read the body out of the response's JSON text.
      const refused = refusalOf(body as UnparsedWireValue);
      // Note that the status rides as the link's own error's data, which only `declaredOnly` reads, since oRPC's error carries no status.
      if (refused !== undefined) {
        return new ORPCError(refused.refusal, {
          cause: refused,
          data: { status: response.status },
        });
      }
      // Note that an error the service declares no refusal for, a server error among them, keeps its status and oRPC code, since oRPC's own error carries no status.
      const code = isORPCErrorJson(body) ? body.code : undefined;
      const unanswered = new HostedUnanswered({
        status: response.status,
        ...(code === undefined ? undefined : { code }),
      });
      return new ORPCError(UNDECLARED_CODE, { cause: unanswered });
    },
    interceptors: [
      async ({ next, path }) => {
        const output = await next().catch((error: unknown) => {
          throw declaredOnly(path, error);
        });
        const wire = outputWireSchema(path);
        if (wire === undefined) return output;
        // SAFETY: the link's serializer read the output out of the response's JSON text.
        const read = readServiceAnswer(wire)(output as UnparsedWireValue);
        if (Result.isFailure(read)) throw new HostedUnanswered({ unread: HOSTED_UNREAD.OUTPUT });
        return read.success;
      },
    ],
  });
  return createEffectClient(createORPCClient<HostedLinkClient<typeof hostedContract>>(link));
}

/** What a procedure's failure was, read off what oRPC or the link threw. */
function hostedFailureOf(error: unknown): HostedFailure {
  if (error instanceof HostedUnanswered) return error;
  if (error instanceof ORPCError && error.cause instanceof HostedRefused) return error.cause;
  if (error instanceof ORPCError && error.cause instanceof HostedUnanswered) return error.cause;
  if (error instanceof MalformedResponseError) {
    return new HostedUnanswered({ status: error.response.status, errorName: error.name });
  }
  return new HostedUnanswered(error instanceof Error ? { errorName: error.name } : {});
}

/** A failure with the trace its call traveled under, which the service's log lines for it carry. */
function traced(failed: HostedFailure, traceId: string): HostedFailure {
  if (failed._tag === "HostedRefused") {
    const { refusal, data } = failed;
    return new HostedRefused({ refusal, ...(data === undefined ? undefined : { data }), traceId });
  }
  const { fault, unread, errorName, status, code } = failed;
  return new HostedUnanswered({
    ...(fault === undefined ? undefined : { fault }),
    ...(unread === undefined ? undefined : { unread }),
    ...(errorName === undefined ? undefined : { errorName }),
    ...(status === undefined ? undefined : { status }),
    ...(code === undefined ? undefined : { code }),
    traceId,
  });
}

/**
 * One procedure asked on the calling fiber's own services, under the
 * deadline named: its output, or why there was none, with the trace it
 * traveled under. The ask is a client span of its own, so every attempt it
 * sends carries that span's trace in `traceparent` (Effect's `HttpClient`
 * writes it), which the service continues, and is sampled at the rate the
 * service's traces are, so the flag it sends says whether to trace it. A
 * write sent under an idempotency key carries it on every attempt, the
 * renewed one after a 401 among them (`IDEMPOTENCY_KEY`).
 *
 * A send the developer pressed is asked under its press's trace
 * (`SentSendTrace`): the ask is a span of that trace, sampled as the press
 * was rather than by a coin of its own, and every attempt carries the trace
 * as Sentry's `sentry-trace` and `baggage`, which the service continues
 * before `traceparent`, so its spans sit under the press's span.
 */
export function askHosted<Input, Output>(
  procedure: HostedProcedure<Input, Output>,
  input: Input,
  deadline: HostedDeadline = HOSTED_DEADLINE.USUAL,
  idempotencyKey?: string,
): Effect.Effect<Output, HostedFailure, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const sent = yield* SentSendTrace;
    const parent = sent === undefined ? undefined : sendParent(sent);
    const trace = parent === undefined ? undefined : sent;
    const sampled = parent?.sampled ?? (yield* Random.next) < SENTRY_TRACES_SAMPLE_RATE;
    const asked = Effect.gen(function* () {
      const span = yield* Effect.orDie(Effect.currentSpan);
      const services = yield* Effect.context<HttpClient.HttpClient>();
      return yield* Effect.mapError(
        procedure(input, {
          context: {
            services,
            deadline,
            ...(idempotencyKey === undefined ? undefined : { idempotencyKey }),
            ...(trace === undefined ? undefined : { trace }),
          },
        }),
        (error) => traced(hostedFailureOf(error), span.traceId),
      );
    });
    return yield* Effect.withSpan(asked, HOSTED_ASK_SPAN, {
      kind: "client",
      sampled,
      ...(parent === undefined ? undefined : { parent }),
    });
  });
}

/** What a live read's input may name of a poll. */
export interface LivePollInput {
  readonly [LIVE_POLL.QUERY]?: typeof LIVE_POLL.ON;
  readonly [LIVE_POLL.AFTER]?: string;
}
