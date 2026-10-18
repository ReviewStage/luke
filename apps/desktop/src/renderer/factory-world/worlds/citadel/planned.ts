import {
  FACTORY_WORLD_BOUNDS,
  type FactoryPlanned,
  LINEAR_PRIORITY,
} from "@luke/features/factory-world-wire";
import {
  PICK_KIND,
  type PickTarget,
  type WorldPalette,
  type WorldPicking,
  type WorldPoint,
} from "@luke/panel/factory-world/world";
import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  RingGeometry,
  ShaderMaterial,
} from "three";
import type { ZoneSite } from "./layout";
import { placed, polar } from "./math";
import type { Clearing } from "./terrain";
import { groundAt } from "./terrain";

/**
 * planned.ts -- the Linear issues planned, as blueprints: a tower of ruled light standing where the work will go, taller for a more pressing issue, beside the first zone it is placed on.
 *
 * A blueprint with an agent already at work in its zone burns full; one
 * nobody has started on is dimmer. An issue placed on no zone stands on the
 * town's rim, outside the main gate.
 */

const MAX_PLANNED = FACTORY_WORLD_BOUNDS.MAX_PLANNED;

/** How tall and wide a blueprint stands, by its issue's priority. */
const BLUEPRINT = {
  [LINEAR_PRIORITY.URGENT]: { height: 13, radius: 2.3 },
  [LINEAR_PRIORITY.HIGH]: { height: 11.5, radius: 2 },
  [LINEAR_PRIORITY.MEDIUM]: { height: 8, radius: 1.5 },
  [LINEAR_PRIORITY.LOW]: { height: 5.6, radius: 1.15 },
  [LINEAR_PRIORITY.NONE]: { height: 7, radius: 1.3 },
} as const;

/** One blueprint's place and size. */
export interface Blueprint {
  readonly issue: FactoryPlanned;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly radius: number;
}

/** Where each issue's blueprint stands: by its first zone's layer, the zone's issues in turn round it, or on the rim. */
export function blueprintsOf(
  planned: readonly FactoryPlanned[],
  sites: ReadonlyMap<string, ZoneSite>,
  gates: readonly number[],
): Blueprint[] {
  const used = new Map<ZoneSite | undefined, number>();
  return planned.slice(0, MAX_PLANNED).map((issue) => {
    const first = issue.zonePaths[0];
    const site = first === undefined ? undefined : sites.get(first);
    const k = used.get(site) ?? 0;
    used.set(site, k + 1);
    const size = BLUEPRINT[issue.priority ?? LINEAR_PRIORITY.NONE];
    let x: number;
    let z: number;
    if (site === undefined) {
      const gate = gates[0] ?? Math.PI / 2;
      [x, z] = polar(68 + (k % 2) * 4, gate + Math.PI + (k - 0.5) * 0.1);
    } else if (site.layer === ZONE_LAYER.SURFACE) {
      [x, z] = polar(
        60 + (k % 2) * 4.5,
        site.from + (site.to - site.from) * (0.2 + 0.6 * ((k * 0.37 + 0.5) % 1)),
      );
    } else if (site.layer === ZONE_LAYER.CORE) {
      [x, z] = polar(12, site.angle + 0.7 + k * 0.6);
    } else if (site.layer === ZONE_LAYER.TOOLING) {
      [x, z] = polar(site.radius, site.angle + (site.size * 2.2 + 3 + k * 4.5) / site.radius);
    } else {
      const angle = site.angle + Math.PI + (k - 0.5) * 0.9;
      const reach = (site.size * 1.15 + 1.4) * 0.9;
      [x, z] = [site.x + Math.cos(angle) * reach, site.z + Math.sin(angle) * reach];
      const r = Math.hypot(x, z);
      if (r < 19.5) [x, z] = [(x * 19.8) / r, (z * 19.8) / r];
    }
    return { issue, x, y: groundAt(x, z), z, ...size };
  });
}

/** The floor the blueprints stand on, which houses and trees give way to. */
export function blueprintClearings(blueprints: readonly Blueprint[]): Clearing[] {
  return blueprints.map((blueprint) => ({
    x: blueprint.x,
    z: blueprint.z,
    radius: blueprint.radius * 1.4 + 1,
  }));
}

/** The ruled light a blueprint is drawn in: a grid, a sheen at its edges, and a scan line climbing it, in its instance's colour. */
function holoMaterial(time: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { uTime: time },
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vView; varying float vHeight; varying vec3 vColor;
      void main(){
        vUv = uv;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vHeight = world.y;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vView = normalize(cameraPosition - world.xyz);
        vColor = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vNormal; varying vec3 vView; varying float vHeight; varying vec3 vColor;
      void main(){
        float sheen = pow(1.0 - abs(dot(normalize(vNormal), vView)), 2.0);
        float across = abs(fract(vUv.x * 12.0) - 0.5);
        float up = abs(fract(vHeight * 0.7) - 0.5);
        float grid = smoothstep(0.44, 0.5, max(across, up));
        float scan = smoothstep(0.08, 0.0, abs(fract(vUv.y - uTime * 0.12) - 0.5) - 0.42);
        float a = 0.035 + sheen * 0.2 + grid * 0.42 + scan * 0.25;
        gl_FragColor = vec4(vColor * a * 1.6, a);
        #include <colorspace_fragment>
      }`,
  });
}

export interface Blueprints {
  readonly meshes: readonly InstancedMesh[];
  /** Raises the blueprints, each in the planned colour, full where an agent works its zone, the chosen in the selection's. */
  readonly draw: (
    blueprints: readonly Blueprint[],
    worked: ReadonlySet<string>,
    shown: boolean,
    chosen: (target: PickTarget) => boolean,
  ) => void;
  readonly step: (elapsed: number) => void;
  readonly spotOf: (identifier: string) => (WorldPoint & { readonly size: number }) | undefined;
}

export function buildBlueprints(palette: WorldPalette, picking: WorldPicking): Blueprints {
  const time = { value: 0 };
  const material = holoMaterial(time);
  const bodies = new InstancedMesh(
    new CylinderGeometry(1, 1.06, 1, 20, 1, true).translate(0, 0.5, 0),
    material,
    MAX_PLANNED,
  );
  const roofs = new InstancedMesh(
    new ConeGeometry(1.28, 1.9, 20, 1, true).translate(0, 0.95, 0),
    material,
    MAX_PLANNED,
  );
  const rings = new InstancedMesh(
    new RingGeometry(1.1, 1.35, 40).rotateX(-Math.PI / 2),
    material,
    MAX_PLANNED,
  );
  for (const mesh of [bodies, roofs, rings]) {
    mesh.setColorAt(0, new Color(palette.signal.PLANNED));
    mesh.count = 0;
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
  }
  let drawn: readonly Blueprint[] = [];
  picking.addInstances(bodies, (instanceId) => {
    const blueprint = drawn[instanceId];
    return blueprint === undefined
      ? undefined
      : { kind: PICK_KIND.PLANNED, id: blueprint.issue.identifier };
  });
  const matrix = new Matrix4();
  const tint = new Color();
  return {
    meshes: [bodies, roofs, rings],
    draw: (blueprints, worked, shown, chosen) => {
      drawn = shown ? blueprints : [];
      drawn.forEach((blueprint, index) => {
        const { x, y, z, height, radius } = blueprint;
        bodies.setMatrixAt(index, placed(matrix, x, y, z, 0, radius, height, radius));
        roofs.setMatrixAt(index, placed(matrix, x, y + height, z, 0, radius, radius, radius));
        rings.setMatrixAt(index, placed(matrix, x, y + 0.08, z, 0, radius, 1, radius));
        const picked = chosen({ kind: PICK_KIND.PLANNED, id: blueprint.issue.identifier });
        const working = blueprint.issue.zonePaths.some((path) => worked.has(path));
        tint
          .set(picked ? palette.signal.SELECTION : palette.signal.PLANNED)
          .multiplyScalar(picked ? 1.4 : working ? 1 : 0.55);
        for (const mesh of [bodies, roofs, rings]) mesh.setColorAt(index, tint);
      });
      for (const mesh of [bodies, roofs, rings]) {
        mesh.count = drawn.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    },
    step: (elapsed) => {
      time.value = elapsed;
    },
    spotOf: (identifier) => {
      const blueprint = drawn.find((one) => one.issue.identifier === identifier);
      return blueprint === undefined
        ? undefined
        : { x: blueprint.x, y: blueprint.y, z: blueprint.z, size: blueprint.radius * 1.7 };
    },
  };
}
