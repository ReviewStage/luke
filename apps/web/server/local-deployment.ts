/**
 * local-deployment.ts -- the deployment's functions as the local server serves them: each grouped function's dispatcher over its own route modules, reached by the committed rewrite table as Vercel reaches it.
 *
 * A grouped function's bundle is a generated entry that imports each member
 * route and hands them to `dispatchRoutes` (`function-bundles.ts`); this
 * builds the same dispatchers over the same modules, imported where they
 * stand, and lands each request on one by the same table
 * (`platform-landing.ts`), so a path answers here as it does on the
 * deployment. The two WebSocket functions are not served: they relay a
 * cloud sandbox's terminal and Browser tab, which a local run has none of,
 * and export the `http.Server` Vercel upgrades into, which no fetch
 * dispatcher fronts. Nor is the feedback courier, which is no route's. A
 * path the table lands on a function not served here answers 404.
 *
 * No route module is imported until `localDeployment` is called, which the
 * caller does once the environment the routes read as they load is settled.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Route } from "@luke/service/route";
import { dispatchRoutes, ORPC_ROUTE_KEY } from "./function-dispatch.js";
import type { FunctionDefinition } from "./function-durations.js";
import {
  functionPublicPath,
  ORPC_ROUTE_MODULE,
  routeSourcePath,
  webFunctions,
} from "./function-layout.js";
import { readApiRewritesTable } from "./function-rewrites.js";
import { landed, landingRule } from "./platform-landing.js";

const NOT_FOUND = 404;

/** The deployment's routes over the local server's one origin. */
export interface LocalDeployment extends Route {
  /** Whether a path is the deployment's: whether a rewrite takes it, as every path no rewrite takes is the site's on Vercel. */
  readonly answers: (pathname: string) => boolean;
}

function moduleUrl(web: string, source: string): string {
  return pathToFileURL(join(web, source)).href;
}

/** A member route, imported where it stands, as the generated entry imports it: a route file's default export, or the hosted oRPC route by its name. */
async function importedRoute(web: string, key: string): Promise<Route> {
  if (key === ORPC_ROUTE_KEY) {
    // SAFETY: the module is `orpc-route.ts`, whose `orpcRoute` the generated entry imports by that name.
    const { orpcRoute } = (await import(
      moduleUrl(web, ORPC_ROUTE_MODULE)
    )) as typeof import("./orpc-route.js");
    return orpcRoute;
  }
  // SAFETY: every file under `server/routes/` default-exports its `Route`, which the generated entry imports on the same terms.
  const route = (await import(moduleUrl(web, routeSourcePath(key)))) as { readonly default: Route };
  return route.default;
}

async function groupedFunction(web: string, definition: FunctionDefinition): Promise<Route> {
  const members = await Promise.all(
    definition.routes.map(
      async (key): Promise<[string, Route]> => [key, await importedRoute(web, key)],
    ),
  );
  return dispatchRoutes(new Map(members));
}

/** Every grouped function by the path its rewrites land on, `/api/<file>.js`. */
async function servedFunctions(web: string): Promise<ReadonlyMap<string, Route>> {
  const grouped = (await webFunctions(web)).filter((definition) => definition.dispatches);
  const served = await Promise.all(
    grouped.map(
      async (definition): Promise<[string, Route]> => [
        `/${functionPublicPath(definition)}`,
        await groupedFunction(web, definition),
      ],
    ),
  );
  return new Map(served);
}

/** The deployment of the web app at `web`, every route module of it imported. */
export async function localDeployment(web: string): Promise<LocalDeployment> {
  const [rewrites, functions] = await Promise.all([
    readApiRewritesTable(web),
    servedFunctions(web),
  ]);
  return {
    answers: (pathname) => landingRule(pathname, rewrites) !== undefined,
    fetch: (request) => {
      const rule = landingRule(new URL(request.url).pathname, rewrites);
      if (rule === undefined) return Promise.resolve(new Response(null, { status: NOT_FOUND }));
      const arrived = landed(request, rule);
      const served = functions.get(new URL(arrived.url).pathname);
      return served === undefined
        ? Promise.resolve(new Response(null, { status: NOT_FOUND }))
        : served.fetch(arrived);
    },
  };
}
