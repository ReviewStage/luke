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
 * Three kinds of request go on untouched: a safe method, which changes
 * nothing; one that carries no cookie, which holds no session to ride on;
 * and one that carries an `Authorization` header, because the desktop names
 * its account there and sends no `Origin`, and a browser never attaches that
 * header to a request on its own.
 *
 * The allowlist is the deployment's own origins (`authDeployment`'s
 * `ownOrigins`), and never Better Auth's `trustedOrigins`, which on
 * production trusts every preview and the dev server for the OAuth proxy.
 */

import { HOSTED_SERVICE_PATH } from "@luke/features";
import { AUTH_PATH_PREFIX } from "../auth/auth-app.js";
import { authDeployment } from "../auth/auth-deployment.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";

/** The methods that change nothing, which the guard lets through whatever sent them. */
const SAFE_METHOD = { GET: "GET", HEAD: "HEAD", OPTIONS: "OPTIONS" } as const;

const SAFE_METHODS: ReadonlySet<string> = new Set(Object.values(SAFE_METHOD));

const REQUEST_HEADER = {
  AUTHORIZATION: "authorization",
  COOKIE: "cookie",
  ORIGIN: "origin",
  FETCH_SITE: "sec-fetch-site",
} as const;

/** The `Sec-Fetch-Site` a browser sends with a request a page of the same origin made. */
const SAME_ORIGIN_FETCH = "same-origin";

/**
 * Where a provider sends the browser back to finish a connect, from its own
 * site: GitHub to the App's Setup URL and to its authorization callback,
 * Vercel Connect to an integration's return and a workspace's Linear return.
 * Each is admitted by the connect's own `state` and never by the cookie, and
 * answers any method as it answers the GET the guard lets through anyway, so
 * a provider that returned the browser with a POST lands as a GET does.
 */
const PROVIDER_RETURN_PATHS: ReadonlySet<string> = new Set([
  HOSTED_SERVICE_PATH.GITHUB_INSTALLED,
  HOSTED_SERVICE_PATH.GITHUB_INSTALLED_AUTHORIZED,
  HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED,
  HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECTED,
]);

/** Whether the request carries the header with something in it. */
function carries(request: Request, name: string): boolean {
  return (request.headers.get(name) ?? "").trim() !== "";
}

/**
 * Whether the request's path is one a foreign page reaches on purpose:
 * Better Auth's own handler, which checks a request's origin itself against
 * the origins its OAuth proxy needs and is where a provider returns a sign-in
 * to, or a provider's return. The path is matched as it is spelled, so one
 * the router would still read as one of these, in another case or with a
 * trailing slash, is guarded like any other path.
 */
function crossSitePath(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return pathname.startsWith(AUTH_PATH_PREFIX) || PROVIDER_RETURN_PATHS.has(pathname);
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
  if (carries(request, REQUEST_HEADER.AUTHORIZATION)) return false;
  if (!carries(request, REQUEST_HEADER.COOKIE)) return false;
  return !crossSitePath(request) && !sentByOwnPage(request, ownOrigins);
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
  return (request) =>
    crossSiteCookieRequest(request, ownOrigins)
      ? errorResponse(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED)
      : undefined;
}
