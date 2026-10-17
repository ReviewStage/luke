/**
 * origin-guard.ts -- refuses a state-changing request a browser's cookie carried from a page that is not this deployment's own.
 *
 * A browser can carry this deployment's cookies on a request another site's
 * page makes, a form it submits or a script's fetch, so a route that took
 * the cookie as the account could act for whoever wrote that page; a
 * cookie's SameSite holds back some of those requests, not every one in
 * every browser. What tells the two apart is the `Origin` a browser names on
 * a state-changing request, which no page can set: a request from one of
 * this deployment's own pages goes on to its route, and any other is refused
 * before a route reads the cookie at all. Where the browser named no origin,
 * a `Sec-Fetch-Site` of `same-origin`, which no page can set either, stands
 * in for it.
 *
 * Two kinds of request go on untouched: a safe method, which changes
 * nothing, and one that carries no cookie, which holds no session to ride
 * on; the desktop, the scheduled sweep, and the webhooks send none. An
 * `Authorization` header beside a cookie buys nothing, because Better Auth
 * reads the session from the cookie whenever that header is not a bearer it
 * signed, so a request carrying both is held to its origin like any other.
 *
 * The allowlist is the deployment's own origins (`authDeployment`'s
 * `ownOrigins`), and never Better Auth's `trustedOrigins`, which on
 * production trusts every preview and the dev server for the OAuth proxy.
 */

import { AUTH_PATH_PREFIX } from "../auth/auth-app.js";
import { authDeployment } from "../auth/auth-deployment.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";

/** The methods that change nothing, which the guard lets through whatever sent them. */
const SAFE_METHOD = { GET: "GET", HEAD: "HEAD", OPTIONS: "OPTIONS" } as const;

const SAFE_METHODS: ReadonlySet<string> = new Set(Object.values(SAFE_METHOD));

const REQUEST_HEADER = {
  COOKIE: "cookie",
  ORIGIN: "origin",
  FETCH_SITE: "sec-fetch-site",
} as const;

/** The `Sec-Fetch-Site` a browser sends with a request a page of the same origin made. */
const SAME_ORIGIN_FETCH = "same-origin";

/** Whether the request carries a cookie with something in it. */
function carriesCookie(request: Request): boolean {
  return (request.headers.get(REQUEST_HEADER.COOKIE) ?? "").trim() !== "";
}

/**
 * Whether the request is for Better Auth's own handler, which a foreign page
 * reaches on purpose: it checks a request's origin itself, against the
 * origins its OAuth proxy needs, and a provider returns a sign-in to it. The
 * path is matched as it is spelled, so one the router would still read as
 * the handler's, in another case or with a doubled slash, is guarded like
 * any other path.
 */
function betterAuthPath(request: Request): boolean {
  return new URL(request.url).pathname.startsWith(AUTH_PATH_PREFIX);
}

/**
 * Whether the browser said one of the deployment's own pages sent the
 * request. Note that a request naming an origin is held to it whatever its
 * `Sec-Fetch-Site` says, because that stands in only where no origin is named.
 */
function sentByOwnPage(request: Request, ownOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.get(REQUEST_HEADER.ORIGIN);
  if (origin !== null) return ownOrigins.has(origin);
  return request.headers.get(REQUEST_HEADER.FETCH_SITE) === SAME_ORIGIN_FETCH;
}

/** Whether the request is a state-changing one a cookie carried from a page the deployment does not serve. */
function crossSiteCookieRequest(request: Request, ownOrigins: ReadonlySet<string>): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  if (!carriesCookie(request)) return false;
  return !betterAuthPath(request) && !sentByOwnPage(request, ownOrigins);
}

/**
 * Says at warn what was refused: the path and the origin, each quoted, and
 * nothing else, so no query, cookie, or body the request carried reaches a
 * log.
 */
function reportRefusal(request: Request): void {
  const path = JSON.stringify(new URL(request.url).pathname);
  const origin = request.headers.get(REQUEST_HEADER.ORIGIN);
  const from = origin === null ? "no origin" : JSON.stringify(origin);
  console.warn(`Refused a cross-site cookie request to ${path} from ${from}.`);
}

/** The guard's answer to a request: the refusal, or nothing where the request goes on to its route. */
export type CookieOriginGuard = (request: Request) => Response | undefined;

/**
 * The guard over the deployment's own origins, as `authDeployment` reads
 * them from the environment record it is handed. The refusal is the hosted
 * vocabulary's own `not-permitted`, under its 403.
 */
export function cookieOriginGuard(
  variables: Record<string, string | undefined>,
): CookieOriginGuard {
  const ownOrigins: ReadonlySet<string> = new Set(authDeployment(variables).ownOrigins);
  return (request) => {
    if (!crossSiteCookieRequest(request, ownOrigins)) return undefined;
    reportRefusal(request);
    return errorResponse(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED);
  };
}
