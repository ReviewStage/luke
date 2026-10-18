import {
  PICK_KIND,
  type PickTarget,
  type WorldModule,
  type WorldState,
} from "@luke/panel/factory-world/world";
import { type AgentView, agentDrawnUnder, type ZoneView } from "@luke/ui/factory-world";
import { Color, Vector4 } from "three";
import { gardeners } from "./gardeners";
import { GLOW_BLEND, glowField } from "./glow";
import { island } from "./island";
import { SUN_DIRECTION } from "./nature";
import { signals } from "./signals";
import { growSkeleton, type Skeleton } from "./skeleton";
import { sky } from "./sky";
import {
  type Clump,
  HEART_SLOT,
  MAX_WOUNDS,
  type SharedUniforms,
  wood,
  zonePicks,
  zoneTexture,
} from "./wood";

/**
 * index.ts -- the World Tree: the repository as a luminous tree on a floating island at dusk, its gardeners grafting their pull requests onto it.
 *
 * The core zones are its roots, read through the island's cut-away earth;
 * the domain zones braid its trunk and peel off as limbs; the surface zones
 * are the branches and the canopy; the tooling zones are sheds and lanterns
 * on the meadow (`skeleton.ts`). Agents are gardeners at their grafts
 * (`gardeners.ts`). Shipped work blossoms and floats up as lanterns, planned
 * work is holographic buds, and defects rot the wood (`signals.ts`). The
 * selected agent's blast radius ripples along the wood from what it touched
 * outward, the nearer first, and the selection and the hover light their
 * zone; both are a texel per zone (`wood.ts`), so neither rebuilds a mesh.
 *
 * The wood is regrown only when the zones themselves change. The gardeners
 * are re-planned when the agents do (a scrub, or a refresh) and the signals
 * re-placed when the timeline, the plans, or the defects do; a hover or a
 * selection only repaints.
 */

/** How far a ripple has to travel before the still frame shows every zone it reaches lit. */
const RIPPLE_SETTLED = 30;

/** The capacity of each glow cloud: everything that reserves points in it, rounded up. */
const GLOW_CAPACITY = {
  [GLOW_BLEND.ADD]: 1536,
  [GLOW_BLEND.OVER]: 512,
  [GLOW_BLEND.XRAY]: 512,
} as const;

/** Whether two readings of the zones grow the same tree. */
function sameZones(left: readonly ZoneView[], right: readonly ZoneView[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((zone, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      zone.path === other.path &&
      zone.layer === other.layer &&
      zone.footprint === other.footprint &&
      zone.angle === other.angle &&
      zone.radius === other.radius &&
      zone.transitiveDependents === other.transitiveDependents &&
      zone.dependsOn.length === other.dependsOn.length &&
      zone.dependsOn.every((path, at) => other.dependsOn[at] === path)
    );
  });
}

/** Whether `target` names the item of `kind` and `id`. */
function names(target: PickTarget | undefined, kind: PickTarget["kind"], id: string): boolean {
  return target?.kind === kind && target.id === id;
}

/** How chosen an item is: one selected, less hovered, none otherwise. */
function chosenIn(state: WorldState, kind: PickTarget["kind"], id: string): number {
  if (names(state.selected, kind, id)) return 1;
  return names(state.hovered, kind, id) ? 0.6 : 0;
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    const camera = host.camera.camera;
    host.camera.setHome({ x: 55, y: 12, z: 64 }, { x: 0, y: 4.5, z: 0 });
    host.camera.setReach(4, 140);

    const zones = zoneTexture();
    const shared: SharedUniforms = {
      uTime: { value: 0 },
      uZones: { value: zones },
      uBlastT: { value: RIPPLE_SETTLED },
      uWound: { value: Array.from({ length: MAX_WOUNDS }, () => new Vector4(0, -999, 0, 0)) },
      uWoundN: { value: 0 },
      uDefects: { value: 1 },
      uSunDir: { value: SUN_DIRECTION.clone() },
      uBlastColor: { value: new Color(palette.signal.BLAST_RADIUS) },
      uSelectColor: { value: new Color(palette.signal.SELECTION) },
      uShipColor: { value: new Color(palette.signal.SHIPPED) },
      uDefectColor: { value: new Color(palette.signal.DEFECT) },
      uNight: { value: 0 },
    };
    const glow = {
      add: glowField(GLOW_CAPACITY[GLOW_BLEND.ADD], GLOW_BLEND.ADD),
      over: glowField(GLOW_CAPACITY[GLOW_BLEND.OVER], GLOW_BLEND.OVER),
      xray: glowField(GLOW_CAPACITY[GLOW_BLEND.XRAY], GLOW_BLEND.XRAY),
    };
    scene.add(glow.add.points, glow.over.points, glow.xray.points);

    const air = sky(scene, camera, shared, glow.add);
    const fog = scene.fog;
    const meadow = island(scene, shared, fog?.color ?? new Color(), picking, glow);
    const tree = wood(shared);
    scene.add(tree.bark, tree.canopy.clumps, tree.canopy.cards);
    const picks = zonePicks(picking, tree.canopy);
    scene.add(picks.anchors, picks.segments);
    const crew = gardeners(scene, camera, shared, picking, palette.signal, glow);
    const work = signals(scene, shared, picking, palette.signal, glow);

    let skeleton: Skeleton | undefined;
    let grownFrom: readonly ZoneView[] = [];
    let clumpsOf = new Map<number, Clump[]>();
    let plannedFrom: readonly AgentView[] | undefined;
    let placedFrom: { view: WorldState["view"]; snapshot: WorldState["snapshot"] } | undefined;
    let blastFrom: WorldState["blast"] | undefined;
    let dark: boolean | undefined;
    let elapsedNow = 0;
    let blastStart = -RIPPLE_SETTLED;
    let stillNow = false;
    let ringFor: PickTarget | undefined;
    const blastColor = new Color(palette.signal.BLAST_RADIUS);
    const selectColor = new Color(palette.signal.SELECTION);

    const commit = () => {
      glow.add.commit();
      glow.over.commit();
      glow.xray.commit();
    };

    return {
      update: (state) => {
        const { view, layers } = state;
        stillNow = state.still;
        if (state.dark !== dark) {
          dark = state.dark;
          air.dress(state.dark);
        }
        if (skeleton === undefined || !sameZones(grownFrom, view.zones)) {
          const slotOf = new Map(view.zones.map((zone, index) => [zone.path, index]));
          skeleton = growSkeleton(view.zones, slotOf, HEART_SLOT);
          grownFrom = view.zones;
          const clumps = tree.grow(skeleton);
          picks.place(skeleton, clumps);
          meadow.place(skeleton);
          clumpsOf = new Map();
          for (const clump of clumps)
            clumpsOf.set(clump.slot, [...(clumpsOf.get(clump.slot) ?? []), clump]);
          plannedFrom = undefined;
          placedFrom = undefined;
        }
        grownFrom = view.zones;

        // Note that a failed agent is a defect as much as a builder, so it stands under Defects with the building layer off.
        const agents = view.agents.filter((agent) => agentDrawnUnder(agent, layers));
        if (
          plannedFrom === undefined ||
          plannedFrom.length !== agents.length ||
          agents.some((agent, index) => plannedFrom?.[index] !== agent)
        ) {
          crew.plan(agents, skeleton);
          plannedFrom = agents;
        }
        if (placedFrom?.view !== view || placedFrom.snapshot !== state.snapshot) {
          work.place({
            timeline: view.timeline,
            now: view.snapshotAt,
            planned: state.snapshot.planned,
            defects: state.snapshot.defects,
            skeleton,
            clumpsOf,
          });
          placedFrom = { view, snapshot: state.snapshot };
        }

        // Each zone's texel: blast reach and delay, shipped glow, and highlight.
        if (state.blast !== blastFrom) {
          blastFrom = state.blast;
          blastStart = elapsedNow;
        }
        const texels = zones.image.data;
        if (texels instanceof Float32Array) {
          texels.fill(0);
          view.zones.forEach((zone, slot) => {
            const distance = state.blast.get(zone.path);
            const at = slot * 4;
            if (distance !== undefined) {
              texels[at] = distance === 0 ? 1 : 0.55;
              texels[at + 1] = distance * 0.55;
            }
            texels[at + 2] = layers.shipped ? zone.alive : 0;
            texels[at + 3] = chosenIn(state, PICK_KIND.ZONE, zone.path);
          });
        }
        zones.needsUpdate = true;
        shared.uBlastT.value = state.still ? RIPPLE_SETTLED : elapsedNow - blastStart;

        crew.paint((agent) => chosenIn(state, PICK_KIND.AGENT, agent.id));
        work.paint((kind, id) => chosenIn(state, kind, id), {
          shipped: layers.shipped,
          planned: layers.planned,
          defects: layers.defects,
        });
        const tint = new Color();
        meadow.paint((path) => {
          const chosen = chosenIn(state, PICK_KIND.ZONE, path);
          if (chosen > 0) return tint.set("#ffffff").lerp(selectColor, 0.6 * chosen + 0.2);
          return state.blast.has(path) ? tint.set("#ffffff").lerp(blastColor, 0.6) : undefined;
        });
        const selected = state.selected;
        if (
          selected?.kind === PICK_KIND.AGENT &&
          !names(ringFor, selected.kind, selected.id) &&
          !state.still
        )
          crew.ring(selected.id);
        ringFor = selected;
        // Note that a still world is never stepped, so its update lays the whole frame; a moving one is laid by its next step.
        if (state.still) {
          crew.pose(0, elapsedNow, true);
          work.pose(0, elapsedNow, true);
        }
        commit();
      },
      frame: (delta, elapsed) => {
        elapsedNow = elapsed;
        shared.uTime.value = elapsed;
        shared.uBlastT.value = stillNow ? RIPPLE_SETTLED : elapsed - blastStart;
        air.drift(elapsed);
        meadow.drift(elapsed);
        const flared = work.tick(elapsed);
        if (flared !== undefined) crew.cheer(flared);
        crew.pose(delta, elapsed, false);
        work.pose(delta, elapsed, false);
        commit();
      },
      dispose: () => {
        zones.dispose();
        air.dispose();
      },
    };
  },
};
