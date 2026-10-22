/**
 * platform-landing.ts -- a client's request as the platform and a grouped function hand it to a route, for the tests that hold a client's URL to the route it means.
 *
 * Vercel serves an `/api/` path by the first rewrite of the committed table
 * (`server/api-rewrites.json`) whose pattern matches the whole path, writes
 * the pattern's groups into the destination, and merges the caller's own
 * query after the destination's; the grouped function's dispatcher then
 * restores the path the route was written against. A test that went
 * straight to the route would walk past both, which is how a File tab whose
 * every read answered 404 on production stayed green here.
 */

import { join } from "node:path";
import type { Route } from "@luke/service/route";
import { dispatchRoutes } from "../../server/function-dispatch";
import { type Rewrite, readApiRewritesTable } from "../../server/function-rewrites";

const WEB = join(import.meta.dirname, "..", "..");

/** The client's request as it arrives at its function: rewritten by the table given, its own query, headers, and body kept. */
function landed(request: Request, rewrites: readonly Rewrite[]): Request {
  const asked = new URL(request.url);
  for (const rewrite of rewrites) {
    const pattern = new RegExp(`^${rewrite.src}$`);
    if (!pattern.test(asked.pathname)) continue;
    const url = new URL(asked.pathname.replace(pattern, rewrite.dest), asked.origin);
    for (const [name, value] of asked.searchParams) url.searchParams.append(name, value);
    if (request.body === null)
      return new Request(url, { method: request.method, headers: request.headers });
    const streaming: RequestInit & { readonly duplex: "half" } = {
      method: request.method,
      headers: request.headers,
      body: request.body,
      duplex: "half",
    };
    return new Request(url, streaming);
  }
  throw new Error(`no rewrite serves ${asked.pathname}`);
}

/** The client's request answered by the routes given, grouped as one function, after the platform landed it there. */
export async function dispatched(
  request: Request,
  routes: ReadonlyMap<string, Route>,
): Promise<Response> {
  return dispatchedBy(await readApiRewritesTable(WEB), request, routes);
}

/** The client's request answered by the routes given, after the platform landed it by the rewrites given rather than the committed table's. */
export function dispatchedBy(
  rewrites: readonly Rewrite[],
  request: Request,
  routes: ReadonlyMap<string, Route>,
): Promise<Response> {
  return dispatchRoutes(routes).fetch(landed(request, rewrites));
}
