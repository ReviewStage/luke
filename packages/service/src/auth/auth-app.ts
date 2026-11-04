import { Effect, Layer } from "effect";
import { type HttpMethod, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { hostedNotFoundRoute } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { recordAuthCount, withAuthCounts } from "./auth-counts.js";
import { AUTH_BASE_PATH } from "./auth-policy.js";

/**
 * The auth surface as the one route group this function serves: Better Auth's
 * own `fetch` handler, mounted on the path set `vercel.json` routes here.
 *
 * Better Auth owns every answer under that path — the endpoints, the
 * redirects, the cookies, and its own refusals — so the group holds it as a
 * passthrough rather than describing its endpoints: an `HttpApi` that
 * declared them would be a second copy of a contract Better Auth already
 * versions, and the first one to drift would be the one we ship.
 */

/** What every path `vercel.json`'s `/api/auth/(.*)` entry sends to this function begins with. */
export const AUTH_PATH_PREFIX = `${AUTH_BASE_PATH}/`;

/** The path set that entry sends to this function. */
const AUTH_PATH_SET = `${AUTH_PATH_PREFIX}*`;

/** The well-known names of the authorization server's metadata documents: RFC 8414's, and OpenID Connect Discovery's. */
const WELL_KNOWN_METADATA = {
  AUTHORIZATION_SERVER: "oauth-authorization-server",
  OPENID_CONFIGURATION: "openid-configuration",
} as const;

/** A public path of the authorization server's metadata, and the path under the auth base path the function is handed in its place. */
export interface AuthMetadataPath {
  readonly path: string;
  readonly carried: string;
}

/**
 * The authorization server's metadata, which an MCP client reads to find
 * the endpoints and what the server supports, at the two paths RFC 8414 §3
 * derives from the issuer, `${baseURL}/api/auth`: the well-known name ahead
 * of the issuer's path, and the issuer's path ahead of the well-known name.
 * The provider plugin answers the issuer-path form itself, on any request
 * that reaches Better Auth's handler, ahead of its endpoints, so the root
 * form is rewritten by `apps/web/server/function-rewrites.ts` onto this
 * function carrying the issuer-path form (`carried`), which the dispatcher
 * restores, and the issuer-path form is the auth path set's own. A document
 * says the same at either path.
 */
export const AUTH_SERVER_METADATA_PATHS: readonly AuthMetadataPath[] = Object.values(
  WELL_KNOWN_METADATA,
).map((name) => ({
  path: `/.well-known/${name}${AUTH_BASE_PATH}`,
  carried: `${AUTH_BASE_PATH}/.well-known/${name}`,
}));

/**
 * The method the web handler answers with no body, taking the status and the
 * headers from the `HttpServerResponse` rather than from the answer beneath it.
 */
const BODYLESS_METHOD = { HEAD: "HEAD" } as const satisfies Record<string, HttpMethod.HttpMethod>;

const RESPONSE_HEADER = { SET_COOKIE: "set-cookie" } as const;

/** A handler shaped the way the platform's own `fetch` is, which is what Better Auth exposes. */
export type WebRequestHandler = (request: Request) => Promise<Response>;

/**
 * A HEAD answer's status and headers, carried on the `HttpServerResponse`
 * because `HttpApp`'s web handler builds a HEAD response from those alone.
 *
 * `set-cookie` is left behind: the platform's own header record holds one
 * value per name, so two cookies would be joined into a byte no client asked
 * for, and a HEAD is not how Better Auth sets one.
 */
function bodylessAnswer(answer: Response): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.empty({
    status: answer.status,
    statusText: answer.statusText,
    headers: [...answer.headers].filter(([name]) => name !== RESPONSE_HEADER.SET_COOKIE),
  });
}

/**
 * The handler's own `Response`, answered unchanged.
 *
 * The request handed over is the very `Request` this edge was invoked with,
 * because the platform keeps the web request it was built from, and the
 * response travels back as a raw body, which the web handler answers with the
 * same object — status, headers, every `set-cookie`, and bytes as they came.
 *
 * Nothing is mirrored onto the `HttpServerResponse` beside it: the platform
 * writes an accompanying header record onto the answer's own `Headers`, and a
 * redirect's are immutable, so mirroring would refuse the very answers the
 * OAuth callbacks are made of. A HEAD is the exception the helper above
 * covers, since there the record is all the web handler reads.
 */
const authPassthrough = /* @__PURE__ */ Effect.fn("web/authPassthrough")(function* (
  handle: WebRequestHandler,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { answer, counts } = yield* Effect.promise(() => withAuthCounts(() => handle(request)));
  // Note that the counts run once Better Auth has answered, which is once what they count has committed.
  yield* Effect.forEach(counts, recordAuthCount, { discard: true });
  return incoming.method === BODYLESS_METHOD.HEAD
    ? bodylessAnswer(answer)
    : HttpServerResponse.raw(answer);
});

/**
 * The group, which is the passthrough on the auth path set and the hosted
 * vocabulary's own refusal anywhere else. Nothing routes another path to this
 * function, so the refusal says what the group declares rather than what a
 * caller can reach.
 */
export function authApp(handle: WebRequestHandler): WebRoutes<never> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, AUTH_PATH_SET, authPassthrough(handle)),
    hostedNotFoundRoute,
  );
}
