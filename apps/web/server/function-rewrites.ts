import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { isRecord, unparsedWire, type WireBoundaryInput } from "./core.js";
import { DISPATCH_QUERY } from "./function-dispatch.js";
import type { FunctionDefinition } from "./function-durations.js";
import { functionPublicPath, webFunctions } from "./function-layout.js";

/**
 * The `/api/` entries of the web service's `routes` in `vercel.json`,
 * generated from the function table so a client path lands on the function
 * that groups its route. A route with no rewrite would 404 on production
 * while every check stayed green, so the generation is committed and checked
 * in two steps: the table itself, `server/api-rewrites.json`, must be what
 * the routes generate, and the web service's `/api/` entries must be the
 * table, in its order. The table is its own file so the configuration can
 * one day be assembled by a `vercel.ts` that imports it: Vercel bundles a
 * config module's relative imports and evaluates it in plain Node, which can
 * take a JSON table and cannot take this module's dependencies (LUKE-183).
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
/** The committed generation of the `/api/` rewrites, which the web service's routes are assembled from. */
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
 * generation rather than being carried or dropped unread. The file is a
 * services deployment: the web service owns the build, the install, the
 * ignore rule, and the `routes` the `/api/` rewrites are generated into,
 * because Vercel evaluates a service's routes only once a request has
 * entered it and ignores a `routes` key left at the top level; the eve
 * service owns its own build; and the top-level `rewrites` are the public
 * routing that sends `/eve/v1/*` to eve and everything else to the web
 * service.
 */
const WebService = Schema.Struct({
  root: Schema.String,
  framework: Schema.String,
  installCommand: Schema.String,
  buildCommand: Schema.String,
  ignoreCommand: Schema.String,
  routes: Schema.Array(RewriteSchema),
});

const EveService = Schema.Struct({
  root: Schema.String,
  framework: Schema.String,
  installCommand: Schema.String,
  buildCommand: Schema.String,
  ignoreCommand: Schema.String,
});

const ServiceRewriteSchema = Schema.Struct({
  source: Schema.String,
  destination: Schema.Struct({ service: Schema.String }),
});

const VercelConfig = Schema.Struct({
  $schema: Schema.String,
  services: Schema.Struct({ web: WebService, eve: EveService }),
  crons: Schema.Array(Schema.Struct({ path: Schema.String, schedule: Schema.String })),
  rewrites: Schema.Array(ServiceRewriteSchema),
});
type VercelConfig = typeof VercelConfig.Type;

const decodeVercelConfig = Schema.decodeUnknownSync(Schema.parseJson(VercelConfig));

/** Whether the file carries both keys, by their presence: a `routes` key that is merely undefined-valued is still the wrong shape. */
function hasTopLevelRoutesBesideServices(source: string): boolean {
  let parsed: WireBoundaryInput;
  try {
    // SAFETY: the file is this app's own vercel.json; the strict decode that follows is what holds it to a shape.
    parsed = JSON.parse(source) as WireBoundaryInput;
  } catch {
    return false;
  }
  const value = unparsedWire(parsed);
  return isRecord(value) && "services" in value && "routes" in value;
}

/**
 * Vercel ignores a `routes` key at the top level of a services deployment
 * rather than refusing it, so a file generated into that location would pass
 * every check and answer 404 on every `/api/` route in production. The
 * generator refuses the shape by name, ahead of the schema, so the refusal
 * says where the routes belong rather than which key was unknown.
 */
export class TopLevelRoutesBesideServicesError extends Error {
  override readonly name = "TopLevelRoutesBesideServicesError";
  constructor() {
    super(
      "vercel.json declares services, so its routes belong under services.web.routes; Vercel ignores a top-level routes key in services mode",
    );
  }
}

async function readVercelConfig(web: string): Promise<VercelConfig> {
  const source = await readFile(join(web, VERCEL_CONFIG_FILE), "utf8");
  if (hasTopLevelRoutesBesideServices(source)) throw new TopLevelRoutesBesideServicesError();
  return decodeVercelConfig(source);
}

const isApiRewrite = (rewrite: Rewrite) => rewrite.src.startsWith(API_ROUTE_PREFIX);

const sameRewrites = (a: readonly Rewrite[], b: readonly Rewrite[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether either committed half has drifted: the table from what the routes
 * generate, or the web service's `/api/` entries from the table. Both are
 * read, so a table regenerated without the file assembled from it, or the
 * reverse, is drift and not a pass.
 */
export async function rewritesDrifted(web: string): Promise<boolean> {
  // The file's shape is refused ahead of anything else being read, so the refusal names where the routes belong.
  const committed = (await readVercelConfig(web)).services.web.routes.filter(isApiRewrite);
  const table = await readApiRewritesTable(web);
  const generated = apiRewrites(await webFunctions(web));
  return !sameRewrites(table, generated) || !sameRewrites(committed, table);
}

/** `vercel.json` with the web service's `/api/` rewrites replaced by the committed table, ahead of every other route of that service. */
export async function vercelConfigSource(web: string): Promise<string> {
  const config = await readVercelConfig(web);
  const others = config.services.web.routes.filter((rewrite) => !isApiRewrite(rewrite));
  const routes = [...(await readApiRewritesTable(web)), ...others];
  const services = { ...config.services, web: { ...config.services.web, routes } };
  return `${JSON.stringify({ ...config, services }, null, 2)}\n`;
}
