import { ASK_BOUNDS, HOSTED_SERVICE_PATH, VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { OBSERVATION_TICK, OBSERVATION_TICK_PATH } from "./hosted/observation-bounds.js";
import { TURN_EVENT_STREAM_BOUNDS, TURN_EVENT_STREAM_PATH } from "./hosted/turn-event-stream.js";

/**
 * A WebSocket connection to a Vercel Function lives as long as the function
 * may run, so the two voice functions carry the platform's longest generally
 * available duration.
 */
export const VOICE_FUNCTION_MAX_DURATION_SECONDS = 800;

const BRAIN_INFERENCE_MAX_DURATION_SECONDS = 120;

/** The per-turn read as its function is called: `brainTurnPath` rewritten onto its own function. */
const BRAIN_TURN_READ_PATH = "/api/brain/turns/turn";
/** A held turn read waits up to `ASK_BOUNDS.MAX_WAIT_MS`, with room for the standing reads either side of the wait. */
const BRAIN_TURN_READ_MAX_DURATION_SECONDS = Math.ceil(ASK_BOUNDS.MAX_WAIT_MS / 1000) + 15;
const BRAIN_EMBED_MAX_DURATION_SECONDS = 60;

const API_PREFIX = "/api/";

/** The path a client calls for the route bundled from `server/routes/<relative>.ts`. */
export function functionPath(routeRelativePath: string): string {
  return `${API_PREFIX}${routeRelativePath.replace(/\.ts$/, "")}`;
}

/** The route key of a client path: `server/routes/<key>.ts` answers `/api/<key>`. */
export function routeKeyOf(path: string): string {
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
export const FUNCTION_GROUP = {
  DEFAULT: "default",
  BRAIN_EMBED: "brain-embed",
  BRAIN_INFERENCE: "brain-inference",
  OBSERVATION_TICK: "observation-tick",
  TURN_EVENTS: "turn-events",
  TURN_READ: "turn-read",
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
   * route's own module. The voice routes export the `http.Server` Vercel
   * upgrades WebSockets into, which no fetch dispatcher can front, so each
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
    file: FUNCTION_GROUP.BRAIN_EMBED,
    maxDuration: BRAIN_EMBED_MAX_DURATION_SECONDS,
    routes: [routeKeyOf(HOSTED_SERVICE_PATH.BRAIN_EMBED)],
  },
  {
    file: FUNCTION_GROUP.BRAIN_INFERENCE,
    maxDuration: BRAIN_INFERENCE_MAX_DURATION_SECONDS,
    routes: [
      routeKeyOf(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2),
      routeKeyOf(HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS),
      routeKeyOf(HOSTED_SERVICE_PATH.BRAIN_PREFETCH),
    ],
  },
  {
    file: FUNCTION_GROUP.OBSERVATION_TICK,
    maxDuration: OBSERVATION_TICK.MAX_DURATION_SECONDS,
    routes: [routeKeyOf(OBSERVATION_TICK_PATH)],
  },
  {
    file: FUNCTION_GROUP.TURN_EVENTS,
    maxDuration: TURN_EVENT_STREAM_BOUNDS.MAX_DURATION_SECONDS,
    routes: [routeKeyOf(TURN_EVENT_STREAM_PATH)],
  },
  {
    file: FUNCTION_GROUP.TURN_READ,
    maxDuration: BRAIN_TURN_READ_MAX_DURATION_SECONDS,
    routes: [routeKeyOf(BRAIN_TURN_READ_PATH)],
  },
];

const STANDALONE_ROUTES: readonly string[] = [
  routeKeyOf(VOICE_SERVICE_PATH.SESSIONS),
  routeKeyOf(VOICE_SERVICE_PATH.INTRODUCTION),
];

/**
 * The functions a deploy carries, given every route key under `server/routes/`:
 * the grouped functions, the standalone voice functions, and the default
 * group over every route none of those claimed. Sorted by file, so the stubs,
 * the bundles, and the rewrites are written in one order.
 */
export function functionDefinitions(routeKeys: readonly string[]): readonly FunctionDefinition[] {
  const claimed = new Set([...GROUPS.flatMap((group) => group.routes), ...STANDALONE_ROUTES]);
  const unclaimed = routeKeys.filter((key) => !claimed.has(key));
  const definitions: FunctionDefinition[] = [
    { file: FUNCTION_GROUP.DEFAULT, routes: unclaimed, dispatches: true },
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

/**
 * The routes that may run longer than the platform's default, by the path the
 * client calls: the groups above read back as one map, for the bounds tests
 * that hold a route's timing budget under its function's duration.
 */
export const FUNCTION_MAX_DURATION_SECONDS: ReadonlyMap<string, number> = functionDurations();

function functionDurations(): ReadonlyMap<string, number> {
  const durations = new Map<string, number>();
  for (const definition of functionDefinitions([])) {
    if (definition.maxDuration === undefined) continue;
    for (const route of definition.routes) {
      durations.set(`${API_PREFIX}${route}`, definition.maxDuration);
    }
  }
  return durations;
}
