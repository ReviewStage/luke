import type { TaskArchived } from "@luke/database/models/task-store";
import type { RepositoryUnreached } from "@luke/features/repository-reach-wire";
import { type Cause, Effect, type Layer, type Option, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { UnparsedWireValue } from "../core.js";
import { ANY_METHOD, ANY_PATH } from "../route.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";
import { logStoreFailure, type StoreFailure } from "./store-failure.js";

/**
 * The hosted response vocabulary as an `HttpRouter` answers it, with the same
 * statuses and the same bodies `http.ts` answers with. A JSON answer here also
 * carries `cache-control: private, no-store`, which `http.ts` does not send.
 *
 * A refusal is the body itself rather than a `Schema.TaggedError`: `error` is
 * already the discriminant the desktop's hosted clients read, and the `_tag` a
 * tagged error encodes beside it would be a byte those clients never asked for.
 */

/**
 * What every hosted JSON answer is cached under: an answer is one account's
 * data, so neither a browser nor a shared cache on the way may keep a copy,
 * which matters once a browser reads it on a cookie.
 */
const HOSTED_CACHE_CONTROL = "private, no-store";

/** The status each refusal is answered with, which is a function of the refusal alone. */
export const HOSTED_REFUSAL_STATUS = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.METHOD_NOT_ALLOWED]: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
  [HOSTED_API_ERROR.NOT_FOUND]: HOSTED_HTTP_STATUS.NOT_FOUND,
  [HOSTED_API_ERROR.PROMPT_TOO_LARGE]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED]: HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS,
  [HOSTED_API_ERROR.UNKNOWN_TOOL]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.REQUEST_TOO_LARGE]: HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
  [HOSTED_API_ERROR.UNAVAILABLE]: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  [HOSTED_API_ERROR.UPSTREAM_ERROR]: HOSTED_HTTP_STATUS.BAD_GATEWAY,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: HOSTED_HTTP_STATUS.FORBIDDEN,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: HOSTED_HTTP_STATUS.BAD_GATEWAY,
  [HOSTED_API_ERROR.NO_REPOSITORY]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.BRANCH_NOT_FOUND]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.MESSAGE_TOO_LONG]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.AGENT_RETIRED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.TASK_ARCHIVED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.NOT_PERMITTED]: HOSTED_HTTP_STATUS.FORBIDDEN,
  [HOSTED_API_ERROR.ALREADY_INVITED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.SANDBOX_STOPPED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.LINEAR_UNAVAILABLE]: HOSTED_HTTP_STATUS.CONFLICT,
} as const;

type HostedRefusalSlug = keyof typeof HOSTED_REFUSAL_STATUS;

/** A refusal: its slug, and for a repository out of reach, why (`repositoryNotReachable`). */
export type HostedRefusal = {
  readonly error: HostedRefusalSlug;
  readonly unreached?: RepositoryUnreached;
};

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

/** A Better Auth session's account, or none; a failure is the auth service's, not a signed-out caller. */
export type SessionUserIdResolver = (
  request: Request,
) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;

/** The refusal values themselves, each bare; a repository out of reach carries its reason through `repositoryNotReachable`. */
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
  /** What this service asks on the caller's behalf, a terminal's sandbox, refused or did not answer; nothing was changed, and a retry may be taken. */
  UPSTREAM_ERROR: { error: HOSTED_API_ERROR.UPSTREAM_ERROR },
  /** The workspace's GitHub installation reaches no such repository, or it has none; nothing was written. */
  REPOSITORY_NOT_REACHABLE: { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE },
  /** GitHub did not answer whether the workspace reaches the repository; nothing was written, and a retry may be taken. */
  GITHUB_UNANSWERED: { error: HOSTED_API_ERROR.GITHUB_UNANSWERED },
  /** The task names no repository, so no coding agent can be started on it; nothing was written. */
  NO_REPOSITORY: { error: HOSTED_API_ERROR.NO_REPOSITORY },
  /** The branch a coding agent was asked to start on is none of the repository's; nothing was written. */
  BRANCH_NOT_FOUND: { error: HOSTED_API_ERROR.BRANCH_NOT_FOUND },
  /** The message to a coding agent spells more than the wire's bound; nothing was sent. */
  MESSAGE_TOO_LONG: { error: HOSTED_API_ERROR.MESSAGE_TOO_LONG },
  /** The agent's session is still coming up; the same message a moment later is taken. */
  AGENT_NOT_READY: { error: HOSTED_API_ERROR.AGENT_NOT_READY },
  /** eve no longer runs the agent's session, so nothing reaches its sandbox again; nothing was written. */
  AGENT_RETIRED: { error: HOSTED_API_ERROR.AGENT_RETIRED },
  /** The task is archived, so it takes nothing until it is brought back; nothing was written. */
  TASK_ARCHIVED: { error: HOSTED_API_ERROR.TASK_ARCHIVED },
  /** The account's role in the workspace does not allow this; nothing was written. */
  NOT_PERMITTED: { error: HOSTED_API_ERROR.NOT_PERMITTED },
  /** The address is already a member of the workspace, or already invited to it; nothing was sent. */
  ALREADY_INVITED: { error: HOSTED_API_ERROR.ALREADY_INVITED },
  /** The coding agent's sandbox is stopped, so no shell starts in it until the developer resumes it; nothing was started. */
  SANDBOX_STOPPED: { error: HOSTED_API_ERROR.SANDBOX_STOPPED },
  /** The workspace's Linear could not be read: none connected, its grant refused, or no such issue; nothing was written. */
  LINEAR_UNAVAILABLE: { error: HOSTED_API_ERROR.LINEAR_UNAVAILABLE },
} as const satisfies Record<string, HostedRefusal>;

/** The repository out of reach, with why, so the desktop can offer what mends it. */
export function repositoryNotReachable(unreached: RepositoryUnreached): HostedRefusal {
  return { ...HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE, unreached };
}

/**
 * Refuses, as unauthenticated, a request that carries no `Authorization`:
 * one that only a browser's session cookie could name. A request that
 * carries one is read by its bearer alone (`auth/bearer.ts`'s
 * `requestUserId`), so an endpoint asks for this where its work reaches eve
 * as the developer over that bearer and must not go on without it: a
 * delete ends the eve sessions of what it deletes (`agents/retire-sessions.ts`),
 * and a refusal there goes unnoticed. Note that the endpoint asks for it
 * itself rather than its route file handing the group a bearer-only
 * resolver, because every function holding a group answers every path the
 * group declares (`apps/web/server/function-dispatch.ts`).
 */
export function hostedBearerOnly(request: Request): Effect.Effect<void, HostedRefusal> {
  return request.headers.has("authorization")
    ? Effect.void
    : Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
}

/**
 * The headers bytes a member, an agent, or GitHub wrote are served under
 * beside the type the service checked them to be: a task's picture, an
 * inbox attachment, a picture a tool answered, a workspace's photo, and an
 * image GitHub's rendering of a pull request names. The browser is told not
 * to sniff them for another type; nothing on the way may keep a copy, since
 * they are one account's or one workspace's; and a document a browser opens
 * from them runs no script, loads nothing, and stands in an origin of its
 * own (`sandbox`). Note that the policy is what keeps markup among them, an
 * SVG's, from acting as this origin, because every account route takes the
 * browser's session cookie (`auth/bearer.ts`'s `resolveHostedUserId`) and a
 * tab opened on one of these paths carries it.
 */
export const HOSTED_BYTES_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
} as const;

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

/**
 * A task write an archive may refuse: the archive answered as its own
 * refusal, and a store failure as `hostedStoreOrUnavailable` answers one.
 */
export function hostedStoreOrArchived<A, R>(
  effect: Effect.Effect<A, StoreFailure | TaskArchived, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(
    effect,
    (failure): Effect.Effect<never, HostedRefusal> =>
      "_tag" in failure && failure._tag === "TaskArchived"
        ? Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED)
        : hostedStoreOrUnavailable(Effect.fail(failure)),
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

/**
 * An answer as the response, the way `jsonResponse` answers one today, under
 * `private, no-store`.
 */
export function hostedJsonResponse<Body extends object>(
  status: number,
  body: Body,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": HOSTED_CACHE_CONTROL },
  });
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
 * The request's body as the bytes it arrived as. The stream is counted as it
 * arrives rather than trusting a Content-Length the sender may omit or
 * misstate, and is left the moment the bound is passed, so an oversized
 * request is never held whole.
 */
export const readBodyBytesEffect = /* @__PURE__ */ Effect.fn("web/readBodyBytesEffect")(function* (
  maximumBytes: number,
): Effect.fn.Return<Uint8Array, HostedRefusal, HttpServerRequest.HttpServerRequest> {
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
  return joined;
});

/** Bytes read as UTF-8 JSON, the unparsed wire value a schema reads next; anything else is an invalid request. */
export function parseJsonBytes(bytes: Uint8Array): Effect.Effect<UnparsedWireValue, HostedRefusal> {
  return Effect.try({
    // SAFETY: JSON.parse answers a runtime value; the endpoint's schema is what holds it to a shape.
    try: () =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as UnparsedWireValue,
    catch: () => HOSTED_REFUSAL.INVALID_REQUEST,
  });
}

/** The request's JSON body as the unparsed wire value a schema reads next, bounded as `readBodyBytesEffect` bounds it. */
export const readJsonBodyEffect = /* @__PURE__ */ Effect.fn("web/readJsonBodyEffect")(function* (
  maximumBytes: number,
): Effect.fn.Return<UnparsedWireValue, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  return yield* parseJsonBytes(yield* readBodyBytesEffect(maximumBytes));
});
