import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { DISPATCH_QUERY } from "./function-dispatch.js";
import type { FunctionDefinition } from "./function-durations.js";
import { stubPath, webFunctions } from "./function-stubs.js";

/**
 * The `/api/` entries of `vercel.json`'s `routes`, generated from the function
 * table so a client path lands on the function that groups its route. Vercel
 * checks the stubs into place before the build runs, and a route with no
 * rewrite would 404 on production while every check stayed green, so the
 * committed entries are checked against this generation like the stubs are.
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
  { src: "/api/brain/turns/([^/]+)/events", route: "brain/turns/events", query: "id=$1" },
  { src: "/api/brain/turns/([^/]+)", route: "brain/turns/turn", query: "id=$1" },
];

/** The characters a route key may spell for its exact rewrite to be its own regular expression. */
const LITERAL_ROUTE_KEY = /^[a-z0-9/-]+$/;

const API_ROUTE_PREFIX = "/api/";

function dest(definition: FunctionDefinition, route: string, query?: string): string {
  const parameters = `${DISPATCH_QUERY.ROUTE}=${route}${query === undefined ? "" : `&${query}`}`;
  return `/${stubPath(definition)}?${parameters}`;
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

const RewriteSchema = Schema.Struct({ src: Schema.String, dest: Schema.String });

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

/** Whether the committed `/api/` rewrites are the generated ones, in the generated order. */
export async function rewritesDrifted(web: string): Promise<boolean> {
  const config = await readVercelConfig(web);
  const committed = config.routes.filter(isApiRewrite);
  const expected = apiRewrites(await webFunctions(web));
  return JSON.stringify(committed) !== JSON.stringify(expected);
}

/** `vercel.json` with its `/api/` rewrites replaced by the generated ones, ahead of every other route. */
export async function vercelConfigSource(web: string): Promise<string> {
  const config = await readVercelConfig(web);
  const others = config.routes.filter((rewrite) => !isApiRewrite(rewrite));
  const routes = [...apiRewrites(await webFunctions(web)), ...others];
  return `${JSON.stringify({ ...config, routes }, null, 2)}\n`;
}
