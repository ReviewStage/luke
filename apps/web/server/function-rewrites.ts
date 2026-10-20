import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Schema } from "effect";
import { functionAliasPath, HAND_WRITTEN_FUNCTIONS } from "./build-output.js";
import { DISPATCH_QUERY, ORPC_ROUTE_KEY } from "./function-dispatch.js";
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

/**
 * The routes that stay off the hosted oRPC router whose public paths carry a
 * segment: each rewrite reads the segment into the route's query, so a route
 * sees `?id=` as it was written to, and the auth catch-all's carries its
 * whole path in `route-path`, which the dispatcher restores, as the one oRPC
 * path that needs a function of its own, a pull request's chapters, does. Every other
 * route file is reached by an exact rule of its key; every path that is no
 * route file's goes to the oRPC route through the fallback, and the router
 * matches its own public paths.
 */
export interface SegmentRewrite {
  readonly src: string;
  readonly route: string;
  readonly query: string;
}

const SEGMENT_REWRITES: readonly SegmentRewrite[] = [
  { src: "/api/auth/(.*)", route: "auth/[...all]", query: `${DISPATCH_QUERY.PATH}=auth/$1` },
  {
    src: "/api/plans/([^/]+)/attachments/([^/]+)",
    route: "plans/attachment",
    query: "id=$1&attachment=$2",
  },
  {
    src: "/api/agents/([^/]+)/subagents/([^/]+)/pictures/([^/]+)",
    route: "agents/picture",
    query: "id=$1&call=$2&picture=$3",
  },
  {
    src: "/api/agents/([^/]+)/pictures/([^/]+)",
    route: "agents/picture",
    query: "id=$1&picture=$2",
  },
  { src: "/api/agents/([^/]+)/github-image", route: "agents/github-image", query: "id=$1" },
  // A pull request's chapters are the oRPC router's, reached through a route file of their own so a Generate runs in the long function (`function-durations.ts`); the dispatcher restores their public path from `route-path`.
  {
    src: "/api/agents/([^/]+)/chapters",
    route: "agents/chapters",
    query: `${DISPATCH_QUERY.PATH}=agents/$1/chapters`,
  },
  {
    src: "/api/inbox/([^/]+)/attachments/([^/]+)",
    route: "inbox/attachment",
    query: "id=$1&attachment=$2",
  },
  { src: "/api/workspaces/([^/]+)/photo", route: "workspaces/photo", query: "id=$1" },
  { src: "/api/automations/([^/]+)/webhook", route: "automations/webhook", query: "id=$1" },
];

/** The characters a route key may spell for its exact rewrite to be its own regular expression. */
const LITERAL_ROUTE_KEY = /^[a-z0-9/-]+$/;

const API_ROUTE_PREFIX = "/api/";

/** The fallback's pattern: every `/api/` path no rule above it took, its path after `/api/` captured. */
export const ORPC_FALLBACK_SRC = `${API_ROUTE_PREFIX}(.*)`;

/** A public path as a pattern that matches it alone: its dots and other specials escaped. */
function exactPattern(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function dest(definition: FunctionDefinition, route: string, query?: string): string {
  const parameters = `${DISPATCH_QUERY.ROUTE}=${route}${query === undefined ? "" : `&${query}`}`;
  return `/${functionPublicPath(definition)}?${parameters}`;
}

/**
 * Every public path a function answers by its own name rather than through
 * a dispatcher: each standalone function and each hand-written one, at its
 * file's name and at the extensionless alias the Build Output serves it at.
 * Vercel runs the web service's `routes` before it looks at the filesystem
 * and stops at the first that matches, so without a rule of its own each
 * would be taken by the fallback; this rule rewrites it onto itself, which
 * the filesystem then serves as it did before the fallback stood.
 */
function passThroughPaths(definitions: readonly FunctionDefinition[]): readonly string[] {
  const own = [
    ...definitions
      .filter((definition) => !definition.dispatches)
      .map((definition) => functionPublicPath(definition)),
    ...HAND_WRITTEN_FUNCTIONS.map((fn) => fn.path),
  ];
  return own.flatMap((path) => [`/${functionAliasPath(path)}`, `/${path}`]).sort();
}

/**
 * The `/api/` rewrites, in the order they must stand: the segment rewrites,
 * one exact rule per route file a dispatcher holds, the pass-through rules of
 * the functions that answer by their own name, and last the fallback, which
 * lands every other `/api/` path on the hosted oRPC route with its path in
 * `route-path`. Vercel stops at the first rule that matches, so nothing ahead
 * of the fallback is shadowed by it.
 */
export function apiRewrites(
  definitions: readonly FunctionDefinition[],
  segments: readonly SegmentRewrite[] = SEGMENT_REWRITES,
): readonly Rewrite[] {
  const functionOf = new Map(
    definitions.flatMap((definition) =>
      definition.routes.map((route): [string, FunctionDefinition] => [route, definition]),
    ),
  );
  const orpc = functionOf.get(ORPC_ROUTE_KEY);
  if (orpc === undefined) throw new Error("no function holds the hosted oRPC route");
  const rewrites: Rewrite[] = [];
  const rewritten = new Set<string>([ORPC_ROUTE_KEY]);
  for (const segment of segments) {
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
  for (const path of passThroughPaths(definitions)) {
    rewrites.push({ src: exactPattern(path), dest: path });
  }
  rewrites.push({
    src: ORPC_FALLBACK_SRC,
    dest: dest(orpc, ORPC_ROUTE_KEY, `${DISPATCH_QUERY.PATH}=$1`),
  });
  return rewrites;
}

/** The deployment's configuration, at the repository root two steps above the web app. */
export const VERCEL_CONFIG_FILE = join("..", "..", "vercel.json");
/** The committed generation of the `/api/` rewrites, which the web service's routes are assembled from. */
export const API_REWRITES_FILE = join("server", "api-rewrites.json");

const RewriteSchema = Schema.Struct({ src: Schema.String, dest: Schema.String });

const decodeApiRewrites = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(RewriteSchema)),
);

/**
 * A route of the web service as `vercel.json` writes it: a rewrite, and the
 * response headers a page route sends beside it, as the app's routes send
 * its Content Security Policy; a redirect, its status and its `Location`
 * header, as the app's built file name sends the browser to `/app`; or
 * headers alone, which routing carries on past (`continue`) to whichever
 * later route or built file answers, as every page of the site wears its
 * security headers. A generated `/api/` rewrite carries none of them.
 */
const WebRouteSchema = Schema.Union([
  Schema.Struct({
    src: Schema.String,
    dest: Schema.String,
    headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
  Schema.Struct({
    src: Schema.String,
    status: Schema.Number,
    headers: Schema.Struct({ Location: Schema.String }),
  }),
  Schema.Struct({
    src: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
    continue: Schema.Literal(true),
  }),
]);

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
 * service. The `git` key turns off deployment of GitHub's merge-queue
 * branches (`gh-readonly-queue/<base>/pr-<n>-<sha>`): CI gates the queue, and
 * the squash it lands on `main` deploys on its own. The glob is `**` because
 * a `*` does not cross the branch name's `/`.
 */
const WebService = Schema.Struct({
  root: Schema.String,
  framework: Schema.String,
  installCommand: Schema.String,
  buildCommand: Schema.String,
  ignoreCommand: Schema.String,
  routes: Schema.Array(WebRouteSchema),
});

const EveService = Schema.Struct({
  root: Schema.String,
  framework: Schema.String,
  installCommand: Schema.String,
  buildCommand: Schema.String,
  ignoreCommand: Schema.String,
});

/** A route of eve's second service, which rewrites its mounted path back to eve's own rather than naming a destination. */
const TransformRouteSchema = Schema.Struct({
  src: Schema.String,
  transforms: Schema.Array(
    Schema.Struct({ type: Schema.String, op: Schema.String, args: Schema.String }),
  ),
});

const CoderService = Schema.Struct({
  ...EveService.fields,
  routes: Schema.Array(TransformRouteSchema),
});

const ServiceRewriteSchema = Schema.Struct({
  source: Schema.String,
  destination: Schema.Struct({ service: Schema.String }),
});

const GitConfig = Schema.Struct({
  deploymentEnabled: Schema.Record(Schema.String, Schema.Boolean),
});

const VercelConfig = Schema.Struct({
  $schema: Schema.String,
  git: GitConfig,
  services: Schema.Struct({ web: WebService, luke: EveService, dev: CoderService }),
  crons: Schema.Array(Schema.Struct({ path: Schema.String, schedule: Schema.String })),
  rewrites: Schema.Array(ServiceRewriteSchema),
});
type VercelConfig = typeof VercelConfig.Type;

const decodeVercelConfig = Schema.decodeUnknownSync(Schema.fromJsonString(VercelConfig), {
  onExcessProperty: "error",
});

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
class TopLevelRoutesBesideServicesError extends Error {
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

const isApiRewrite = (rewrite: { readonly src: string }) =>
  rewrite.src.startsWith(API_ROUTE_PREFIX);

const sameRewrites = (a: readonly { readonly src: string }[], b: readonly Rewrite[]) =>
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
