import { readdir } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { type FunctionDefinition, functionDefinitions } from "./function-durations.js";

/**
 * Where the functions live: the routes under `server/routes/`, the bundles
 * `scripts/bundle-functions.ts` builds from them under `dist-functions/`, and
 * the public path each function answers on, which is the `.func` name in the
 * Build Output tree (`build-output.ts`) and the destination the `/api/`
 * rewrites of `vercel.json` carry. Nothing under `api/` exists any more:
 * Vercel's zero-config pass built whatever it found there, beside the tree,
 * and two builders claimed one path.
 */
export const FUNCTION_BUNDLE_DIRECTORY = "dist-functions";

const ROUTES_DIRECTORY = join("server", "routes");
const API_DIRECTORY = "api";
const ROUTE_EXTENSION = ".ts";
const FUNCTION_EXTENSION = ".js";

/** Every route under `server/routes/`, as its key `<dir>/<name>` with POSIX separators, sorted. */
export async function routeKeys(routesDirectory: string): Promise<readonly string[]> {
  const listing = await readdir(routesDirectory, { recursive: true });
  return listing
    .filter((path) => path.endsWith(ROUTE_EXTENSION))
    .map((path) => path.split(sep).join(posix.sep).slice(0, -ROUTE_EXTENSION.length))
    .sort();
}

/** The functions the routes under the web app's `server/routes/` are deployed as. */
export async function webFunctions(web: string): Promise<readonly FunctionDefinition[]> {
  return functionDefinitions(await routeKeys(join(web, ROUTES_DIRECTORY)));
}

/** The route file behind a key, relative to the web app. */
export function routeSourcePath(routeKey: string): string {
  return posix.join(ROUTES_DIRECTORY, `${routeKey}${ROUTE_EXTENSION}`);
}

/** The public path a function answers on: `api/<function>.js`, the `.func` name and the rewrites' destination alike. */
export function functionPublicPath(definition: FunctionDefinition): string {
  return posix.join(API_DIRECTORY, `${definition.file}${FUNCTION_EXTENSION}`);
}

/** The path of the function's bundle, relative to the web app. */
export function bundlePath(definition: FunctionDefinition): string {
  return posix.join(FUNCTION_BUNDLE_DIRECTORY, `${definition.file}${FUNCTION_EXTENSION}`);
}
