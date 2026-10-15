import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { DISPATCH_QUERY } from "./function-dispatch.js";
import type { FunctionDefinition } from "./function-durations.js";
import { functionPublicPath, webFunctions } from "./function-layout.js";

/**
 * The `/api/` entries of the web service's `routes`, generated from the
 * function table so a client path lands on the function that groups its
 * route. A route with no rewrite would 404 on production while every check
 * stayed green, so the generation is committed, as `api-rewrites.json` at the
 * repository root, and checked to be what the routes generate. The root
 * `vercel.ts` imports the table and puts it ahead of the web service's other
 * routes: Vercel bundles a config module's relative imports and evaluates it
 * in plain Node, which can take a JSON table and cannot take this module's
 * dependencies (LUKE-183).
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
    src: "/api/account/integrations/([^/]+)/connect",
    route: "account/integrations/connect",
    query: "provider=$1",
  },
  {
    src: "/api/account/integrations/([^/]+)/tools",
    route: "account/integrations/tools",
    query: "provider=$1",
  },
  {
    src: "/api/account/integrations/([^/]+)/cancel",
    route: "account/integrations/cancel",
    query: "provider=$1",
  },
  {
    src: "/api/account/integrations/([^/]+)/disconnect",
    route: "account/integrations/disconnect",
    query: "provider=$1",
  },
  { src: "/api/plans/([^/]+)/board", route: "plans/board", query: "id=$1" },
  { src: "/api/plans/([^/]+)/transcript", route: "plans/transcript", query: "id=$1" },
  { src: "/api/plans/([^/]+)/work", route: "plans/work", query: "id=$1" },
  {
    src: "/api/plans/([^/]+)/subagents/([^/]+)/messages",
    route: "plans/subagent-messages",
    query: "id=$1&call=$2",
  },
  { src: "/api/plans/([^/]+)/messages", route: "plans/messages", query: "id=$1" },
  { src: "/api/plans/([^/]+)/code", route: "plans/code", query: "id=$1" },
  { src: "/api/plans/([^/]+)/file", route: "plans/file", query: "id=$1" },
  { src: "/api/plans/([^/]+)/tree", route: "plans/tree", query: "id=$1" },
  { src: "/api/plans/([^/]+)/skills", route: "plans/skills", query: "id=$1" },
  { src: "/api/plans/([^/]+)/edit", route: "plans/edit", query: "id=$1" },
  { src: "/api/plans/([^/]+)/agents", route: "plans/agents", query: "id=$1" },
  { src: "/api/plans/([^/]+)/inbox", route: "plans/inbox", query: "id=$1" },
  {
    src: "/api/plans/([^/]+)/revisions/([^/]+)/restore",
    route: "plans/restore",
    query: "id=$1&seq=$2",
  },
  { src: "/api/plans/([^/]+)/revisions/([^/]+)", route: "plans/revision", query: "id=$1&seq=$2" },
  { src: "/api/plans/([^/]+)/revisions", route: "plans/revisions", query: "id=$1" },
  {
    src: "/api/plans/([^/]+)/pages/([^/]+)/versions/([^/]+)",
    route: "plans/page",
    query: "id=$1&page=$2&version=$3",
  },
  { src: "/api/plans/([^/]+)/pages", route: "plans/pages", query: "id=$1" },
  { src: "/api/plans/([^/]+)", route: "plans/plan", query: "id=$1" },
  {
    src: "/api/account/plan-template/revisions/([^/]+)/restore",
    route: "account/plan-template/restore",
    query: "seq=$1",
  },
  {
    src: "/api/account/plan-template/revisions/([^/]+)",
    route: "account/plan-template/revision",
    query: "seq=$1",
  },
  {
    src: "/api/agents/([^/]+)/subagents/([^/]+)/messages",
    route: "agents/subagent-messages",
    query: "id=$1&call=$2",
  },
  { src: "/api/agents/([^/]+)/messages", route: "agents/messages", query: "id=$1" },
  { src: "/api/agents/([^/]+)/stop", route: "agents/stop", query: "id=$1" },
  { src: "/api/agents/([^/]+)/pull-request", route: "agents/pull-request", query: "id=$1" },
  { src: "/api/agents/([^/]+)/changes", route: "agents/changes", query: "id=$1" },
  { src: "/api/agents/([^/]+)/inbox", route: "agents/inbox", query: "id=$1" },
  {
    src: "/api/agents/([^/]+)/terminals/([^/]+)",
    route: "agents/terminal",
    query: "id=$1&terminal=$2",
  },
  { src: "/api/agents/([^/]+)/terminals", route: "agents/terminals", query: "id=$1" },
  { src: "/api/agents/([^/]+)/sandbox/resume", route: "agents/sandbox-resume", query: "id=$1" },
  { src: "/api/agents/([^/]+)", route: "agents/agent", query: "id=$1" },
  {
    src: "/api/inbox/([^/]+)/attachments/([^/]+)",
    route: "inbox/attachment",
    query: "id=$1&attachment=$2",
  },
  { src: "/api/inbox/([^/]+)", route: "inbox/item", query: "id=$1" },
  { src: "/api/workspaces/([^/]+)/photo", route: "workspaces/photo", query: "id=$1" },
  { src: "/api/automations/([^/]+)/webhook", route: "automations/webhook", query: "id=$1" },
  { src: "/api/automations/([^/]+)/runs", route: "automations/runs", query: "id=$1" },
  { src: "/api/automations/([^/]+)/run", route: "automations/run", query: "id=$1" },
  { src: "/api/automations/([^/]+)", route: "automations/automation", query: "id=$1" },
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

/** The committed generation of the `/api/` rewrites, beside the root `vercel.ts` that imports it. */
export const API_REWRITES_FILE = "api-rewrites.json";

const RewriteSchema = Schema.Struct({ src: Schema.String, dest: Schema.String });

const decodeApiRewrites = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(RewriteSchema)),
);

/** Where the table stands, given the web app's own directory: the repository root, two steps up. */
export function apiRewritesPath(web: string): string {
  return join(web, "..", "..", API_REWRITES_FILE);
}

/** The table as committed. */
export async function readApiRewritesTable(web: string): Promise<readonly Rewrite[]> {
  return decodeApiRewrites(await readFile(apiRewritesPath(web), "utf8"));
}

/** The table's text, stable under regeneration. */
export function apiRewritesSource(rewrites: readonly Rewrite[]): string {
  return `${JSON.stringify(rewrites, null, 2)}\n`;
}

/** Whether the committed table has drifted from what the routes generate, in content or in order. */
export async function rewritesDrifted(web: string): Promise<boolean> {
  const table = await readApiRewritesTable(web);
  const generated = apiRewrites(await webFunctions(web));
  return JSON.stringify(table) !== JSON.stringify(generated);
}
