import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Route } from "@repo/service/route";
import { dispatchRoutes, ORPC_ROUTE_KEY } from "./function-dispatch.js";
import type { FunctionDefinition } from "./function-durations.js";
import {
  functionPublicPath,
  ORPC_ROUTE_MODULE,
  routeSourcePath,
  webFunctions,
} from "./function-layout.js";
import { type Rewrite, readApiRewritesTable, readVercelConfig } from "./function-rewrites.js";
import { landed, landedPath, landingRule } from "./platform-landing.js";

const NOT_FOUND = 404;

export interface LocalDeployment extends Route {
  readonly answers: (pathname: string) => boolean;
}

function moduleUrl(web: string, source: string): string {
  return pathToFileURL(join(web, source)).href;
}

async function importedRoute(web: string, key: string): Promise<Route> {
  if (key === ORPC_ROUTE_KEY) {
    const { orpcRoute } = (await import(
      moduleUrl(web, ORPC_ROUTE_MODULE)
    )) as typeof import("./orpc-route.js");
    return orpcRoute;
  }
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

export async function localPages(web: string): Promise<(pathname: string) => string> {
  const [{ services }, table] = await Promise.all([
    readVercelConfig(web),
    readApiRewritesTable(web),
  ]);
  const deployment = new Set(table.map((rewrite) => rewrite.src));
  const pages: Rewrite[] = services.web.routes.flatMap((route) =>
    "dest" in route && route.has === undefined && !deployment.has(route.src)
      ? [{ src: route.src, dest: route.dest }]
      : [],
  );
  return (pathname) => {
    const rule = landingRule(pathname, pages);
    return rule === undefined ? pathname : landedPath(pathname, rule);
  };
}
