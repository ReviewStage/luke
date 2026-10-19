/**
 * hosted-link.ts -- the hosted contract's oRPC client, carried by the one account call.
 *
 * An `OpenAPILink` over `hostedContract` whose transport is `accountCall`'s
 * `send`, so everything that call owns stays its own: the credential read
 * fresh for every attempt, the one renew-and-retry of a 401 while the
 * holder stands, the no-credential fault, the deadline, and the ambient
 * `HttpClient` a test fakes with `fakeCloudApi`. Wrapped in
 * `createEffectClient`, so a procedure is a lazy Effect.
 *
 * The link reads the wire as the service writes it (`contract/errors.ts`):
 * a success is the output's wire schema encoded, so it is decoded here with
 * that schema, a key a newer service added dropped as `readServiceAnswer`
 * drops one; a refusal is `{ error: slug, ...data }`, read into the slug
 * and the fields its declared error carries.
 *
 * Note that the link's transport is a promise door: oRPC calls `fetch` and
 * awaits it, so the account call is run there, on the services the calling
 * fiber handed over through the link's client context (`askHosted`), never
 * on a runtime of its own. The fake `HttpClient` and `TestClock` a test
 * provides are therefore the ones the call runs under, and an interrupted
 * caller aborts the run.
 */

import { HTTP_METHOD, type HttpMethod, type UnparsedWireValue } from "@luke/wire";
import { type Client, createORPCClient, ORPCError } from "@orpc/client";
import {
  type AnySchema,
  getProcedureContractOrThrow,
  type InferSchemaInput,
  type ProcedureContract,
} from "@orpc/contract";
import { createEffectClient, type EffectClient } from "@orpc/experimental-effect";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { Cause, type Context, Data, Effect, Exit, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  accountCall,
  type CALL_FAULT,
  type CallCredential,
  type CallRequest,
  callAnswered,
} from "./account-call.js";
import { repositoryNotReachableDataSchema } from "./contract/errors.js";
import { hostedContract } from "./contract/index.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";

/**
 * The deadlines a procedure is asked under, by how long its answer may
 * take: the usual one, a held read the service keeps open for as long as it
 * waits on the next change (or a dictated clip the model hears through),
 * and a Start, which may copy another agent's work before it answers.
 */
export const HOSTED_DEADLINE = {
  USUAL: "usual",
  HELD: "held",
  START: "start",
} as const;

export type HostedDeadline = (typeof HOSTED_DEADLINE)[keyof typeof HOSTED_DEADLINE];

/**
 * The deadlines longer than the usual one, which is the account call's own
 * default or the one a client keeps: a held read's is the service's hold and
 * room for the answer to travel after it, and a Start's outlasts the copy.
 */
const LONG_DEADLINE_MS = {
  [HOSTED_DEADLINE.HELD]: 35_000,
  [HOSTED_DEADLINE.START]: 120_000,
} as const satisfies Record<Exclude<HostedDeadline, typeof HOSTED_DEADLINE.USUAL>, number>;

/** The content type the link names a JSON body with, which the account call writes itself. */
const CONTENT_TYPE_HEADER = "content-type";

/** What one ask hands the link: the caller's own services to run the call on, and its deadline. */
interface HostedLinkContext {
  readonly services: Context.Context<HttpClient.HttpClient>;
  readonly deadline: HostedDeadline;
}

/** The fields a refusal carries beside its slug, by the declared error that carries them. */
type HostedRefusalData = typeof repositoryNotReachableDataSchema.Type;

/** The service refused the procedure: its slug, and the fields its declared error carries where they read. */
export class HostedRefused extends Data.TaggedError("HostedRefused")<{
  readonly refusal: HostedApiError;
  readonly data?: HostedRefusalData;
}> {}

/**
 * The procedure reached no answer the link could read: the call ended before
 * any status (no credential, the holder changed, the network, the deadline),
 * or the service answered something that is neither its output nor a
 * declared refusal. A fault names which; the error's kind is a name, never
 * its words, which could carry a credential.
 */
export class HostedUnanswered extends Data.TaggedError("HostedUnanswered")<{
  readonly fault?: (typeof CALL_FAULT)[keyof typeof CALL_FAULT];
  readonly errorName?: string;
}> {}

export type HostedFailure = HostedRefused | HostedUnanswered;

/**
 * Each procedure as the link answers it: the output as the wire schema
 * decodes it, so its type is the schema's own (the contract declares the
 * schema flipped, which oRPC would read as the encoded side).
 */
type HostedLinkClient<Router> =
  Router extends ProcedureContract<infer InputSchema, infer OutputSchema, infer _Errors>
    ? Client<
        HostedLinkContext,
        InferSchemaInput<InputSchema>,
        InferSchemaInput<OutputSchema>,
        unknown
      >
    : { readonly [Key in keyof Router]: HostedLinkClient<Router[Key]> };

/** Every hosted procedure, one lazy Effect each. */
export type HostedClient = EffectClient<HostedLinkClient<typeof hostedContract>>;

/** One procedure of the client, asked with its input and the link's context. */
export type HostedProcedure<Input, Output> = (
  input: Input,
  options: { readonly context: HostedLinkContext },
) => Effect.Effect<Output, unknown>;

export interface HostedClientOptions {
  /** The service origin; any trailing separator is trimmed once. */
  baseUrl: string;
  credential: CallCredential;
  /** The usual deadline, where a client keeps one of its own. */
  requestTimeoutMs?: number | undefined;
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
 * its slug and the fields its declared error carries; a repository out of
 * reach whose reason this build cannot read is the bare refusal. Anything
 * else is no refusal, which oRPC then reads as a malformed answer.
 */
function refusalOf(payload: UnparsedWireValue): HostedRefused | undefined {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  if (refusal === undefined) return undefined;
  if (refusal !== HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE) return new HostedRefused({ refusal });
  const data = Result.getOrUndefined(readServiceAnswer(repositoryNotReachableDataSchema)(payload));
  return new HostedRefused({ refusal, ...(data === undefined ? undefined : { data }) });
}

/**
 * Whether a contract's schema is an Effect Schema, which every hosted
 * procedure's is; a wire schema decodes and encodes with no service, which
 * is what the narrowing states beyond what `Schema.isSchema` checks.
 */
function isWireSchema(
  schema: AnySchema | undefined,
): schema is AnySchema & Schema.Codec<unknown, unknown> {
  return Schema.isSchema(schema);
}

/** The wire schema a procedure's output is decoded with: the one its contract declares, flipped back. */
function outputWireSchema(path: readonly string[]): Schema.Codec<unknown> | undefined {
  const [declared] = getProcedureContractOrThrow(hostedContract, path)["~orpc"].outputSchemas ?? [];
  return isWireSchema(declared) ? Schema.flip(declared) : undefined;
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
  const exit = await Effect.runPromiseExitWith(context.services)(
    call.send(callRequest(url, init)),
    init.signal ? { signal: init.signal } : undefined,
  );
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  const answer = exit.value;
  if (callAnswered(answer)) return answer.response;
  throw new HostedUnanswered({
    fault: answer.fault,
    ...(answer.errorName === undefined ? undefined : { errorName: answer.errorName }),
  });
}

/** The hosted contract's client over the account call. */
export function hostedClient(options: HostedClientOptions): HostedClient {
  const link = new OpenAPILink<HostedLinkContext>(hostedContract, {
    fetch: (url, init, call) => sent(options, url, init, call.context),
    customErrorResponseBodyDecoder: (body) => {
      // SAFETY: the link's serializer read the body out of the response's JSON text.
      const refused = refusalOf(body as UnparsedWireValue);
      return refused === undefined ? null : new ORPCError(refused.refusal, { cause: refused });
    },
    interceptors: [
      async ({ next, path }) => {
        const output = await next();
        const wire = outputWireSchema(path);
        if (wire === undefined) return output;
        // SAFETY: the link's serializer read the output out of the response's JSON text.
        const read = readServiceAnswer(wire)(output as UnparsedWireValue);
        if (Result.isFailure(read)) throw new HostedUnanswered({});
        return read.success;
      },
    ],
  });
  return createEffectClient(createORPCClient<HostedLinkClient<typeof hostedContract>>(link));
}

/**
 * One procedure asked on the calling fiber's own services, under the
 * deadline named: its output, or why there was none.
 */
export function askHosted<Input, Output>(
  procedure: HostedProcedure<Input, Output>,
  input: Input,
  deadline: HostedDeadline = HOSTED_DEADLINE.USUAL,
): Effect.Effect<Output, HostedFailure, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const services = yield* Effect.context<HttpClient.HttpClient>();
    return yield* Effect.mapError(
      procedure(input, { context: { services, deadline } }),
      (error): HostedFailure => {
        if (error instanceof HostedUnanswered) return error;
        if (error instanceof ORPCError && error.cause instanceof HostedRefused) return error.cause;
        return new HostedUnanswered({});
      },
    );
  });
}
