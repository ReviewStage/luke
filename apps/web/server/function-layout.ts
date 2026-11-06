import { readdir } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { type FunctionDefinition, functionDefinitions } from "./function-durations.js";

export const FUNCTION_BUNDLE_DIRECTORY = "dist-functions";

const ROUTES_DIRECTORY = join("server", "routes");
const API_DIRECTORY = "api";
const ROUTE_EXTENSION = ".ts";
const FUNCTION_EXTENSION = ".js";

async function routeKeys(routesDirectory: string): Promise<readonly string[]> {
  const listing = await readdir(routesDirectory, { recursive: true });
  return listing
    .filter((path) => path.endsWith(ROUTE_EXTENSION))
    .map((path) => path.split(sep).join(posix.sep).slice(0, -ROUTE_EXTENSION.length))
    .sort();
}

export async function webFunctions(web: string): Promise<readonly FunctionDefinition[]> {
  return functionDefinitions(await routeKeys(join(web, ROUTES_DIRECTORY)));
}

export const ORPC_ROUTE_MODULE = posix.join("server", "orpc-route.ts");

export function routeSourcePath(routeKey: string): string {
  return posix.join(ROUTES_DIRECTORY, `${routeKey}${ROUTE_EXTENSION}`);
}

export function functionPublicPath(definition: FunctionDefinition): string {
  return posix.join(API_DIRECTORY, `${definition.file}${FUNCTION_EXTENSION}`);
}

export function bundlePath(definition: FunctionDefinition): string {
  return posix.join(FUNCTION_BUNDLE_DIRECTORY, `${definition.file}${FUNCTION_EXTENSION}`);
}
