import type { Route } from "@luke/service/route";

/**
 * The query parameters a `vercel.json` rewrite adds when it lands a client
 * path on a grouped function: the route key the request is for, and, where
 * the client path carried more than the key names (the auth catch-all), the
 * path to hand the route in the key's place. Note that the platform merges
 * them into the caller's own query and the dispatcher takes them back out,
 * so a name here is one no route may read: the path is `route-path` and not
 * `path`, because a File tab names its file in a `path` query, which the
 * dispatcher once read as the route's path and answered 404 for.
 */
export const DISPATCH_QUERY = {
  ROUTE: "route",
  PATH: "route-path",
} as const;

/**
 * The route key of the hosted oRPC route (`orpc-route.ts`), which no file
 * under `server/routes/` holds: the one route the fallback rewrite of
 * `function-rewrites.ts` lands every other `/api/` path on, which matches the
 * public path itself.
 */
export const ORPC_ROUTE_KEY = "orpc";

const API_PREFIX = "/api/";

/**
 * One function's fetch over the routes it groups. Vercel rewrites the client
 * path onto the function file, so the request arrives addressed to
 * `/api/<file>.js` with the route key beside the caller's own query; the
 * dispatcher restores the path the route was written against (`route-path`
 * where the rewrite carried one, the key otherwise), drops the two rewrite
 * parameters, and hands the route a request otherwise as it came.
 *
 * A key the function holds as a route of its own picks that route. Any other
 * request, the oRPC key's, one with no key, or one with a key the function
 * does not hold, is the oRPC route's where the function holds it, which
 * answers a path it does not match with its own JSON 404; the path it is
 * handed is `route-path` where one came, and the request's own otherwise. A
 * function without the oRPC route answers such a request 404 with no body.
 */
export function dispatchRoutes(routes: ReadonlyMap<string, Route>): Route {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const key = url.searchParams.get(DISPATCH_QUERY.ROUTE);
      const carried = url.searchParams.get(DISPATCH_QUERY.PATH);
      url.searchParams.delete(DISPATCH_QUERY.ROUTE);
      url.searchParams.delete(DISPATCH_QUERY.PATH);
      const member = key === null || key === ORPC_ROUTE_KEY ? undefined : routes.get(key);
      if (key !== null && member !== undefined) {
        url.pathname = `${API_PREFIX}${carried ?? key}`;
        return member.fetch(restoredRequest(url, request));
      }
      const orpc = routes.get(ORPC_ROUTE_KEY);
      if (orpc === undefined) return new Response(null, { status: 404 });
      if (carried !== null) url.pathname = `${API_PREFIX}${carried}`;
      return orpc.fetch(restoredRequest(url, request));
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
