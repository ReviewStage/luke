/**
 * platform-landing.ts -- a client's request as the platform and a grouped function hand it to a route, for the tests that hold a client's URL to the route it means.
 *
 * The platform's half is the server's own replay of the rewrite table
 * (`server/platform-landing.ts`), which the local server answers through as
 * well; the grouped function's half is its dispatcher.
 */

import { join } from "node:path";
import type { Route } from "@repo/service/route";
import { dispatchRoutes } from "../../server/function-dispatch";
import { type Rewrite, readApiRewritesTable } from "../../server/function-rewrites";
import { landed, landingRule } from "../../server/platform-landing";

const WEB = join(import.meta.dirname, "..", "..");

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
  const pathname = new URL(request.url).pathname;
  const rule = landingRule(pathname, rewrites);
  if (rule === undefined) throw new Error(`no rewrite serves ${pathname}`);
  return dispatchRoutes(routes).fetch(landed(request, rule));
}
