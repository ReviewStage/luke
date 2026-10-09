import { Effect, type Layer, type Option, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiSchema } from "effect/unstable/httpapi";
import type { UnparsedWireValue } from "../core.js";
import { ANY_METHOD, ANY_PATH } from "../route.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";
import { logStoreFailure, type StoreFailure } from "./store-failure.js";

/**
 * The hosted response vocabulary as the schemas an `HttpApi` group declares
 * its answers from, answering the same statuses and the same bytes
 * `server/hosted/http.ts` answers with today. The two stand side by side
 * while the routes convert one group at a time, and the goldens in
 * `fixtures/hosted-refusal/` are what hold them to the same bytes.
 *
 * A refusal is declared as the body itself rather than as a
 * `Schema.TaggedError`: `error` is already the discriminant the desktop's
 * hosted clients read, and the `_tag` a tagged error encodes beside it would
 * be a byte those clients never asked for.
 */

/** The status each refusal is answered with, which is a function of the refusal alone. */
const HOSTED_REFUSAL_STATUS = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.METHOD_NOT_ALLOWED]: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
  [HOSTED_API_ERROR.NOT_FOUND]: HOSTED_HTTP_STATUS.NOT_FOUND,
  [HOSTED_API_ERROR.PROMPT_TOO_LARGE]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED]: HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS,
  [HOSTED_API_ERROR.UNKNOWN_TOOL]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.REQUEST_TOO_LARGE]: HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
  [HOSTED_API_ERROR.UNAVAILABLE]: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  [HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED]: HOSTED_HTTP_STATUS.FORBIDDEN,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: HOSTED_HTTP_STATUS.FORBIDDEN,
  [HOSTED_API_ERROR.NO_REPOSITORY]: HOSTED_HTTP_STATUS.CONFLICT,
} as const;

type HostedRefusalSlug = keyof typeof HOSTED_REFUSAL_STATUS;

function refusalSchema<Slug extends HostedRefusalSlug>(slug: Slug) {
  return Schema.Struct({ error: Schema.Literal(slug) }).pipe(
    HttpApiSchema.status(HOSTED_REFUSAL_STATUS[slug]),
  );
}

export const InvalidTokenRefusal = refusalSchema(HOSTED_API_ERROR.INVALID_TOKEN);
export const InvalidRequestRefusal = refusalSchema(HOSTED_API_ERROR.INVALID_REQUEST);
export const MethodNotAllowedRefusal = refusalSchema(HOSTED_API_ERROR.METHOD_NOT_ALLOWED);
export const NotFoundRefusal = refusalSchema(HOSTED_API_ERROR.NOT_FOUND);
export const PromptTooLargeRefusal = refusalSchema(HOSTED_API_ERROR.PROMPT_TOO_LARGE);
export const QuotaExhaustedRefusal = refusalSchema(HOSTED_API_ERROR.QUOTA_EXHAUSTED);
export const UnknownToolRefusal = refusalSchema(HOSTED_API_ERROR.UNKNOWN_TOOL);
export const RequestTooLargeRefusal = refusalSchema(HOSTED_API_ERROR.REQUEST_TOO_LARGE);
export const UnavailableRefusal = refusalSchema(HOSTED_API_ERROR.UNAVAILABLE);
export const GitHubSignInRequiredRefusal = refusalSchema(HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED);
export const RepositoryNotReachableRefusal = refusalSchema(
  HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
);
export const NoRepositoryRefusal = refusalSchema(HOSTED_API_ERROR.NO_REPOSITORY);

export type HostedRefusal = { readonly error: HostedRefusalSlug };

/**
 * Resolves the signed-in account behind what a request carries, or none.
 * Nothing distinguishes a missing header from an expired or revoked token on
 * purpose: every failure is one 401, and the desktop's refresh machinery is
 * what answers it. `Input` is the request itself, or the `Authorization`
 * value alone where it arrived somewhere other than on its own request.
 */
export type UserIdResolver<Input = Request> = (
  input: Input,
) => Effect.Effect<Option.Option<string>>;

/** The refusal values themselves, since not one of them carries a field. */
export const HOSTED_REFUSAL = {
  INVALID_TOKEN: { error: HOSTED_API_ERROR.INVALID_TOKEN },
  INVALID_REQUEST: { error: HOSTED_API_ERROR.INVALID_REQUEST },
  METHOD_NOT_ALLOWED: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
  /** A path the group the request reached declares no route for. */
  NOT_FOUND: { error: HOSTED_API_ERROR.NOT_FOUND },
  /** The prepared prompt is longer than the brain contract's own envelope; nothing was sent upstream. */
  PROMPT_TOO_LARGE: { error: HOSTED_API_ERROR.PROMPT_TOO_LARGE },
  QUOTA_EXHAUSTED: { error: HOSTED_API_ERROR.QUOTA_EXHAUSTED },
  /** A tool name the brain contract's catalog does not register; no schema was selected. */
  UNKNOWN_TOOL: { error: HOSTED_API_ERROR.UNKNOWN_TOOL },
  REQUEST_TOO_LARGE: { error: HOSTED_API_ERROR.REQUEST_TOO_LARGE },
  UNAVAILABLE: { error: HOSTED_API_ERROR.UNAVAILABLE },
  /** The account must sign in with GitHub again before the Luke GitHub App can read for it. */
  GITHUB_SIGN_IN_REQUIRED: { error: HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED },
  /** The App reaches no such repository for the account; nothing was written. */
  REPOSITORY_NOT_REACHABLE: { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE },
  /** The plan names no repository, so no coding agent can be started on it; nothing was written. */
  NO_REPOSITORY: { error: HOSTED_API_ERROR.NO_REPOSITORY },
} as const satisfies Record<string, HostedRefusal>;

/**
 * A store read or write the handler cannot answer without: its failure is
 * logged and the request is refused as unavailable, since a database the
 * service cannot reach is an outage the caller may retry and not a defect of
 * the route. `mapError` touches the typed channel alone, so an interruption
 * of the request's fiber passes through untouched.
 */
export function hostedStoreOrUnavailable<A, R>(
  effect: Effect.Effect<A, StoreFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError(logStoreFailure),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
}

/** An endpoint's refusal carried back onto the answer channel, so a group registers a route that answers every request. */
export function hostedRefusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

/** A refusal as the response an `HttpApp` answers with outside an `HttpApi` group. */
export function hostedRefusalResponse(
  refusal: HostedRefusal,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(refusal, {
    status: HOSTED_REFUSAL_STATUS[refusal.error],
  });
}

/**
 * The route every hosted group registers last: the hosted vocabulary's own
 * `not-found` for a path the group declares no route of its own for. The
 * router reaches a wildcard only once every declared path has failed to
 * match, so this answers exactly what the router's own `RouteNotFound` stood
 * for before the routes became a layer — and, since it is a route like any
 * other, it answers it as the group's own refusal rather than as the empty
 * 404 an unhandled `RouteNotFound` would become.
 */
export const hostedNotFoundRoute: Layer.Layer<never, never, HttpRouter.HttpRouter> = HttpRouter.add(
  ANY_METHOD,
  ANY_PATH,
  hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND),
);

const HTTP_METHOD = { HEAD: "HEAD" } as const;

/**
 * A HEAD answer's status and headers, carried on the `HttpServerResponse`
 * because the platform's web handler builds a HEAD response from those alone
 * rather than from the raw answer beneath them — the same reason
 * `auth-app.ts`'s passthrough carries a HEAD this way.
 */
function bodylessAnswer(answer: Response): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.empty({
    status: answer.status,
    statusText: answer.statusText,
    headers: [...answer.headers],
  });
}

/**
 * A handler's answer, carried to the `HttpApp` a group composes: the handler
 * already answers the hosted vocabulary's own bytes, so nothing here reads or
 * rewrites the response beside forwarding it, except a HEAD, whose status and
 * headers the web handler reads off the `HttpServerResponse` rather than the
 * raw answer it wraps. The handler runs on the group's own fiber rather than
 * through a runner of its own, so a failed statement it reads is a defect
 * here.
 */
export const effectPassthrough = /* @__PURE__ */ Effect.fn("web/effectPassthrough")(function* <R>(
  handle: (request: Request) => Effect.Effect<Response, unknown, R>,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  R | HttpServerRequest.HttpServerRequest
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const answer = yield* Effect.orDie(handle(request));
  return incoming.method === HTTP_METHOD.HEAD
    ? bodylessAnswer(answer)
    : HttpServerResponse.raw(answer);
});

/** An answer as the response, the way `jsonResponse` answers one today. */
export function hostedJsonResponse<Body extends object>(
  status: number,
  body: Body,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(body, { status });
}

/** Refuses a request whose method is not the one the endpoint documents. */
export function hostedMethod(
  method: string,
): Effect.Effect<void, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    request.method === method ? Effect.void : Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED),
  );
}

/**
 * The request's JSON body as the unparsed wire value a schema reads next.
 * The stream is counted as it arrives rather than trusting a Content-Length
 * the sender may omit or misstate, and is left the moment the bound is
 * passed, so an oversized request is never held whole.
 */
export const readJsonBodyEffect = /* @__PURE__ */ Effect.fn("web/readJsonBodyEffect")(function* (
  maximumBytes: number,
): Effect.fn.Return<UnparsedWireValue, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const chunks: Uint8Array[] = [];
  let counted = 0;
  const received = yield* Stream.runForEachWhile(request.stream, (chunk) => {
    chunks.push(chunk);
    counted += chunk.byteLength;
    return Effect.succeed(counted <= maximumBytes);
  }).pipe(
    Effect.map(() => counted),
    Effect.mapError((): HostedRefusal => HOSTED_REFUSAL.INVALID_REQUEST),
  );
  if (received > maximumBytes) return yield* Effect.fail(HOSTED_REFUSAL.REQUEST_TOO_LARGE);
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return yield* Effect.try({
    // SAFETY: JSON.parse answers a runtime value; the endpoint's schema is what holds it to a shape.
    try: () =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as UnparsedWireValue,
    catch: () => HOSTED_REFUSAL.INVALID_REQUEST,
  });
});
