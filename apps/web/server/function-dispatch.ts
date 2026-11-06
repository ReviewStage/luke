import type { Route } from "@repo/service/route";

export const DISPATCH_QUERY = {
  ROUTE: "route",
  PATH: "route-path",
} as const;

export const ORPC_ROUTE_KEY = "orpc";

const API_PREFIX = "/api/";

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
