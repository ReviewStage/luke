import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HOST_WIRE } from "@repo/features/host-wire";
import { POSTHOG_PROXY } from "@repo/features/posthog-proxy";
import { SENTRY_TUNNEL } from "@repo/features/sentry-tunnel";
import { AUTH_SERVER_METADATA_PATHS } from "@repo/service/auth/auth-app";
import { MEMBER_MCP_METADATA_PATHS, MEMBER_MCP_METADATA_ROUTE } from "@repo/service/member-mcp/app";
import { isRecord, unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { Schema } from "effect";
import { functionAliasPath, HAND_WRITTEN_FUNCTIONS } from "./build-output.js";
import { DISPATCH_QUERY, ORPC_ROUTE_KEY } from "./function-dispatch.js";
import type { FunctionDefinition } from "./function-durations.js";
import { functionPublicPath, webFunctions } from "./function-layout.js";

export interface Rewrite {
  readonly src: string;
  readonly dest: string;
  readonly transforms?: readonly Transform[];
}

export interface Transform {
  readonly type: "request.headers";
  readonly op: "delete";
  readonly target: { readonly key: string };
}

export interface SegmentRewrite {
  readonly src: string;
  readonly route: string;
  readonly query: string;
}

const AUTH_ROUTE = "auth/[...all]";

const SEGMENT_REWRITES: readonly SegmentRewrite[] = [
  { src: "/api/auth/(.*)", route: AUTH_ROUTE, query: `${DISPATCH_QUERY.PATH}=auth/$1` },
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
  {
    src: "/api/agents/([^/]+)/chapters",
    route: "agents/chapters",
    query: `${DISPATCH_QUERY.PATH}=agents/$1/chapters`,
  },
  {
    src: "/api/pull-requests/chapters",
    route: "pull-requests/chapters",
    query: `${DISPATCH_QUERY.PATH}=pull-requests/chapters`,
  },
  {
    src: "/api/inbox/([^/]+)/attachments/([^/]+)",
    route: "inbox/attachment",
    query: "id=$1&attachment=$2",
  },
  { src: "/api/workspaces/([^/]+)/photo", route: "workspaces/photo", query: "id=$1" },
  { src: "/api/automations/([^/]+)/webhook", route: "automations/webhook", query: "id=$1" },
  { src: "/api/agents/mcp", route: "agents/mcp", query: `${DISPATCH_QUERY.PATH}=agents/mcp` },
  {
    src: "/api/agents/mcp/integrations/([^/]+)",
    route: "agents/mcp",
    query: `${DISPATCH_QUERY.PATH}=agents/mcp/integrations/$1`,
  },
];

const LITERAL_ROUTE_KEY = /^[a-z0-9/-]+$/;

const API_ROUTE_PREFIX = "/api/";

interface PublicRewrite {
  readonly path: string;
  readonly route: string;
  readonly query?: string;
}

const PUBLIC_REWRITES: readonly PublicRewrite[] = [
  {
    path: HOST_WIRE.INSTALL_SCRIPT_PATH,
    route: HOST_WIRE.INSTALL_SCRIPT_ROUTE.slice(API_ROUTE_PREFIX.length),
  },
  {
    path: SENTRY_TUNNEL.PATH,
    route: SENTRY_TUNNEL.ROUTE.slice(API_ROUTE_PREFIX.length),
  },
  ...MEMBER_MCP_METADATA_PATHS.map((path) => ({
    path,
    route: MEMBER_MCP_METADATA_ROUTE.slice(API_ROUTE_PREFIX.length),
  })),
  ...AUTH_SERVER_METADATA_PATHS.map(({ path, carried }) => ({
    path,
    route: AUTH_ROUTE,
    query: `${DISPATCH_QUERY.PATH}=${carried.slice(API_ROUTE_PREFIX.length)}`,
  })),
];

const WITHOUT_COOKIES: readonly Transform[] = [
  { type: "request.headers", op: "delete", target: { key: "cookie" } },
];

const POSTHOG_PROXY_PREFIX = `${POSTHOG_PROXY.PATH}/`;

const POSTHOG_REWRITES: readonly Rewrite[] = [
  ...["static", "array"].map((path) => ({
    src: `${POSTHOG_PROXY_PREFIX}${path}/(.*)`,
    dest: `${POSTHOG_PROXY.ASSETS_ORIGIN}/${path}/$1`,
    transforms: WITHOUT_COOKIES,
  })),
  {
    src: `${POSTHOG_PROXY_PREFIX}(.*)`,
    dest: `${POSTHOG_PROXY.INGEST_ORIGIN}/$1`,
    transforms: WITHOUT_COOKIES,
  },
];

export const ORPC_FALLBACK_SRC = `${API_ROUTE_PREFIX}(.*)`;

function exactPattern(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function dest(definition: FunctionDefinition, route: string, query?: string): string {
  const parameters = `${DISPATCH_QUERY.ROUTE}=${route}${query === undefined ? "" : `&${query}`}`;
  return `/${functionPublicPath(definition)}?${parameters}`;
}

function passThroughPaths(definitions: readonly FunctionDefinition[]): readonly string[] {
  const own = [
    ...definitions
      .filter((definition) => !definition.dispatches)
      .map((definition) => functionPublicPath(definition)),
    ...HAND_WRITTEN_FUNCTIONS.map((fn) => fn.path),
  ];
  return own.flatMap((path) => [`/${functionAliasPath(path)}`, `/${path}`]).sort();
}

export function apiRewrites(
  definitions: readonly FunctionDefinition[],
  segments: readonly SegmentRewrite[] = SEGMENT_REWRITES,
  publics: readonly PublicRewrite[] = PUBLIC_REWRITES,
): readonly Rewrite[] {
  const functionOf = new Map(
    definitions.flatMap((definition) =>
      definition.routes.map((route): [string, FunctionDefinition] => [route, definition]),
    ),
  );
  const orpc = functionOf.get(ORPC_ROUTE_KEY);
  if (orpc === undefined) throw new Error("no function holds the hosted oRPC route");
  const rewrites: Rewrite[] = [];
  for (const { path, route, query } of publics) {
    const definition = functionOf.get(route);
    if (definition === undefined) throw new Error(`no route behind the public path ${path}`);
    rewrites.push({ src: exactPattern(path), dest: dest(definition, route, query) });
  }
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

export function generatedRewrites(definitions: readonly FunctionDefinition[]): readonly Rewrite[] {
  return [...POSTHOG_REWRITES, ...apiRewrites(definitions)];
}

export const VERCEL_CONFIG_FILE = join("..", "..", "vercel.json");
export const API_REWRITES_FILE = join("server", "api-rewrites.json");

const TransformSchema = Schema.Struct({
  type: Schema.Literal("request.headers"),
  op: Schema.Literal("delete"),
  target: Schema.Struct({ key: Schema.String }),
});

const RewriteSchema = Schema.Struct({
  src: Schema.String,
  dest: Schema.String,
  transforms: Schema.optionalKey(Schema.Array(TransformSchema)),
});

const decodeApiRewrites = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(RewriteSchema)),
);

const HostConditionSchema = Schema.Struct({
  type: Schema.Literal("host"),
  value: Schema.Struct({ re: Schema.String }),
});

const NOT_FOUND_STATUS = 404;

const WebRouteSchema = Schema.Union([
  Schema.Struct({
    src: Schema.String,
    has: Schema.optionalKey(Schema.Array(HostConditionSchema)),
    dest: Schema.String,
    status: Schema.optionalKey(Schema.Literal(NOT_FOUND_STATUS)),
    headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    transforms: Schema.optionalKey(Schema.Array(TransformSchema)),
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

export async function readApiRewritesTable(web: string): Promise<readonly Rewrite[]> {
  return decodeApiRewrites(await readFile(join(web, API_REWRITES_FILE), "utf8"));
}

export function apiRewritesSource(rewrites: readonly Rewrite[]): string {
  return `${JSON.stringify(rewrites, null, 2)}\n`;
}

const WebService = Schema.Struct({
  root: Schema.String,
  framework: Schema.String,
  installCommand: Schema.String,
  buildCommand: Schema.String,
  ignoreCommand: Schema.String,
  routes: Schema.Array(WebRouteSchema),
});

const ServiceRewriteSchema = Schema.Struct({
  source: Schema.String,
  has: Schema.optionalKey(Schema.Array(HostConditionSchema)),
  destination: Schema.Struct({ service: Schema.String }),
});

const GitConfig = Schema.Struct({
  deploymentEnabled: Schema.Record(Schema.String, Schema.Boolean),
});

const VercelConfig = Schema.Struct({
  $schema: Schema.String,
  git: GitConfig,
  services: Schema.Struct({ web: WebService }),
  crons: Schema.Array(Schema.Struct({ path: Schema.String, schedule: Schema.String })),
  rewrites: Schema.Array(ServiceRewriteSchema),
});
export type VercelConfig = typeof VercelConfig.Type;

const decodeVercelConfig = Schema.decodeUnknownSync(Schema.fromJsonString(VercelConfig), {
  onExcessProperty: "error",
});

function hasTopLevelRoutesBesideServices(source: string): boolean {
  let parsed: WireBoundaryInput;
  try {
    parsed = JSON.parse(source) as WireBoundaryInput;
  } catch {
    return false;
  }
  const value = unparsedWire(parsed);
  return isRecord(value) && "services" in value && "routes" in value;
}

class TopLevelRoutesBesideServicesError extends Error {
  override readonly name = "TopLevelRoutesBesideServicesError";
  constructor() {
    super(
      "vercel.json declares services, so its routes belong under services.web.routes; Vercel ignores a top-level routes key in services mode",
    );
  }
}

export async function readVercelConfig(web: string): Promise<VercelConfig> {
  const source = await readFile(join(web, VERCEL_CONFIG_FILE), "utf8");
  if (hasTopLevelRoutesBesideServices(source)) throw new TopLevelRoutesBesideServicesError();
  return decodeVercelConfig(source);
}

const PUBLIC_REWRITE_SOURCES: ReadonlySet<string> = new Set(
  PUBLIC_REWRITES.map(({ path }) => exactPattern(path)),
);

const isTableRewrite = (rewrite: { readonly src: string }) =>
  rewrite.src.startsWith(API_ROUTE_PREFIX) ||
  rewrite.src.startsWith(POSTHOG_PROXY_PREFIX) ||
  PUBLIC_REWRITE_SOURCES.has(rewrite.src);

const sameRewrites = (a: readonly { readonly src: string }[], b: readonly Rewrite[]) =>
  JSON.stringify(a) === JSON.stringify(b);

export async function rewritesDrifted(web: string): Promise<boolean> {
  const committed = (await readVercelConfig(web)).services.web.routes.filter(isTableRewrite);
  const table = await readApiRewritesTable(web);
  const generated = generatedRewrites(await webFunctions(web));
  return !sameRewrites(table, generated) || !sameRewrites(committed, table);
}

const isHostLocked = (route: object): boolean => "has" in route;

export async function vercelConfigSource(web: string): Promise<string> {
  const config = await readVercelConfig(web);
  const others = config.services.web.routes.filter((rewrite) => !isTableRewrite(rewrite));
  const routes = [
    ...others.filter(isHostLocked),
    ...(await readApiRewritesTable(web)),
    ...others.filter((route) => !isHostLocked(route)),
  ];
  const services = { ...config.services, web: { ...config.services.web, routes } };
  return `${JSON.stringify({ ...config, services }, null, 2)}\n`;
}
