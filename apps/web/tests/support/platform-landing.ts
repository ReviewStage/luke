import { join } from "node:path";
import type { Route } from "@repo/service/route";
import { dispatchRoutes } from "../../server/function-dispatch";
import { type Rewrite, readApiRewritesTable } from "../../server/function-rewrites";
import { landed, landingRule } from "../../server/platform-landing";

const WEB = join(import.meta.dirname, "..", "..");

export async function dispatched(
  request: Request,
  routes: ReadonlyMap<string, Route>,
): Promise<Response> {
  return dispatchedBy(await readApiRewritesTable(WEB), request, routes);
}

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
