import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { DISPATCH_QUERY } from "./function-dispatch.js";
import type { FunctionDefinition } from "./function-durations.js";
import { functionPublicPath, webFunctions } from "./function-layout.js";

/**
 * The `/api/` entries of `vercel.json`'s `routes`, generated from the function
 * table so a client path lands on the function that groups its route. A route
 * with no rewrite would 404 on production while every check stayed green, so
 * the generation is committed and checked in two steps: the table itself,
 * `server/api-rewrites.json`, must be what the routes generate, and the
 * `/api/` entries of `vercel.json` must be the table, in its order. The table
 * is its own file so the configuration can one day be assembled by a
 * `vercel.ts` that imports it: Vercel bundles a config module's relative
 * imports and evaluates it in plain Node, which can take a JSON table and
 * cannot take this module's dependencies (LUKE-183).
 */
export interface Rewrite {
  readonly src: string;
  readonly dest: string;
}

/** Rewrites that read a path segment into the route's query, so a route sees `?id=` as it was written to. */
interface SegmentRewrite {
  readonly src: string;
  readonly route: string;
  readonly query: string;
}

const SEGMENT_REWRITES: readonly SegmentRewrite[] = [
  { src: "/api/auth/(.*)", route: "auth/[...all]", query: `${DISPATCH_QUERY.PATH}=auth/$1` },
  {
    src: "/api/conversation/messages/([^/]+)/rating",
    route: "conversation/messages/rating",
    query: "id=$1",
  },
  { src: "/api/brain/turns/([^/]+)/cancel", route: "brain/turns/cancel", query: "id=$1" },
  { src: "/api/brain/turns/([^/]+)/events", route: "brain/turns/events", query: "id=$1" },
  { src: "/api/brain/turns/([^/]+)", route: "brain/turns/turn", query: "id=$1" },
];

/** The characters a route key may spell for its exact rewrite to be its own regular expression. */
const LITERAL_ROUTE_KEY = /^[a-z0-9/-]+$/;

const API_ROUTE_PREFIX = "/api/";

function dest(definition: FunctionDefinition, route: string, query?: string): string {
  const parameters = `${DISPATCH_QUERY.ROUTE}=${route}${query === undefined ? "" : `&${query}`}`;
  return `/${functionPublicPath(definition)}?${parameters}`;
}

/** The `/api/` rewrites, in the order they must stand: segment rewrites first, then one exact rule per remaining dispatched route. */
export function apiRewrites(definitions: readonly FunctionDefinition[]): readonly Rewrite[] {
  const functionOf = new Map(
    definitions.flatMap((definition) =>
      definition.routes.map((route): [string, FunctionDefinition] => [route, definition]),
    ),
  );
  const rewrites: Rewrite[] = [];
  const rewritten = new Set<string>();
  for (const segment of SEGMENT_REWRITES) {
    const definition = functionOf.get(segment.route);
    if (definition === undefined) throw new Error(`no route behind the rewrite ${segment.src}`);
    rewrites.push({ src: segment.src, dest: dest(definition, segment.route, segment.query) });
    rewritten.add(segment.route);
  }
  for (const definition of definitions) {
    if (!definition.dispatches) continue;
    for (const route of definition.routes) {
      if (rewritten.has(route)) continue;
      if (!LITERAL_ROUTE_KEY.test(route)) {
        throw new Error(`the route ${route} needs a rewrite of its own in SEGMENT_REWRITES`);
      }
      rewrites.push({ src: `${API_ROUTE_PREFIX}${route}`, dest: dest(definition, route) });
    }
  }
  return rewrites;
}

export const VERCEL_CONFIG_FILE = "vercel.json";
/** The committed generation of the `/api/` rewrites, which `vercel.json` is assembled from. */
export const API_REWRITES_FILE = join("server", "api-rewrites.json");

const RewriteSchema = Schema.Struct({ src: Schema.String, dest: Schema.String });

const decodeApiRewrites = Schema.decodeUnknownSync(Schema.parseJson(Schema.Array(RewriteSchema)));

/** The table as committed. */
export async function readApiRewritesTable(web: string): Promise<readonly Rewrite[]> {
  return decodeApiRewrites(await readFile(join(web, API_REWRITES_FILE), "utf8"));
}

/** The table's text, stable under regeneration. */
export function apiRewritesSource(rewrites: readonly Rewrite[]): string {
  return `${JSON.stringify(rewrites, null, 2)}\n`;
}

/**
 * The whole of `vercel.json`, so a key this build does not know refuses the
 * generation rather than being carried or dropped unread.
 */
const VercelConfig = Schema.Struct({
  $schema: Schema.String,
  installCommand: Schema.String,
  buildCommand: Schema.String,
  ignoreCommand: Schema.String,
  crons: Schema.Array(Schema.Struct({ path: Schema.String, schedule: Schema.String })),
  routes: Schema.Array(RewriteSchema),
});
type VercelConfig = typeof VercelConfig.Type;

const decodeVercelConfig = Schema.decodeUnknownSync(Schema.parseJson(VercelConfig));

async function readVercelConfig(web: string): Promise<VercelConfig> {
  return decodeVercelConfig(await readFile(join(web, VERCEL_CONFIG_FILE), "utf8"));
}

const isApiRewrite = (rewrite: Rewrite) => rewrite.src.startsWith(API_ROUTE_PREFIX);

const sameRewrites = (a: readonly Rewrite[], b: readonly Rewrite[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether either committed half has drifted: the table from what the routes
 * generate, or `vercel.json`'s `/api/` entries from the table. Both are read,
 * so a table regenerated without the file assembled from it, or the reverse,
 * is drift and not a pass.
 */
export async function rewritesDrifted(web: string): Promise<boolean> {
  const table = await readApiRewritesTable(web);
  const generated = apiRewrites(await webFunctions(web));
  const committed = (await readVercelConfig(web)).routes.filter(isApiRewrite);
  return !sameRewrites(table, generated) || !sameRewrites(committed, table);
}

/** `vercel.json` with its `/api/` rewrites replaced by the committed table, ahead of every other route. */
export async function vercelConfigSource(web: string): Promise<string> {
  const config = await readVercelConfig(web);
  const others = config.routes.filter((rewrite) => !isApiRewrite(rewrite));
  const routes = [...(await readApiRewritesTable(web)), ...others];
  return `${JSON.stringify({ ...config, routes }, null, 2)}\n`;
}
