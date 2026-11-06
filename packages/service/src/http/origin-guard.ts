import { AUTH_PATH_PREFIX } from "../auth/auth-app.js";
import { authDeployment } from "../auth/auth-deployment.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";

const SAFE_METHOD = { GET: "GET", HEAD: "HEAD", OPTIONS: "OPTIONS" } as const;

const SAFE_METHODS: ReadonlySet<string> = new Set(Object.values(SAFE_METHOD));

const REQUEST_HEADER = {
  COOKIE: "cookie",
  ORIGIN: "origin",
  FETCH_SITE: "sec-fetch-site",
} as const;

const SAME_ORIGIN_FETCH = "same-origin";

function carriesCookie(request: Request): boolean {
  return (request.headers.get(REQUEST_HEADER.COOKIE) ?? "").trim() !== "";
}

function betterAuthPath(request: Request): boolean {
  return new URL(request.url).pathname.startsWith(AUTH_PATH_PREFIX);
}

function sentByOwnPage(request: Request, ownOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.get(REQUEST_HEADER.ORIGIN);
  if (origin !== null) return ownOrigins.has(origin);
  return request.headers.get(REQUEST_HEADER.FETCH_SITE) === SAME_ORIGIN_FETCH;
}

function crossSiteCookieRequest(request: Request, ownOrigins: ReadonlySet<string>): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  if (!carriesCookie(request)) return false;
  return !betterAuthPath(request) && !sentByOwnPage(request, ownOrigins);
}

function reportRefusal(request: Request): void {
  const path = JSON.stringify(new URL(request.url).pathname);
  const origin = request.headers.get(REQUEST_HEADER.ORIGIN);
  const from = origin === null ? "no origin" : JSON.stringify(origin);
  console.warn(`Refused a cross-site cookie request to ${path} from ${from}.`);
}

export type CookieOriginGuard = (request: Request) => Response | undefined;

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
