import {
  FACTORY_WORLD_BOUNDS,
  type FactoryPlanned,
  LINEAR_PRIORITY,
  type LinearPriority,
} from "@luke/features/factory-world-wire";
import {
  AdditiveBlending,
  Color,
  InstancedMesh,
  Matrix4,
  Quaternion,
  type Scene,
  Vector3,
} from "three";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import { CITY, type CityLayout, DISTRICT_KIND, type District, SURVEY_BAND } from "./city";
import { bendableTube, clamp, GLSL_BEND, geodesicDome, instancedAttribute } from "./geometry";
import { DOME_MODE, domeLookOf, domesOf } from "./glass";
import { bentLength } from "./pipes";
import { type Sea, TAU } from "./sea";

/**
 * planned.ts -- the Linear issues as Atlantis draws them: holograms of domes not yet built, waiting in the survey band between the domain's ring and the surface's, each tethered by a dashed line of light to the zones its work will touch, and woken by the plaza's sonar as it sweeps past.
 *
 * A blueprint stands between the first two of its zones, or just inward
 * of its only one; one placed on no zone waits in the survey band at a
 * bearing of its own. Its size is its priority. Blueprints are pushed apart
 * from each other and from the districts so none hides another.
 */

const BLUEPRINTS = FACTORY_WORLD_BOUNDS.MAX_PLANNED;

/** The most zones one blueprint's tethers reach. */
const TETHERS_EACH = 4;
const TETHERS = BLUEPRINTS * TETHERS_EACH;

/** A blueprint's radius by its issue's priority: the more pressing, the larger. */
const PRIORITY_RADIUS = {
  [LINEAR_PRIORITY.NONE]: 6,
  [LINEAR_PRIORITY.URGENT]: 12,
  [LINEAR_PRIORITY.HIGH]: 10,
  [LINEAR_PRIORITY.MEDIUM]: 7,
  [LINEAR_PRIORITY.LOW]: 5,
} as const satisfies Record<LinearPriority, number>;

/** How fast the plaza's sonar sweeps round, in radians a second: the plaza's shader turns at the same rate. */
const SWEEP_SPEED = 0.45;

/** Planned issues, drawn. */
export interface Planned {
  /** Draws `planned` over `layout`, `chosen` lit in the selection's colour; or hides them. */
  readonly draw: (
    layout: CityLayout,
    planned: readonly FactoryPlanned[],
    chosen: (identifier: string) => boolean,
    shown: boolean,
  ) => void;
  /** Wakes each blueprint as the sonar passes, at `elapsed`; held still, each stands half awake. */
  readonly sweep: (elapsed: number, moving: boolean) => void;
}

const TETHER_VERTEX = /* glsl */ `${GLSL_BEND}
attribute vec4 aTether;
varying vec2 vUv; varying float vDepth; varying vec4 vTether;
void main(){
  vec3 p = bendTube(position, 0.22);
  vUv = uv; vTether = aTether;
  vec4 mv = viewMatrix*modelMatrix*vec4(p,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const TETHER_FRAGMENT = /* glsl */ `
uniform vec3 uPlanned; uniform vec3 uSelection;
varying vec2 vUv; varying float vDepth; varying vec4 vTether;
void main(){
  float len = vTether.x; float ping = vTether.y;
  float run = fract(vUv.x*len/3.0 - uTime*0.9);
  float dash = smoothstep(0.35, 0.5, run) * (1.0 - smoothstep(0.75, 0.9, run));
  float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  vec3 col = mix(uPlanned, uSelection, vTether.z)*1.6;
  vec3 c = col * dash * ends * (0.7 + ping*1.2);
  gl_FragColor = vec4(c*(1.0-fogF(vDepth)), 1.0);
}`;

/** Where a blueprint aims at `district` from: the great dome's wall for a crystal, its own centre for the rest. */
function anchorOf(district: District): Vector3 {
  if (district.kind !== DISTRICT_KIND.CRYSTAL) return district.centre.clone();
  return new Vector3(Math.cos(district.bearing), 0, Math.sin(district.bearing)).multiplyScalar(
    CITY.DOME_RADIUS + 8,
  );
}

/** One blueprint as placed: its issue, where it stands, how large, and the districts it is tethered to. */
interface Blueprint {
  readonly issue: FactoryPlanned;
  readonly at: Vector3;
  readonly radius: number;
  readonly zones: readonly District[];
}

/** Places each issue's blueprint, then pushes them apart, from each other and from the districts. */
function blueprintsOf(layout: CityLayout, planned: readonly FactoryPlanned[]): Blueprint[] {
  const middle = (SURVEY_BAND.INNER + SURVEY_BAND.OUTER) / 2;
  const placed = planned.slice(0, BLUEPRINTS).map((issue, order): Blueprint => {
    const zones = issue.zonePaths
      .map((path) => layout.byPath.get(path))
      .filter((district) => district !== undefined);
    const radius = PRIORITY_RADIUS[issue.priority ?? LINEAR_PRIORITY.NONE];
    const [first, second] = zones;
    let at: Vector3;
    if (first === undefined) {
      const bearing = Math.PI / 2 + order * 2.39996;
      at = new Vector3(Math.cos(bearing) * middle, 0, Math.sin(bearing) * middle);
    } else if (second === undefined) {
      const from = anchorOf(first);
      const out = Math.hypot(from.x, from.z);
      const reach = first.kind === DISTRICT_KIND.CRYSTAL ? 0 : first.radius + radius + 8;
      at = from.setLength(Math.max(CITY.DOME_RADIUS + radius + 14, out - reach));
    } else {
      at = anchorOf(first).add(anchorOf(second)).multiplyScalar(0.5);
      const out = Math.hypot(at.x, at.z);
      if (out < SURVEY_BAND.INNER || out > SURVEY_BAND.OUTER) {
        at.setLength(clamp(out, SURVEY_BAND.INNER, SURVEY_BAND.OUTER));
      }
      if (out < 1e-3) at.set(middle, 0, 0);
    }
    return { issue, at: at.setY(0), radius, zones: zones.slice(0, TETHERS_EACH) };
  });
  // Note that a few passes, always in the same order, push neighbouring blueprints apart and out of the districts.
  for (let pass = 0; pass < 40; pass += 1) {
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue;
        const dx = a.at.x - b.at.x;
        const dz = a.at.z - b.at.z;
        let distance = Math.hypot(dx, dz);
        const need = a.radius + b.radius + 3;
        if (distance >= need) continue;
        // Note that two blueprints placed on one spot part along a bearing their places in the list name, so the push stays the same every time.
        let ux = dx / distance;
        let uz = dz / distance;
        if (distance < 0.01) {
          const bearing = placed.indexOf(a) * 2.39996 + placed.indexOf(b);
          ux = Math.cos(bearing);
          uz = Math.sin(bearing);
          distance = 0;
        }
        const push = (need - distance) / 2;
        a.at.x += ux * push;
        a.at.z += uz * push;
        b.at.x -= ux * push;
        b.at.z -= uz * push;
      }
      for (const district of layout.districts) {
        if (district.kind === DISTRICT_KIND.CRYSTAL) continue;
        const dx = a.at.x - district.centre.x;
        const dz = a.at.z - district.centre.z;
        const distance = Math.hypot(dx, dz);
        const need = a.radius + district.radius * 1.25 + 4;
        if (distance >= need || distance < 0.01) continue;
        a.at.x += (dx / distance) * (need - distance);
        a.at.z += (dz / distance) * (need - distance);
      }
      const out = Math.hypot(a.at.x, a.at.z);
      const least = CITY.DOME_RADIUS + CITY.DOME_CLEARANCE + a.radius;
      if (out < least && out > 0.01) a.at.multiplyScalar(least / out);
    }
  }
  return placed;
}

/** Planned work in `scene`, picked through `picking`. */
export function plannedOf(scene: Scene, sea: Sea, picking: WorldPicking): Planned {
  const plannedColor = new Color(sea.signal.PLANNED);
  const selection = new Color(sea.signal.SELECTION);
  const domes = domesOf(sea, geodesicDome(2), BLUEPRINTS, {
    opacity: 0.05,
    strutWidth: 0.016,
    strut: "#86f0ff",
    strutGain: 0.55,
  });
  scene.add(domes.mesh);
  const tetherShape = bendableTube(24, 5);
  const tetherFrom = instancedAttribute(tetherShape, "aFrom", 3, TETHERS);
  const tetherBend = instancedAttribute(tetherShape, "aBend", 3, TETHERS);
  const tetherTo = instancedAttribute(tetherShape, "aTo", 3, TETHERS);
  const tetherLook = instancedAttribute(tetherShape, "aTether", 4, TETHERS);
  const tethers = new InstancedMesh(
    tetherShape,
    sea.shader(
      { uPlanned: { value: plannedColor }, uSelection: { value: selection } },
      TETHER_VERTEX,
      TETHER_FRAGMENT,
      { transparent: true, depthWrite: false, blending: AdditiveBlending },
    ),
    TETHERS,
  );
  tethers.count = 0;
  tethers.frustumCulled = false;
  tethers.renderOrder = 4;
  scene.add(tethers);

  let blueprintTargets: PickTarget[] = [];
  picking.addInstances(domes.mesh, (instanceId) => blueprintTargets[instanceId]);

  let blueprints: Blueprint[] = [];
  let picked: boolean[] = [];
  let tetherOwners: number[] = [];
  let shown = true;
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const size = new Vector3();
  const look = domeLookOf();
  const start = new Vector3();
  const end = new Vector3();
  const bend = new Vector3();

  const wake = (elapsed: number, moving: boolean) => {
    const sweepAt = (elapsed * SWEEP_SPEED) % TAU;
    blueprints.forEach((blueprint, index) => {
      const bearing = Math.atan2(blueprint.at.z, blueprint.at.x);
      const behind = (((sweepAt - bearing) % TAU) + TAU) % TAU;
      const ping = moving ? Math.exp(-behind * 2.2) : 0.35;
      const chosen = picked[index] === true;
      matrix.compose(
        blueprint.at.clone().setY(0.4),
        turn.identity(),
        size.setScalar(blueprint.radius),
      );
      look.color.copy(chosen ? selection : plannedColor);
      look.highlight.copy(chosen ? selection : plannedColor);
      look.lit = sea.mood().hologram + ping * 0.8 + (chosen ? 0.7 : 0);
      look.mode = DOME_MODE.HOLOGRAM;
      look.fill = 1;
      look.dim = 1;
      look.steps = -1;
      look.seed = index * 0.1;
      domes.place(index, matrix, look);
    });
    domes.finish(shown ? blueprints.length : 0);
    tetherOwners.forEach((owner, index) => {
      const blueprint = blueprints[owner];
      if (blueprint === undefined) return;
      const bearing = Math.atan2(blueprint.at.z, blueprint.at.x);
      const behind = (((sweepAt - bearing) % TAU) + TAU) % TAU;
      tetherLook.setY(
        index,
        (moving ? Math.exp(-behind * 2.2) : 0.5) + (picked[owner] === true ? 1 : 0),
      );
    });
    tetherLook.needsUpdate = true;
  };

  let lastElapsed = 0;
  let lastMoving = false;
  return {
    draw: (layout, planned, chosen, visible) => {
      shown = visible;
      blueprints = blueprintsOf(layout, planned);
      picked = blueprints.map((blueprint) => chosen(blueprint.issue.identifier));
      blueprintTargets = blueprints.map((blueprint) => ({
        kind: PICK_KIND.PLANNED,
        id: blueprint.issue.identifier,
      }));
      tetherOwners = [];
      blueprints.forEach((blueprint, owner) => {
        for (const district of blueprint.zones) {
          const index = tetherOwners.length;
          const anchor = district.kind === DISTRICT_KIND.CRYSTAL ? new Vector3() : district.centre;
          const out = new Vector3(
            blueprint.at.x - anchor.x,
            0,
            blueprint.at.z - anchor.z,
          ).normalize();
          const reach =
            district.kind === DISTRICT_KIND.CRYSTAL
              ? CITY.DOME_RADIUS + 2
              : district.radius * (district.kind === DISTRICT_KIND.DOME ? 1 : 1.2) + 3;
          end.copy(anchor).addScaledVector(out, reach).setY(0.8);
          start.copy(blueprint.at).setY(0.8).addScaledVector(out, -blueprint.radius);
          bend.lerpVectors(start, end, 0.5).setY(4 + start.distanceTo(end) * 0.06);
          bend.multiplyScalar(2).addScaledVector(start, -0.5).addScaledVector(end, -0.5);
          tetherFrom.setXYZ(index, start.x, start.y, start.z);
          tetherBend.setXYZ(index, bend.x, bend.y, bend.z);
          tetherTo.setXYZ(index, end.x, end.y, end.z);
          tetherLook.setXYZW(
            index,
            bentLength(start, bend, end),
            0,
            picked[owner] === true ? 1 : 0,
            0,
          );
          tetherOwners.push(owner);
        }
      });
      tethers.count = shown ? tetherOwners.length : 0;
      for (const attribute of [tetherFrom, tetherBend, tetherTo, tetherLook])
        attribute.needsUpdate = true;
      wake(lastElapsed, lastMoving);
    },
    sweep: (elapsed, moving) => {
      lastElapsed = elapsed;
      lastMoving = moving;
      wake(elapsed, moving);
    },
  };
}
