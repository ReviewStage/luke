import { BROWSER_LIVE } from "@repo/features/browser-live-wire";
import { LIVE_SOCKET } from "@repo/features/live-wire";
import { SANDBOX_TUNNEL } from "@repo/features/sandbox-tunnel-wire";
import { TERMINAL_RELAY } from "@repo/features/terminal-wire";
import { WORKSPACE_MCP_FUNCTION, WORKSPACE_MCP_PATH } from "@repo/service/agents/workspace-mcp/app";
import {
  PULL_REQUEST_CHAPTERS_FUNCTION,
  PULL_REQUEST_CHAPTERS_ROUTE_PATHS,
} from "@repo/service/chapters/chapters-function";
import {
  MAINTENANCE_SWEEP,
  MAINTENANCE_SWEEP_PATH,
} from "@repo/service/maintenance/maintenance-bounds";
import { MEMBER_MCP_FUNCTION, MEMBER_MCP_METADATA_ROUTE } from "@repo/service/member-mcp/app";
import { MEMBER_MCP_PATH } from "@repo/service/member-mcp/resource";
import { PAGE_LINK_ROUTE } from "@repo/service/pages/page-links";
import { ORPC_ROUTE_KEY } from "./function-dispatch.js";

const WEBSOCKET_FUNCTION_MAX_DURATION_SECONDS = 800;

const API_PREFIX = "/api/";

function routeKeyOf(path: string): string {
  return path.slice(API_PREFIX.length);
}

const FUNCTION_GROUP = {
  DEFAULT: "default",
  WORKSPACE_MCP: "workspace-mcp",
  MEMBER_MCP: "member-mcp",
  MAINTENANCE_SWEEP: "maintenance-sweep",
  PAGE_SANDBOX: "page-sandbox",
  PULL_REQUEST_CHAPTERS: "pull-request-chapters",
} as const;
type FunctionGroup = (typeof FUNCTION_GROUP)[keyof typeof FUNCTION_GROUP];

export interface FunctionDefinition {
  readonly file: string;
  readonly maxDuration?: number;
  readonly routes: readonly string[];
  readonly dispatches: boolean;
}

interface GroupDefinition {
  readonly file: FunctionGroup;
  readonly maxDuration?: number;
  readonly routes: readonly string[];
}

const GROUPS: readonly GroupDefinition[] = [
  {
    file: FUNCTION_GROUP.MAINTENANCE_SWEEP,
    maxDuration: MAINTENANCE_SWEEP.MAX_DURATION_SECONDS,
    routes: [routeKeyOf(MAINTENANCE_SWEEP_PATH)],
  },
  {
    file: FUNCTION_GROUP.PULL_REQUEST_CHAPTERS,
    maxDuration: PULL_REQUEST_CHAPTERS_FUNCTION.MAX_DURATION_SECONDS,
    routes: PULL_REQUEST_CHAPTERS_ROUTE_PATHS.map(routeKeyOf),
  },
  {
    file: FUNCTION_GROUP.WORKSPACE_MCP,
    maxDuration: WORKSPACE_MCP_FUNCTION.MAX_DURATION_SECONDS,
    routes: [routeKeyOf(WORKSPACE_MCP_PATH)],
  },
  {
    file: FUNCTION_GROUP.MEMBER_MCP,
    maxDuration: MEMBER_MCP_FUNCTION.MAX_DURATION_SECONDS,
    routes: [routeKeyOf(MEMBER_MCP_PATH), routeKeyOf(MEMBER_MCP_METADATA_ROUTE)],
  },
  { file: FUNCTION_GROUP.PAGE_SANDBOX, routes: [routeKeyOf(PAGE_LINK_ROUTE.PATH)] },
];

const STANDALONE_ROUTES: readonly string[] = [
  TERMINAL_RELAY.PATH,
  SANDBOX_TUNNEL.PATH,
  BROWSER_LIVE.PATH,
  LIVE_SOCKET.PATH,
].map(routeKeyOf);

export function functionDefinitions(routeKeys: readonly string[]): readonly FunctionDefinition[] {
  if (routeKeys.includes(ORPC_ROUTE_KEY)) {
    throw new Error(`the route key ${ORPC_ROUTE_KEY} is the hosted oRPC route's, not a file's`);
  }
  const claimed = new Set([...GROUPS.flatMap((group) => group.routes), ...STANDALONE_ROUTES]);
  const unclaimed = routeKeys.filter((key) => !claimed.has(key));
  const definitions: FunctionDefinition[] = [
    { file: FUNCTION_GROUP.DEFAULT, routes: [...unclaimed, ORPC_ROUTE_KEY], dispatches: true },
    ...GROUPS.map((group) => ({ ...group, dispatches: true })),
    ...STANDALONE_ROUTES.map((route) => ({
      file: route,
      maxDuration: WEBSOCKET_FUNCTION_MAX_DURATION_SECONDS,
      routes: [route],
      dispatches: false,
    })),
  ];
  return definitions.sort((left, right) => left.file.localeCompare(right.file));
}
