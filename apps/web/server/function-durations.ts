import { VOICE_SERVICE_PATH } from "@luke/features";
import { TERMINAL_RELAY } from "@luke/features/terminal-wire";
import {
  MAINTENANCE_SWEEP,
  MAINTENANCE_SWEEP_PATH,
} from "@luke/service/maintenance/maintenance-bounds";
import { ORPC_ROUTE_KEY } from "./function-dispatch.js";

/**
 * A WebSocket connection to a Vercel Function lives as long as the function
 * may run, so the WebSocket functions, the voice sessions and the terminal
 * relay, carry the platform's longest generally available duration.
 */
const VOICE_FUNCTION_MAX_DURATION_SECONDS = 800;

const API_PREFIX = "/api/";

/** The route key of a client path: `server/routes/<key>.ts` answers `/api/<key>`. */
function routeKeyOf(path: string): string {
  return path.slice(API_PREFIX.length);
}

/**
 * The deployed functions the routes are grouped into. Vercel's Node builder
 * detects, traces, and uploads each function separately and in series, at
 * several seconds apiece, so forty routes as forty functions were most of a
 * deploy; the routes now share one function per duration bound, because the
 * builder reads `maxDuration` from the function file and nothing narrower.
 * Grouping never moves a bound: a route joins a group whose duration is the
 * one it already had.
 */
const FUNCTION_GROUP = {
  DEFAULT: "default",
  MAINTENANCE_SWEEP: "maintenance-sweep",
} as const;
type FunctionGroup = (typeof FUNCTION_GROUP)[keyof typeof FUNCTION_GROUP];

export interface FunctionDefinition {
  /** The function's file under `api/` and `dist-functions/`, without its extension. */
  readonly file: string;
  /** The `maxDuration` the function's stub declares; absent for the platform's default. */
  readonly maxDuration?: number;
  /** The route keys the function answers. */
  readonly routes: readonly string[];
  /**
   * Whether the bundle is a generated dispatcher over the routes, or the one
   * route's own module. The voice route exports the `http.Server` Vercel
   * upgrades WebSockets into, which no fetch dispatcher can front, so it
   * stays a function of its own.
   */
  readonly dispatches: boolean;
}

interface GroupDefinition {
  readonly file: FunctionGroup;
  readonly maxDuration: number;
  readonly routes: readonly string[];
}

const GROUPS: readonly GroupDefinition[] = [
  {
    file: FUNCTION_GROUP.MAINTENANCE_SWEEP,
    maxDuration: MAINTENANCE_SWEEP.MAX_DURATION_SECONDS,
    routes: [routeKeyOf(MAINTENANCE_SWEEP_PATH)],
  },
];

/** The WebSocket services, each a function of its own: the voice sessions and the terminal relay. */
const STANDALONE_ROUTES: readonly string[] = [
  ...Object.values(VOICE_SERVICE_PATH),
  TERMINAL_RELAY.PATH,
].map(routeKeyOf);

/**
 * The functions a deploy carries, given every route key under `server/routes/`:
 * the grouped functions, the standalone WebSocket functions, and the default
 * group over every route none of those claimed and the hosted oRPC route,
 * which holds every path that is no route file's. Sorted by file, so the
 * bundles and the rewrites are written in one order.
 */
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
      maxDuration: VOICE_FUNCTION_MAX_DURATION_SECONDS,
      routes: [route],
      dispatches: false,
    })),
  ];
  return definitions.sort((left, right) => left.file.localeCompare(right.file));
}
