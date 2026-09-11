import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, posix, sep } from "node:path";
import {
  FUNCTION_MAX_DURATION_SECONDS,
  functionConfigSource,
  functionPath,
} from "./function-durations.js";

/**
 * Vercel registers `api/` functions from the uploaded source tree, before
 * `buildCommand` runs, so a function that exists only after the build is never
 * deployed. The bundles therefore land in `dist-functions/`, and what `api/`
 * holds is a committed one-line stub per route that re-exports its bundle; the
 * builder discovers the stub at upload and traces the relative import into the
 * bundle during the build, exactly as it traced the in-place bundles.
 *
 * A route's `config` literal lives in the stub, because the Node builder reads
 * it with a static parser over the entrypoint file and follows no re-export.
 */
export const FUNCTION_BUNDLE_DIRECTORY = "dist-functions";

const ROUTES_DIRECTORY = join("server", "routes");
const API_DIRECTORY = "api";
const ROUTE_EXTENSION = ".ts";
const STUB_EXTENSION = ".js";

export const STUB_DRIFT = {
  /** A route with no stub: the function would 404 on production. */
  MISSING: "missing",
  /** A stub whose text is not what the route generates. */
  STALE: "stale",
  /** An `api/**\/*.js` with no route behind it: Vercel would deploy it and it would fail at import. */
  ORPHAN: "orphan",
} as const;
type StubDrift = (typeof STUB_DRIFT)[keyof typeof STUB_DRIFT];

export interface StubDriftEntry {
  readonly kind: StubDrift;
  /** Repository-relative to the web app: `api/<route>.js`. */
  readonly path: string;
}

/** Every route under `server/routes/`, as `<dir>/<name>.ts` with POSIX separators, sorted. */
export async function routeRelativePaths(routesDirectory: string): Promise<readonly string[]> {
  const listing = await readdir(routesDirectory, { recursive: true });
  return listing
    .filter((path) => path.endsWith(ROUTE_EXTENSION))
    .map((path) => path.split(sep).join(posix.sep))
    .sort();
}

/** The path of the route's committed stub, relative to the web app. */
export function stubPath(routeRelativePath: string): string {
  return posix.join(API_DIRECTORY, routeRelativePath.replace(/\.ts$/, STUB_EXTENSION));
}

/** The path of the route's bundle, relative to the web app. */
function bundlePath(routeRelativePath: string): string {
  return posix.join(FUNCTION_BUNDLE_DIRECTORY, routeRelativePath.replace(/\.ts$/, STUB_EXTENSION));
}

/** The stub's whole text, Biome-stable so a formatting pass leaves a generated file as written. */
export function stubSource(routeRelativePath: string): string {
  const specifier = posix.relative(
    posix.dirname(stubPath(routeRelativePath)),
    bundlePath(routeRelativePath),
  );
  const maxDuration = FUNCTION_MAX_DURATION_SECONDS.get(functionPath(routeRelativePath));
  const reexport = `export { default } from "${specifier}";\n`;
  return maxDuration === undefined ? reexport : `${reexport}${functionConfigSource(maxDuration)}`;
}

async function stubRelativePaths(apiDirectory: string): Promise<readonly string[]> {
  const listing = await readdir(apiDirectory, { recursive: true });
  return listing
    .filter((path) => path.endsWith(STUB_EXTENSION))
    .map((path) => posix.join(API_DIRECTORY, path.split(sep).join(posix.sep)))
    .sort();
}

/** Every way the committed stubs disagree with the routes, empty when they agree. */
export async function stubDrift({
  web,
}: {
  readonly web: string;
}): Promise<readonly StubDriftEntry[]> {
  const routes = await routeRelativePaths(join(web, ROUTES_DIRECTORY));
  const expected = new Map(routes.map((route) => [stubPath(route), stubSource(route)]));
  const drift: StubDriftEntry[] = [];
  for (const [path, source] of expected) {
    const file = join(web, path);
    if (!existsSync(file)) drift.push({ kind: STUB_DRIFT.MISSING, path });
    else if (readFileSync(file, "utf8") !== source) drift.push({ kind: STUB_DRIFT.STALE, path });
  }
  for (const path of await stubRelativePaths(join(web, API_DIRECTORY))) {
    if (!expected.has(path)) drift.push({ kind: STUB_DRIFT.ORPHAN, path });
  }
  return drift;
}

/** The directory a stub is written into, for the writer that creates it. */
export function stubDirectory(web: string, routeRelativePath: string): string {
  return dirname(join(web, stubPath(routeRelativePath)));
}
