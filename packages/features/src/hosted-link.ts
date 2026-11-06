import { LIVE_POLL } from "./live-wire.js";

import {
  type Client,
  createORPCClient,
  isORPCErrorJson,
  MalformedResponseError,
  ORPCError,
} from "@orpc/client";
import type { InferSchemaInput, ProcedureContract } from "@orpc/contract";
import { createEffectClient, type EffectClient } from "@orpc/experimental-effect";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { HTTP_METHOD, type HttpMethod, type UnparsedWireValue } from "@repo/wire";
import { Cause, type Context, Data, Duration, Effect, Exit, Random, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  accountCall,
  type CALL_FAULT,
  type CallCredential,
  type CallRequest,
  callAnswered,
  sendInSession,
} from "./account-call.js";
import {
  credentialMissingDataSchema,
  localAgentRefusedDataSchema,
  planLimitReachedDataSchema,
  repositoryNotReachableDataSchema,
} from "./contract/errors.js";
import { hostedContract } from "./contract/index.js";
import { outputWireSchema } from "./contract/output-schema.js";
import { FAILURE_FACT, type FailureFacts } from "./failure-facts.js";
import { hostPairingHeldDataSchema, hostUpgradeNeededDataSchema } from "./host-wire.js";
import { installedSkillRefusedDataSchema } from "./installed-skill-route-wire.js";
import { SENTRY_TRACES_SAMPLE_RATE } from "./sentry-tracing.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  IDEMPOTENCY_KEY,
  readServiceAnswer,
} from "./service-wire.js";

export const HOSTED_DEADLINE = {
  USUAL: "usual",
  HELD: "held",
  STEER: "steer",
  START: "start",
  CHAPTERS: "chapters",
  BROWSER_OPEN: "browser-open",
} as const;

export type HostedDeadline = (typeof HOSTED_DEADLINE)[keyof typeof HOSTED_DEADLINE];

const LONG_DEADLINE_MS = {
  [HOSTED_DEADLINE.HELD]: 35_000,
  [HOSTED_DEADLINE.STEER]: 45_000,
  [HOSTED_DEADLINE.START]: 120_000,
  [HOSTED_DEADLINE.CHAPTERS]: 250_000,
  [HOSTED_DEADLINE.BROWSER_OPEN]: 120_000,
} as const satisfies Record<Exclude<HostedDeadline, typeof HOSTED_DEADLINE.USUAL>, number>;

const HOSTED_ASK_SPAN = "hosted.ask";

const UNDECLARED_CODE = "UNDECLARED";

const CONTENT_TYPE_HEADER = "content-type";

interface HostedLinkContext {
  readonly services: Context.Context<HttpClient.HttpClient>;
  readonly deadline: HostedDeadline;
  readonly idempotencyKey?: string;
}

type HostedRefusalData = typeof repositoryNotReachableDataSchema.Type &
  typeof planLimitReachedDataSchema.Type &
  typeof credentialMissingDataSchema.Type &
  typeof installedSkillRefusedDataSchema.Type &
  typeof localAgentRefusedDataSchema.Type &
  typeof hostUpgradeNeededDataSchema.Type &
  typeof hostPairingHeldDataSchema.Type;

export class HostedRefused extends Data.TaggedError("HostedRefused")<{
  readonly refusal: HostedApiError;
  readonly data?: HostedRefusalData;
  readonly traceId?: string;
}> {}

const HOSTED_UNREAD = {
  BODY: "body-unread",
  OUTPUT: "output-unread",
} as const;

export class HostedUnanswered extends Data.TaggedError("HostedUnanswered")<{
  readonly fault?: (typeof CALL_FAULT)[keyof typeof CALL_FAULT];
  readonly unread?: (typeof HOSTED_UNREAD)[keyof typeof HOSTED_UNREAD];
  readonly errorName?: string;
  readonly status?: number;
  readonly code?: string;
  readonly traceId?: string;
}> {}

export type HostedFailure = HostedRefused | HostedUnanswered;

export function hostedFailureFacts(failed: HostedFailure): FailureFacts {
  const { traceId } = failed;
  const trace = traceId === undefined ? undefined : { traceId };
  if (failed._tag === "HostedRefused") {
    return { _tag: FAILURE_FACT.HOSTED_REFUSED, refusal: failed.refusal, ...trace };
  }
  const { fault, unread, errorName, status } = failed;
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

type HostedLinkClient<Router> =
  Router extends ProcedureContract<infer InputSchema, infer OutputSchema, infer _Errors>
    ? Client<
        HostedLinkContext,
        InferSchemaInput<InputSchema>,
        InferSchemaInput<OutputSchema>,
        unknown
      >
    : { readonly [Key in keyof Router]: HostedLinkClient<Router[Key]> };

export type HostedClient = EffectClient<HostedLinkClient<typeof hostedContract>>;

export type HostedProcedure<Input, Output> = (
  input: Input,
  options: { readonly context: HostedLinkContext },
) => Effect.Effect<Output, unknown>;

export interface HostedClientOptions {
  baseUrl: string;
  credential: CallCredential;
  requestTimeoutMs?: number | undefined;
  inSession?: boolean | undefined;
}

const isJsonText = Schema.is(Schema.String);

function isHttpMethod(method: string | undefined): method is HttpMethod {
  return Object.values<string | undefined>(HTTP_METHOD).includes(method);
}

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

function refusalOf(payload: UnparsedWireValue): HostedRefused | undefined {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  if (refusal === undefined) return undefined;
  const schema =
    refusal === HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE
      ? repositoryNotReachableDataSchema
      : refusal === HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED
        ? planLimitReachedDataSchema
        : refusal === HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING
          ? credentialMissingDataSchema
          : refusal === HOSTED_API_ERROR.SKILL_NAME_TAKEN ||
              refusal === HOSTED_API_ERROR.SKILL_FILES_REFUSED
            ? installedSkillRefusedDataSchema
            : refusal === HOSTED_API_ERROR.LOCAL_AGENT_REFUSED
              ? localAgentRefusedDataSchema
              : refusal === HOSTED_API_ERROR.HOST_UPGRADE_NEEDED
                ? hostUpgradeNeededDataSchema
                : refusal === HOSTED_API_ERROR.HOST_PAIRING_HELD
                  ? hostPairingHeldDataSchema
                  : undefined;
  if (schema === undefined) return new HostedRefused({ refusal });
  const data = Result.getOrUndefined(readServiceAnswer(schema)(payload));
  return new HostedRefused({ refusal, ...(data === undefined ? undefined : { data }) });
}

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
      orElse: () => Effect.as(Effect.ignore(Effect.tryPromise(() => reader.cancel())), undefined),
    }),
  );
}

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
  const { idempotencyKey } = context;
  const keyed: CallRequest =
    idempotencyKey === undefined
      ? request
      : { ...request, headers: { ...request.headers, [IDEMPOTENCY_KEY.HEADER]: idempotencyKey } };
  const exit = await Effect.runPromiseExitWith(context.services)(
    send(keyed),
    init.signal ? { signal: init.signal } : undefined,
  );
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  const answer = exit.value;
  if (!callAnswered(answer)) {
    throw new HostedUnanswered({
      fault: answer.fault,
      ...(answer.errorName === undefined ? undefined : { errorName: answer.errorName }),
    });
  }
  const { response } = answer;
  const text = await Effect.runPromiseWith(context.services)(
    textWithin(response, Duration.millis(call.requestTimeoutMs)),
    init.signal ? { signal: init.signal } : undefined,
  );
  if (text === undefined) {
    throw new HostedUnanswered({ unread: HOSTED_UNREAD.BODY, status: response.status });
  }
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function hostedClient(options: HostedClientOptions): HostedClient {
  const link = new OpenAPILink<HostedLinkContext>(hostedContract, {
    fetch: (url, init, call) => sent(options, url, init, call.context),
    customErrorResponseBodyDecoder: (body, response) => {
      const refused = refusalOf(body as UnparsedWireValue);
      if (refused !== undefined) return new ORPCError(refused.refusal, { cause: refused });
      const code = isORPCErrorJson(body) ? body.code : undefined;
      const unanswered = new HostedUnanswered({
        status: response.status,
        ...(code === undefined ? undefined : { code }),
      });
      return new ORPCError(UNDECLARED_CODE, { cause: unanswered });
    },
    interceptors: [
      async ({ next, path }) => {
        const output = await next();
        const wire = outputWireSchema(path);
        if (wire === undefined) return output;
        const read = readServiceAnswer(wire)(output as UnparsedWireValue);
        if (Result.isFailure(read)) throw new HostedUnanswered({ unread: HOSTED_UNREAD.OUTPUT });
        return read.success;
      },
    ],
  });
  return createEffectClient(createORPCClient<HostedLinkClient<typeof hostedContract>>(link));
}

function hostedFailureOf(error: unknown): HostedFailure {
  if (error instanceof HostedUnanswered) return error;
  if (error instanceof ORPCError && error.cause instanceof HostedRefused) return error.cause;
  if (error instanceof ORPCError && error.cause instanceof HostedUnanswered) return error.cause;
  if (error instanceof MalformedResponseError) {
    return new HostedUnanswered({ status: error.response.status, errorName: error.name });
  }
  return new HostedUnanswered(error instanceof Error ? { errorName: error.name } : {});
}

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

export function askHosted<Input, Output>(
  procedure: HostedProcedure<Input, Output>,
  input: Input,
  deadline: HostedDeadline = HOSTED_DEADLINE.USUAL,
  idempotencyKey?: string,
): Effect.Effect<Output, HostedFailure, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const sampled = (yield* Random.next) < SENTRY_TRACES_SAMPLE_RATE;
    const asked = Effect.gen(function* () {
      const span = yield* Effect.orDie(Effect.currentSpan);
      const services = yield* Effect.context<HttpClient.HttpClient>();
      return yield* Effect.mapError(
        procedure(input, {
          context: {
            services,
            deadline,
            ...(idempotencyKey === undefined ? undefined : { idempotencyKey }),
          },
        }),
        (error) => traced(hostedFailureOf(error), span.traceId),
      );
    });
    return yield* Effect.withSpan(asked, HOSTED_ASK_SPAN, { kind: "client", sampled });
  });
}

export function askLive<Input extends LivePollInput, Output>(
  procedure: HostedProcedure<Input, Output>,
  input: Input,
  poll: boolean,
  after: string | undefined,
  held = after !== undefined,
): Effect.Effect<Output, HostedFailure, HttpClient.HttpClient> {
  if (!poll) return askHosted(procedure, input);
  const polled: Input = {
    ...input,
    [LIVE_POLL.QUERY]: LIVE_POLL.ON,
    ...(after === undefined ? undefined : { [LIVE_POLL.AFTER]: after }),
  };
  return askHosted(procedure, polled, held ? HOSTED_DEADLINE.HELD : HOSTED_DEADLINE.USUAL);
}

interface LivePollInput {
  readonly [LIVE_POLL.QUERY]?: typeof LIVE_POLL.ON;
  readonly [LIVE_POLL.AFTER]?: string;
}
