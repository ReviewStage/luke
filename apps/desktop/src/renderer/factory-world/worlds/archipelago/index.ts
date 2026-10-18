import {
  PICK_KIND,
  type PickKind,
  type WorldModule,
  type WorldState,
} from "@luke/panel/factory-world/world";
import type { ZoneView } from "@luke/ui/factory-world";
import { Vector3 } from "three";
import { bridgesOf } from "./bridges";
import { buildersOf } from "./builders";
import { defectsOf } from "./defects";
import { effectsOf, type SmokeSource } from "./effects";
import { archipelagoOf } from "./islands";
import { skyOf } from "./mood";
import { plannedOf } from "./planned";
import { shippedOf } from "./shipped";
import { CHOSEN, type Chosen, writeZoneLights, zoneUniformsOf } from "./zone-light";

/**
 * index.ts -- the Sky Archipelago: the repository as floating islands in a sunset sky, each zone an island hung from strata, tied to what it depends on by rope bridges and iron chains, its builders raising towers in scaffolding under hot-air balloons, its merges sailing as airships through a golden gate into the sun, its plans waiting as blueprint islands, and its defects raging as storms.
 *
 * The layers are rings, the core's ruins at the heart and the towns and
 * harbours a developer meets at the edge (`islands.ts`). The parts are their
 * own modules: `mood.ts` for the sky, `bridges.ts` for the dependencies,
 * `builders.ts` for the agents, `shipped.ts`, `planned.ts`, and
 * `defects.ts` for the signals, `effects.ts` for the particles, and
 * `zone-light.ts` for how a zone lights up. `update` is the only source of
 * what is drawn: the islands are rebuilt only when the zones themselves
 * change, which a refresh can do and a hover or the scrubber never does, and
 * everything else is rewritten in place. `frame` adds idle motion alone.
 */

/** The archipelago's size the establishing shot was framed for, and that shot: from above the sea, looking in over the rings. */
const FRAMED_EXTENT = 95;
const HOME = {
  position: new Vector3(-54, 44, 152),
  target: new Vector3(-6, 9, 0),
} as const;

/** The nearest the camera may come, and the farthest it may go at the framed size. */
const REACH = { NEAREST: 4, FARTHEST: 440 } as const;

/** Whether two readings hold the same zones, laid out alike: the only change that rebuilds the islands. */
function sameZones(left: readonly ZoneView[], right: readonly ZoneView[]): boolean {
  return (
    left.length === right.length &&
    left.every((zone, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.path === zone.path &&
        other.footprint === zone.footprint &&
        other.layer === zone.layer &&
        other.ring === zone.ring &&
        other.x === zone.x &&
        other.y === zone.y &&
        other.transitiveDependents === zone.transitiveDependents &&
        other.dependsOn.length === zone.dependsOn.length &&
        other.dependsOn.every((path, k) => path === zone.dependsOn[k])
      );
    })
  );
}

/** The id of what the developer selected, or hovers, of `kind`. */
function chosenId(target: WorldState["selected"], kind: PickKind): string | undefined {
  return target?.kind === kind ? target.id : undefined;
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    host.camera.setHome(HOME.position, HOME.target);
    host.camera.setReach(REACH.NEAREST, REACH.FARTHEST);

    const sky = skyOf(scene);
    const time = sky.uniforms.uTime;
    const zoneUniforms = zoneUniformsOf(palette, { time, glow: sky.glow });
    const effects = effectsOf(scene);
    const archipelago = archipelagoOf(scene, picking, zoneUniforms, time);
    const bridges = bridgesOf(scene, zoneUniforms);
    const builders = buildersOf(scene, picking, palette, zoneUniforms, effects);
    const shipped = shippedOf(scene, picking, palette, effects, sky.glow, time);
    const planned = plannedOf(scene, picking, palette, time, zoneUniforms.uStill);
    const defects = defectsOf(scene, picking, palette, sky.uniforms, effects);

    let zones: readonly ZoneView[] | undefined;
    let dark: boolean | undefined;
    let elapsedSoFar = 0;
    let smoking:
      | { chimneys: readonly Vector3[]; cracks: readonly SmokeSource[]; failed: readonly Vector3[] }
      | undefined;

    /** Rebuilds the islands and their bridges for `next`, and frames the shot and the sun's shadow to them. */
    const rebuild = (next: readonly ZoneView[]) => {
      archipelago.build(next, bridges.build);
      const extent = archipelago.extent();
      sky.fit(extent);
      const { middle, span } = archipelago.framing();
      const scale = Math.max(0.45, span / FRAMED_EXTENT);
      const target = new Vector3(
        middle.x + HOME.target.x * scale,
        HOME.target.y,
        middle.z + HOME.target.z * scale,
      );
      host.camera.setHome(
        HOME.position.clone().sub(HOME.target).multiplyScalar(scale).add(target),
        target,
      );
      host.camera.setReach(REACH.NEAREST, Math.max(REACH.FARTHEST, extent * 4.5));
      zones = next;
    };

    return {
      update: (state) => {
        const { view, layers, still } = state;
        if (dark !== state.dark) {
          sky.setDark(state.dark);
          dark = state.dark;
        }
        zoneUniforms.uStill.value = still ? 1 : 0;
        effects.setShown(!still);
        if (zones === undefined || !sameZones(zones, view.zones)) rebuild(view.zones);
        const isles = archipelago.isles();
        const extent = archipelago.extent();
        const elapsed = still ? 0 : elapsedSoFar;
        const selected = (kind: PickKind) => chosenId(state.selected, kind);
        const hovered = (kind: PickKind) => chosenId(state.hovered, kind);

        defects.update({
          defects: state.snapshot.defects,
          isles,
          extent,
          shown: layers.defects,
          selected: selected(PICK_KIND.DEFECT),
          hovered: hovered(PICK_KIND.DEFECT),
          still,
        });
        const damage = defects.damage();
        writeZoneLights(zoneUniforms, view.zones.length, (index) => {
          const zone = view.zones[index];
          const path = zone?.path;
          const chosen: Chosen =
            selected(PICK_KIND.ZONE) === path
              ? CHOSEN.SELECTED
              : hovered(PICK_KIND.ZONE) === path
                ? CHOSEN.HOVERED
                : CHOSEN.NONE;
          return {
            blast: path === undefined ? undefined : state.blast.get(path),
            alive: layers.shipped ? (zone?.alive ?? 0) : 0,
            chosen,
            damage: layers.defects && path !== undefined ? (damage.get(path) ?? 0) : 0,
          };
        });
        archipelago.ring(state.blast);
        archipelago.setLanterns(layers.shipped);

        builders.update({
          agents: view.agents,
          isles,
          extent,
          building: layers.building,
          failed: layers.defects,
          selected: selected(PICK_KIND.AGENT),
          hovered: hovered(PICK_KIND.AGENT),
          still,
          elapsed,
        });
        shipped.update({
          timeline: view.timeline,
          instant: view.snapshotAt,
          windowOpens: view.shippedSince,
          isles,
          extent,
          shown: layers.shipped,
          live: state.live,
          still,
          elapsed,
          zones: view.zoneByPath,
          chosen: (url) =>
            selected(PICK_KIND.SHIPPED) === url
              ? "selected"
              : hovered(PICK_KIND.SHIPPED) === url
                ? "hovered"
                : undefined,
        });
        planned.update({
          planned: state.snapshot.planned,
          isles,
          extent,
          shown: layers.planned,
          selected: selected(PICK_KIND.PLANNED),
          hovered: hovered(PICK_KIND.PLANNED),
        });
        const smoke = {
          chimneys: archipelago.chimneys(),
          cracks: layers.defects ? defects.smoke() : [],
          failed: builders.smoking(),
        };
        if (
          smoking === undefined ||
          smoking.chimneys !== smoke.chimneys ||
          smoking.cracks !== smoke.cracks ||
          smoking.failed !== smoke.failed
        ) {
          effects.setSmoke(
            [
              ...smoke.chimneys.map((at) => ({ at, dark: false })),
              ...smoke.cracks,
              ...smoke.failed.map((at) => ({ at, dark: true })),
            ],
            true,
          );
          smoking = smoke;
        }
        if (!still) return;
        sky.placeStill();
        archipelago.placeStill();
        shipped.placeStill();
        planned.placeStill();
      },
      frame: (delta, elapsed) => {
        elapsedSoFar = elapsed;
        sky.frame(elapsed);
        archipelago.frame(elapsed);
        builders.frame(delta, elapsed);
        shipped.frame(delta, elapsed);
        planned.frame(elapsed);
        defects.frame(delta, elapsed);
        effects.frame(delta);
      },
      // Note that the zone texture lives in the shaders' uniforms rather than on a material, where the host's disposal would not reach it.
      dispose: () => zoneUniforms.uZones.value.dispose(),
    };
  },
};
