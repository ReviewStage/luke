import {
  FACTORY_WORLD_BOUNDS,
  type FactoryDefect,
  type FactoryPlanned,
} from "@luke/features/factory-world-wire";
import {
  AGENT_STATE,
  type AgentState,
  agentDrawnUnder,
  type FactoryWorldView,
} from "@luke/ui/factory-world";
import { Color } from "three";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldModule,
  type WorldState,
} from "../../world";
import { BLAST_STEP, burrowsMeshesOf, type ZoneLook } from "./burrows";
import { type Casting, colonyOf, TEAM_POSE, type TeamPose } from "./colony";
import { type Burrows, burrowsOf, type Chamber, sameShape } from "./layout";
import { roomOf } from "./room";
import { damageOf, signalsOf } from "./signals";
import { grainTexture, soilFace, turf } from "./soil";

/**
 * index.ts -- the Ant Colony: the repository as an ant farm in a glass terrarium on a desk, its zones the chambers the colony has dug, its agents the ant teams carrying their work between them.
 *
 * Depth is the layer (`layout.ts`): anthills on the meadow for the surface,
 * the domain's chambers below them, the core deeper, the zones the product
 * leans on most in the bedrock, and tooling as workshops against the walls,
 * every dependency a tunnel. An agent is a team of ants (`colony.ts`) in
 * the building colour, carrying a load sized by its pull request's lines;
 * choosing one lights its blast radius, a ripple in the blast colour out
 * along the tunnels from the chambers it touched, chamber by chamber, a
 * step further each half second. Shipped work is honeydew stored in the
 * chambers it landed in and flowers on the anthills, glowing while fresh;
 * a planned issue is a chalk outline of a chamber not yet dug; a defect is
 * beetles in the burrows, cracks in the soil, rubble, and a flood where the
 * damage runs deep (`signals.ts`).
 *
 * The world holds no clock of its own. `update` draws everything from the
 * state it is handed; `frame` only walks the ants, sways the grass, and
 * ripples what `update` already lit. The burrows are laid out again, and
 * the soil repainted, only when the reading's shape or its defects change.
 */

/** The idle team's ants, a dull brown no signal wears. */
const RESTING_INK = "#7a6a5a";

const POSE_OF_STATE = {
  [AGENT_STATE.WORKING]: TEAM_POSE.WORK,
  [AGENT_STATE.WAITING]: TEAM_POSE.WAIT,
  [AGENT_STATE.STUCK]: TEAM_POSE.SLEEP,
  [AGENT_STATE.FAILED]: TEAM_POSE.DOWN,
  [AGENT_STATE.IDLE]: TEAM_POSE.REST,
} as const satisfies { readonly [S in AgentState]: TeamPose };

/** The ids of what the developer chose or hovers, of `kind`. */
function chosenOf(state: WorldState, kind: PickKind): Set<string> {
  return new Set(
    [state.selected, state.hovered].flatMap((target) => (target?.kind === kind ? [target.id] : [])),
  );
}

function samePaths(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((path, index) => path === b[index]);
}

function sameBlast(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...a].every(([path, distance]) => b.get(path) === distance);
}

function samePlanned(a: readonly FactoryPlanned[], b: readonly FactoryPlanned[]): boolean {
  return (
    a.length === b.length &&
    a.every((issue, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        issue.identifier === other.identifier &&
        issue.priority === other.priority &&
        samePaths(issue.zonePaths, other.zonePaths)
      );
    })
  );
}

function sameDefects(a: readonly FactoryDefect[], b: readonly FactoryDefect[]): boolean {
  return (
    a.length === b.length &&
    a.every((defect, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        defect.id === other.id &&
        defect.events === other.events &&
        samePaths(defect.zonePaths, other.zonePaths)
      );
    })
  );
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    host.camera.setHome({ x: 16, y: 26, z: 118 }, { x: 0, y: -18.5, z: -5 });
    host.camera.setReach(5, 240);

    const time = { value: 0 };
    const grain = grainTexture();
    const soil = soilFace();
    const room = roomOf(scene, { soil, turf: turf(), grain, time });
    const burrowsMeshes = burrowsMeshesOf(scene, grain, time);
    const colony = colonyOf(scene, {
      selection: palette.signal.SELECTION,
      shipped: palette.signal.SHIPPED,
    });
    const signals = signalsOf(scene, grain, time, {
      shipped: palette.signal.SHIPPED,
      planned: palette.signal.PLANNED,
      defect: palette.signal.DEFECT,
      selection: palette.signal.SELECTION,
    });
    const ink = {
      building: new Color(palette.signal.BUILDING),
      defect: new Color(palette.signal.DEFECT),
      resting: new Color(RESTING_INK),
    };
    const lit = {
      selection: new Color(palette.signal.SELECTION),
      blast: new Color(palette.signal.BLAST_RADIUS),
      defect: new Color(palette.signal.DEFECT),
      shipped: new Color(palette.signal.SHIPPED),
    };

    let burrows: Burrows | undefined;
    let laidFrom: FactoryWorldView | undefined;
    let shippedFrom: FactoryWorldView | undefined;
    let planned: readonly FactoryPlanned[] | undefined;
    let defects: readonly FactoryDefect[] | undefined;
    let damage = new Map<number, number>();
    let woundsShown: boolean | undefined;
    let dark: boolean | undefined;
    let state: WorldState | undefined;
    let elapsed = 0;
    let blastFrom: string | undefined;
    let blastAt = 0;
    let blastShown: ReadonlyMap<string, number> = new Map();
    const looks: ZoneLook[] = Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_ZONES }, () => ({
      rim: new Color(),
      strength: 0,
      glow: new Color(),
    }));
    const distances = new Map<number, number>();
    let chosen = { zones: new Set<string>(), agents: new Set<string>() };

    const zoneOf = (index: number | undefined): PickTarget | undefined => {
      const chamber = index === undefined ? undefined : burrows?.chambers[index];
      return chamber === undefined ? undefined : { kind: PICK_KIND.ZONE, id: chamber.zone.path };
    };
    for (const part of burrowsMeshes.pickable)
      picking.addInstances(part.mesh, (instance) => zoneOf(part.owners[instance]));
    const targetOf = (kind: PickKind, id: string | undefined): PickTarget | undefined =>
      id === undefined ? undefined : { kind, id };
    picking.addInstances(colony.standIns, (instance) =>
      targetOf(PICK_KIND.AGENT, colony.agentAt(instance)),
    );
    picking.addInstances(signals.honey, (instance) =>
      targetOf(PICK_KIND.SHIPPED, signals.honeyAt(instance)),
    );
    picking.addInstances(signals.petals, (instance) =>
      targetOf(PICK_KIND.SHIPPED, signals.flowerAt(instance)),
    );
    picking.addInstances(signals.ghosts, (instance) =>
      targetOf(PICK_KIND.PLANNED, signals.ghostAt(instance)),
    );
    picking.addInstances(signals.beetles, (instance) =>
      targetOf(PICK_KIND.DEFECT, signals.beetleAt(instance)),
    );

    /** Sets one zone's look for `now`: chosen over the blast radius as far as it has rippled, over a defect's pulse, each over how alive it is. */
    const lookOf = (
      look: ZoneLook,
      chamber: Chamber,
      now: WorldState,
      since: number,
      t: number,
    ) => {
      const path = chamber.zone.path;
      const distance = now.blast.get(path);
      const wound = now.layers.defects ? (damage.get(chamber.index) ?? 0) : 0;
      const alive = now.layers.shipped ? (now.view.zoneByPath.get(path)?.alive ?? 0) : 0;
      look.strength = 0;
      look.glow.copy(lit.shipped).multiplyScalar(alive * 0.22);
      if (chosen.zones.has(path)) {
        look.rim.copy(lit.selection);
        look.strength = now.selected?.id === path ? 1 : 0.85;
        look.glow.copy(lit.selection).multiplyScalar(0.3);
      } else if (distance !== undefined && since - distance * BLAST_STEP > 0) {
        const ring = Math.exp(-(since - distance * BLAST_STEP) * 2.2);
        look.rim.copy(lit.blast);
        look.strength =
          distance === 0 ? 1 : Math.min(1, 0.55 + 0.45 * ring + 0.1 * Math.sin(t * 3));
        look.glow.copy(lit.blast).multiplyScalar(distance === 0 ? 0.45 : 0.18 + 0.4 * ring);
      } else if (wound >= 1) {
        const k = Math.min(1, 0.3 + 0.13 * Math.log2(1 + wound));
        look.rim.copy(lit.defect);
        look.strength = now.still
          ? k * 0.8
          : k * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.6 + chamber.sa)));
      }
    };

    /** Lights every zone for `now`, and ripples the blast radius as far as it has run. */
    const light = (now: WorldState) => {
      if (burrows === undefined) return;
      const since = now.still ? Number.POSITIVE_INFINITY : elapsed - blastAt;
      const t = now.still ? 0 : elapsed;
      distances.clear();
      for (const chamber of burrows.chambers) {
        const look = looks[chamber.index];
        if (look === undefined) continue;
        lookOf(look, chamber, now, since, t);
        const distance = now.blast.get(chamber.zone.path);
        if (distance !== undefined) distances.set(chamber.index, distance);
      }
      burrowsMeshes.light(looks, burrows.chambers.length);
      burrowsMeshes.blast(distances, since, lit.blast);
    };

    /** Lays the burrows out again where the reading's shape changed, and repaints what follows from them. */
    const relay = (next: WorldState) => {
      if (burrows !== undefined && laidFrom !== undefined && sameShape(laidFrom, next.view))
        return false;
      burrows = burrowsOf(next.view);
      laidFrom = next.view;
      burrowsMeshes.layout(burrows);
      room.plant(burrows);
      colony.layout(burrows);
      return true;
    };

    const castingsOf = (next: WorldState): Casting[] =>
      next.view.agents.flatMap((agent) => {
        const failed = agent.state === AGENT_STATE.FAILED;
        if (!agentDrawnUnder(agent, next.layers)) return [];
        const resting = agent.state === AGENT_STATE.IDLE;
        return [
          {
            agent,
            pose: POSE_OF_STATE[agent.state],
            ink: failed ? ink.defect : resting ? ink.resting : ink.building,
            site: failed ? ink.defect : resting ? undefined : ink.building,
          },
        ];
      });

    return {
      update: (next) => {
        state = next;
        if (dark !== next.dark) {
          dark = next.dark;
          room.setDark(next.dark);
        }
        const moved = relay(next);
        const laid = burrows;
        if (laid === undefined) return;
        if (moved || shippedFrom !== next.view) {
          shippedFrom = next.view;
          const alive = laid.chambers.map(
            (chamber) => next.view.zoneByPath.get(chamber.zone.path)?.alive ?? 0,
          );
          const sparks = signals.ship(next.view.timeline, alive, laid, next.view.snapshotAt);
          if (!next.still) for (const at of sparks) colony.spark(at);
        }
        if (moved || planned === undefined || !samePlanned(planned, next.snapshot.planned)) {
          planned = next.snapshot.planned;
          signals.plan(planned, laid);
        }
        const woundsChanged =
          moved || defects === undefined || !sameDefects(defects, next.snapshot.defects);
        if (woundsChanged) {
          defects = next.snapshot.defects;
          signals.wound(defects, laid);
          damage = damageOf(defects, laid);
        }
        if (woundsChanged || woundsShown !== next.layers.defects) {
          woundsShown = next.layers.defects;
          soil.paint(laid, next.layers.defects ? damage : new Map());
        }
        const selectedAgent =
          next.selected?.kind === PICK_KIND.AGENT ? next.selected.id : undefined;
        // Note that a fresh read can move the same agent's blast radius, and a moved one ripples out again.
        if (selectedAgent !== blastFrom || !sameBlast(blastShown, next.blast)) {
          blastFrom = selectedAgent;
          blastAt = elapsed;
        }
        blastShown = next.blast;
        colony.cast(castingsOf(next), laid);
        signals.show({
          shipped: next.layers.shipped,
          planned: next.layers.planned,
          defects: next.layers.defects,
          chosenShipped: chosenOf(next, PICK_KIND.SHIPPED),
          chosenPlanned: chosenOf(next, PICK_KIND.PLANNED),
          chosenDefects: chosenOf(next, PICK_KIND.DEFECT),
        });
        chosen = { zones: chosenOf(next, PICK_KIND.ZONE), agents: chosenOf(next, PICK_KIND.AGENT) };
        light(next);
        colony.pose(0, elapsed, !next.still, chosen.agents);
        signals.step(0, elapsed, !next.still);
      },
      frame: (delta, at) => {
        elapsed = at;
        time.value = at;
        room.step(at);
        if (state === undefined) return;
        colony.pose(delta, at, true, chosen.agents);
        signals.step(delta, at, true);
        light(state);
      },
      // Note that the host lets go of what the scene's materials hold; these are held only by uniforms and copies.
      dispose: () => {
        burrowsMeshes.dispose();
        soil.rims.dispose();
        grain.dispose();
      },
    };
  },
};
