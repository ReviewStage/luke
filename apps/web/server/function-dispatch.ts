import type { Route } from "./route.js";

/**
 * The query parameters a `vercel.json` rewrite adds when it lands a client
 * path on a grouped function: the route key the request is for, and, where
 * the client path carried more than the key names (the auth catch-all), the
 * path to hand the route in the key's place.
 */
export const DISPATCH_QUERY = {
  ROUTE: "route",
  PATH: "path",
} as const;

const API_PREFIX = "/api/";

/**
 * One function's fetch over the routes it groups. Vercel rewrites the client
 * path onto the function file, so the request arrives addressed to
 * `/api/<file>.js` with the route key beside the caller's own query; the
 * dispatcher restores the path the route was written against, drops the two
 * rewrite parameters, and hands the route a request otherwise as it came. A
 * key the function does not hold is a 404, which is what the platform would
 * have answered had the route not existed.
 */
export function dispatchRoutes(routes: ReadonlyMap<string, Route>): Route {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const key = url.searchParams.get(DISPATCH_QUERY.ROUTE);
      const route = key === null ? undefined : routes.get(key);
      if (key === null || route === undefined) return new Response(null, { status: 404 });
      const path = url.searchParams.get(DISPATCH_QUERY.PATH) ?? key;
      url.searchParams.delete(DISPATCH_QUERY.ROUTE);
      url.searchParams.delete(DISPATCH_QUERY.PATH);
      url.pathname = `${API_PREFIX}${path}`;
      return route.fetch(restoredRequest(url, request));
    },
  };
}

/** Node's fetch takes a streamed body only with `duplex` said in as many words, which the DOM's `RequestInit` has no field for. */
type StreamingRequestInit = RequestInit & { readonly duplex?: "half" };

function restoredRequest(url: URL, request: Request): Request {
  const init: StreamingRequestInit = {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  };
  if (request.body === null) return new Request(url, init);
  const streaming: StreamingRequestInit = { ...init, body: request.body, duplex: "half" };
  return new Request(url, streaming);
}
