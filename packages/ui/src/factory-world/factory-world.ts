import type { FactoryWorld } from "@luke/features/factory-world-wire";
import { AGENT_STATE, type AgentState, type AgentView, agentViewOf } from "./agent-reading.js";
import { aliveByZoneOf, type TimelineEntry, timelineOf } from "./shipped-reading.js";
import {
  reachOf,
  type ZoneEdge,
  type ZoneLayer,
  zoneEdgesOf,
  zoneOfAreaIn,
  zoneReadingsOf,
} from "./zone-graph.js";
import { type ZonePlacement, zoneFootprintOf, zonePlacementOf } from "./zone-layout.js";

/**
 * factory-world.ts -- one Factory world snapshot turned into what every world draws.
 *
 * A world (the Factory's citadel, planet, railway, and the rest) draws the
 * same reading in its own geometry: the zones in their layers, placed on a
 * polar floor and sized by bytes; the dependencies between them; the agents
 * at work, each where it builds and in the state it stands; the glow of what
 * merged; and the counts the shared top bar shows. `factoryWorldViewOf`
 * reads it all from one snapshot, `blastRadiusOf` answers a selected
 * agent's ripple, and `factoryWorldAsOf` winds a snapshot back to an instant
 * on the scrubber before it is read.
 *
 * It touches no DOM, React, or Three.js, so every world, and a test, reads
 * the same view. The parts are their own modules: `zone-graph.ts` for the
 * layers, `zone-layout.ts` for the floor, `agent-reading.ts` for the agents,
 * `shipped-reading.ts` for the glow and the timeline, `world-as-of.ts` for
 * the scrubber, and `signal-palette.ts` for the colours.
 */

/** @public The types the Factory's scene host and its worlds (PR 5 and the world PRs) name their props by. */
export type { AgentKind, AgentState, AgentView, TouchedZone } from "./agent-reading.js";
export {
  AGENT_KIND,
  AGENT_STATE,
  AGENT_STUCK_AFTER_MS,
  BUILD_FULL_LINES,
} from "./agent-reading.js";
/** @public */
export type { TimelineEntry } from "./shipped-reading.js";
export { SCENE_GROUND, SIGNAL_COLOR, SIGNAL_MIN_CONTRAST } from "./signal-palette.js";
export { factoryWorldAsOf } from "./world-as-of.js";
/** @public */
export type { ZoneEdge, ZoneEdgeKind, ZoneLayer } from "./zone-graph.js";
export { ZONE_EDGE_KIND, ZONE_LAYER } from "./zone-graph.js";
/** @public */
export type { ZonePlacement } from "./zone-layout.js";
export { ZONE_LAYOUT } from "./zone-layout.js";

/** What a world draws of one zone. */
export interface ZoneView extends ZonePlacement {
  readonly path: string;
  readonly label: string;
  readonly files: number;
  readonly bytes: number;
  readonly layer: ZoneLayer;
  /** Its layer's ring, counted outward from the core, the tooling ring outermost. */
  readonly ring: number;
  /** The longest chain of dependencies beneath it on its side, product or tooling; zero for none. */
  readonly depth: number;
  /** Of the snapshot's largest zone, from `ZONE_LAYOUT.FOOTPRINT_FLOOR` to 1, by `sqrt(bytes)`. */
  readonly footprint: number;
  /** The zones it depends on directly, by path, sorted. */
  readonly dependsOn: readonly string[];
  /** The zones that depend on it directly, by path, sorted. */
  readonly dependents: readonly string[];
  /** How many of the product's zones depend on it, transitively; zero for a tooling zone. */
  readonly transitiveDependents: number;
  /** How alive it is with recent merges, in [0, 1). */
  readonly alive: number;
}

/**
 * The counts the shared top bar shows, left to right: issues planned, agents
 * building (working, or waiting on the developer) with those stuck counted
 * apart, pull requests shipped within the window, and defects, which loop
 * back to planned. A failed or idle agent is in none of them.
 *
 * @public The shared top bar's props (PR 5).
 */
export interface PipelineCounts {
  readonly planned: number;
  readonly building: number;
  readonly stuck: number;
  readonly shipped: number;
  readonly defects: number;
}

/** One zone a selected agent's work ripples out to, and how many dependencies away; zero for one it touched. */
export interface BlastZone {
  readonly path: string;
  readonly distance: number;
}

/** Everything a world draws of one snapshot. */
export interface FactoryWorldView {
  /** The instant the view reads, the scrubber's own where it was wound back. */
  readonly snapshotAt: number;
  /** Where the scrubber's window opens. */
  readonly shippedSince: number;
  /** Every zone, by path. */
  readonly zones: readonly ZoneView[];
  readonly zoneByPath: ReadonlyMap<string, ZoneView>;
  /** Every dependency between two zones, by `from` then `to`. */
  readonly edges: readonly ZoneEdge[];
  /** Every agent, in the snapshot's order. */
  readonly agents: readonly AgentView[];
  readonly agentById: ReadonlyMap<string, AgentView>;
  /** The merged pull requests, the earliest first: the scrubber's stops. */
  readonly timeline: readonly TimelineEntry[];
  readonly pipeline: PipelineCounts;
}

function pipelineOf(world: FactoryWorld, agents: readonly AgentView[]): PipelineCounts {
  const counting = (...states: readonly AgentState[]): number =>
    agents.filter((agent) => states.includes(agent.state)).length;
  return {
    planned: world.planned.length,
    building: counting(AGENT_STATE.WORKING, AGENT_STATE.WAITING),
    stuck: counting(AGENT_STATE.STUCK),
    shipped: world.shipped.length,
    defects: world.defects.length,
  };
}

/** Reads one snapshot into everything a world draws. */
export function factoryWorldViewOf(world: FactoryWorld): FactoryWorldView {
  const readings = zoneReadingsOf(world.zones);
  const zoneOfArea = zoneOfAreaIn([...readings.keys()]);
  const timeline = timelineOf(world.shipped, zoneOfArea);
  const alive = aliveByZoneOf(timeline, world.snapshotAt);
  const largestBytes = Math.max(0, ...world.zones.map((zone) => zone.bytes));
  const zoneByPath = new Map<string, ZoneView>();
  for (const zone of world.zones) {
    const reading = readings.get(zone.path);
    if (reading === undefined || zoneByPath.has(zone.path)) continue;
    zoneByPath.set(zone.path, {
      path: zone.path,
      label: zone.label,
      files: zone.files,
      bytes: zone.bytes,
      ...reading,
      ...zonePlacementOf(zone.path, reading.ring),
      footprint: zoneFootprintOf(zone.bytes, largestBytes),
      alive: alive.get(zone.path) ?? 0,
    });
  }
  const context = {
    now: world.snapshotAt,
    zoneOfArea,
    agents: world.agents,
    shipped: world.shipped,
  };
  const agents = world.agents.map((agent) => agentViewOf(agent, context));
  return {
    snapshotAt: world.snapshotAt,
    shippedSince: world.shippedSince,
    zones: [...readings.keys()].flatMap((path) => zoneByPath.get(path) ?? []),
    zoneByPath,
    edges: zoneEdgesOf(readings),
    agents,
    agentById: new Map(agents.map((agent) => [agent.id, agent])),
    timeline,
    pipeline: pipelineOf(world, agents),
  };
}

/**
 * The zones a selected agent's work ripples out to: those it touched, at
 * distance zero, then every zone that depends on one of them, transitively,
 * at its fewest dependencies away, the nearest first and equal distances by
 * path. An agent that touched no zone yet ripples from its primary zone; one
 * with neither, or an id the view does not hold, ripples nowhere.
 */
export function blastRadiusOf(view: FactoryWorldView, agentId: string): BlastZone[] {
  const agent = view.agentById.get(agentId);
  if (agent === undefined) return [];
  const touched = agent.touched.map((zone) => zone.path);
  const origins =
    touched.length > 0 ? touched : agent.primaryZone === null ? [] : [agent.primaryZone];
  const reach = reachOf(origins, (path) => view.zoneByPath.get(path)?.dependents ?? []);
  return [...reach]
    .map(([path, distance]) => ({ path, distance }))
    .sort((left, right) => left.distance - right.distance || (left.path < right.path ? -1 : 1));
}
