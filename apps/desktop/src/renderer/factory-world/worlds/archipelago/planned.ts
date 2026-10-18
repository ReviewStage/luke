import {
  FACTORY_WORLD_BOUNDS,
  type FactoryPlanned,
  LINEAR_PRIORITY,
} from "@luke/features/factory-world-wire";
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  IcosahedronGeometry,
  InstancedMesh,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  QuadraticBezierCurve3,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { PickTarget, WorldPalette, WorldPicking } from "../../world";
import { PICK_KIND } from "../../world";
import type { Isle } from "./islands";
import { fbm, hashOf, merged, randomOf, TAU, valueNoise } from "./kit";
import { GLSL_OUTPUT } from "./mood";

/**
 * planned.ts -- the Linear issues still to build, as blueprint islands: wireframe-blue ghosts of an island with a tower on it, floating beside the zone each is placed on, a dashed tether and a stream of motes running down to it.
 *
 * The more pressing an issue, the larger its blueprint. One placed on no
 * zone yet waits out past the archipelago's rim, untethered. All of them are
 * one merged mesh, built when the issues or the islands change; its shader
 * bobs each and lights the selected and hovered ones by their index, so a
 * hover changes two uniforms and nothing else.
 */

const MAX_PLANNED = FACTORY_WORLD_BOUNDS.MAX_PLANNED;
const MOTES_PER_TETHER = 4;

/** A blueprint's size by its issue's priority: urgent largest. */
const SIZE_OF_PRIORITY = {
  [LINEAR_PRIORITY.NONE]: 1.6,
  [LINEAR_PRIORITY.URGENT]: 2.6,
  [LINEAR_PRIORITY.HIGH]: 2.3,
  [LINEAR_PRIORITY.MEDIUM]: 1.6,
  [LINEAR_PRIORITY.LOW]: 1.15,
} as const;

/** One blueprint as placed by the last build. */
interface Blueprint {
  readonly issue: FactoryPlanned;
  readonly centre: Vector3;
  readonly size: number;
  readonly phase: number;
  readonly tether: QuadraticBezierCurve3 | undefined;
}

/** A small ghost island and its tower, `size` wide, about the origin. */
function blueprintShape(size: number, seed: number): BufferGeometry[] {
  const segments = 18;
  const s = (seed % 997) * 0.173;
  const edge = (theta: number) =>
    size * (0.84 + 0.32 * fbm(Math.cos(theta) * 1.5 + s, Math.sin(theta) * 1.5 - s, s, 3));
  const positions: number[] = [];
  const ring = (radiusOf: (theta: number) => number, y: (theta: number) => number) =>
    Array.from({ length: segments }, (_, i) => {
      const theta = (i / segments) * TAU;
      const reach = radiusOf(theta);
      return new Vector3(Math.cos(theta) * reach, y(theta), Math.sin(theta) * reach);
    });
  const rings = [
    ring(edge, () => 0),
    ring(
      (theta) => edge(theta) * 0.9,
      () => -0.5,
    ),
    ...[0.25, 0.5, 0.75].map((t) =>
      ring(
        (theta) => edge(theta) * (1 - t) * (1 + (valueNoise(theta * 3, t * 5, s) - 0.5) * 0.4),
        () => -0.5 - size * 1.4 * t,
      ),
    ),
  ];
  const tip = new Vector3(0, -0.5 - size * 1.6 - 1, 0);
  const triangle = (a: Vector3, b: Vector3, c: Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const centre = new Vector3();
  const top = rings[0] ?? [];
  top.forEach((point, i) => {
    triangle(centre, top[(i + 1) % segments] ?? point, point);
  });
  for (let k = 0; k < rings.length - 1; k += 1) {
    const upper = rings[k] ?? [];
    const lower = rings[k + 1] ?? [];
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % segments;
      const a = upper[i];
      const b = upper[j];
      const c = lower[i];
      const d = lower[j];
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      triangle(a, c, d);
      triangle(a, d, b);
    }
  }
  const bottom = rings[rings.length - 1] ?? [];
  bottom.forEach((point, i) => {
    triangle(point, tip, bottom[(i + 1) % segments] ?? point);
  });
  const island = new Geometry();
  island.setAttribute("position", new Float32BufferAttribute(positions, 3));
  island.computeVertexNormals();
  const tower = new CylinderGeometry(size * 0.22, size * 0.28, size * 1.1, 8)
    .translate(0, size * 0.55, 0)
    .toNonIndexed();
  const roof = new ConeGeometry(size * 0.36, size * 0.6, 8)
    .toNonIndexed()
    .translate(0, size * 1.4, 0);
  for (const part of [tower, roof]) part.deleteAttribute("uv");
  return [island, tower, roof];
}

/** Each part of a blueprint carrying its issue's index, its centre, and its bob's phase. */
function stamped(
  parts: readonly BufferGeometry[],
  index: number,
  centre: Vector3,
  phase: number,
): BufferGeometry[] {
  return parts.map((part) => {
    part.translate(centre.x, centre.y, centre.z);
    const count = part.getAttribute("position").count;
    part.setAttribute("aIssue", new Float32BufferAttribute(new Float32Array(count).fill(index), 1));
    part.setAttribute("aPhase", new Float32BufferAttribute(new Float32Array(count).fill(phase), 1));
    part.setAttribute(
      "aCentre",
      new Float32BufferAttribute(
        Array.from({ length: count }, () => [centre.x, centre.y, centre.z]).flat(),
        3,
      ),
    );
    return part;
  });
}

function blueprintMaterial(
  color: Color,
  pick: Color,
  time: { value: number },
  still: { value: number },
): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: time,
      uStill: still,
      uColor: { value: color },
      uPick: { value: pick },
      uSelected: { value: -1 },
      uHovered: { value: -1 },
    },
    vertexShader: /* glsl */ `
      attribute float aIssue, aPhase; attribute vec3 aCentre;
      uniform float uTime, uStill, uSelected, uHovered;
      varying vec3 vW, vN; varying float vChosen;
      void main(){
        vChosen = abs(aIssue - uSelected) < 0.5 ? 1. : abs(aIssue - uHovered) < 0.5 ? 0.6 : 0.;
        vec3 p = aCentre + (position - aCentre) * (1. + 0.22 * step(0.1, vChosen));
        p.y += sin(uTime * 0.7 + aPhase) * 0.5 * (1. - uStill);
        vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStill; uniform vec3 uColor, uPick; varying vec3 vW, vN; varying float vChosen;
      void main(){
        vec3 V = normalize(cameraPosition - vW); float fres = pow(1. - abs(dot(normalize(vN), V)), 2.2);
        vec3 g = abs(fract(vW * 2.2) - 0.5); float grid = 1. - smoothstep(0.0, 0.05, min(min(g.x, g.y), g.z));
        float scan = smoothstep(0.92, 1., fract(vW.y * 0.35 - uTime * 0.25)) * (1. - uStill);
        float a = clamp(0.16 + fres * 0.5 + grid * 0.3 + scan * 0.2, 0., 0.85);
        vec3 base = mix(uColor, uPick, step(0.1, vChosen));
        gl_FragColor = vec4(base * (0.75 + 0.25 * (fres + grid)), a);
        ${GLSL_OUTPUT}
      }`,
  });
}

function tetherMaterial(
  color: Color,
  time: { value: number },
  still: { value: number },
): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: time, uStill: still, uColor: { value: color } },
    vertexShader: /* glsl */ `
      attribute float aDistance, aBob, aPhase; uniform float uTime, uStill; varying float vDistance;
      void main(){
        vDistance = aDistance;
        vec3 p = position; p.y += sin(uTime * 0.7 + aPhase) * 0.5 * aBob * (1. - uStill);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; varying float vDistance;
      void main(){ if (fract((vDistance + uTime * 0.8) / 1.15) > 0.6) discard; gl_FragColor = vec4(uColor, 0.85); ${GLSL_OUTPUT} }`,
  });
}

/** The planned issues as the world drives them. */
export interface Planned {
  readonly update: (input: {
    readonly planned: readonly FactoryPlanned[];
    readonly isles: ReadonlyMap<string, Isle>;
    readonly extent: number;
    readonly shown: boolean;
    readonly selected: string | undefined;
    readonly hovered: string | undefined;
  }) => void;
  readonly frame: (elapsed: number) => void;
  readonly placeStill: () => void;
}

/** The blueprints, their meshes allocated in `scene` and registered for picking by an invisible stand-in each. */
export function plannedOf(
  scene: Scene,
  picking: WorldPicking,
  palette: WorldPalette,
  time: { value: number },
  still: { value: number },
): Planned {
  const color = new Color(palette.signal.PLANNED);
  const material = blueprintMaterial(color, new Color(palette.signal.SELECTION), time, still);
  const blueprints = new Mesh(new Geometry(), material);
  blueprints.renderOrder = 6;
  blueprints.frustumCulled = false;
  const tethers = new LineSegments(new Geometry(), tetherMaterial(color, time, still));
  tethers.frustumCulled = false;
  const motes = new InstancedMesh(
    new IcosahedronGeometry(0.3, 1),
    new MeshBasicMaterial({ color: palette.signal.PLANNED }),
    MAX_PLANNED * MOTES_PER_TETHER,
  );
  const proxies = new InstancedMesh(
    new SphereGeometry(1, 8, 6),
    new MeshBasicMaterial({ visible: false }),
    MAX_PLANNED,
  );
  for (const mesh of [motes, proxies]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
  }
  scene.add(blueprints, tethers, motes, proxies);

  let placed: Blueprint[] = [];
  let targets: PickTarget[] = [];
  let built: { planned: readonly FactoryPlanned[]; isles: ReadonlyMap<string, Isle> } | undefined;
  picking.addInstances(proxies, (instanceId) => targets[instanceId]);
  const object = new Object3D();

  const build = (
    planned: readonly FactoryPlanned[],
    isles: ReadonlyMap<string, Isle>,
    extent: number,
  ) => {
    const homes = planned
      .slice(0, MAX_PLANNED)
      .map((issue) =>
        issue.zonePaths.map((path) => isles.get(path)).find((isle) => isle !== undefined),
      );
    const besideCount = new Map<Isle, number>();
    for (const home of homes)
      if (home !== undefined) besideCount.set(home, (besideCount.get(home) ?? 0) + 1);
    const beside = new Map<Isle, number>();
    const unplaced = homes.filter((home) => home === undefined).length;
    let waiting = 0;
    placed = planned.slice(0, MAX_PLANNED).map((issue, index) => {
      const size = SIZE_OF_PRIORITY[issue.priority ?? LINEAR_PRIORITY.NONE];
      const random = randomOf(hashOf(issue.identifier));
      const home = homes[index];
      if (home === undefined) {
        const theta = (waiting / Math.max(1, unplaced)) * TAU + 0.9;
        waiting += 1;
        const reach = extent + 14;
        return {
          issue,
          size,
          phase: random() * TAU,
          tether: undefined,
          centre: new Vector3(
            Math.cos(theta) * reach,
            26 + (waiting % 2) * 4,
            Math.sin(theta) * reach,
          ),
        };
      }
      const k = beside.get(home) ?? 0;
      beside.set(home, k + 1);
      const n = besideCount.get(home) ?? 1;
      const theta = home.outward + (k - (n - 1) / 2) * 0.62;
      const reach = home.radius + 3.5 + size * 1.4;
      const centre = home.position
        .clone()
        .add(
          new Vector3(
            Math.cos(theta) * reach,
            home.topHeight(0, 0) + 6 + (k % 2) * 3 + size,
            Math.sin(theta) * reach,
          ),
        );
      const target = home.position
        .clone()
        .add(new Vector3(0, home.topHeight(0, 0) + 0.5, 0))
        .add(
          new Vector3()
            .subVectors(centre, home.position)
            .setY(0)
            .normalize()
            .multiplyScalar(home.radius * 0.6),
        );
      const from = centre.clone().add(new Vector3(0, -1, 0));
      const middle = new Vector3().lerpVectors(from, target, 0.5).add(new Vector3(0, 2, 0));
      return {
        issue,
        size,
        phase: random() * TAU,
        centre,
        tether: new QuadraticBezierCurve3(from, middle, target),
      };
    });
    blueprints.geometry.dispose();
    blueprints.geometry =
      merged(
        placed.flatMap((blueprint, index) =>
          stamped(
            blueprintShape(blueprint.size, hashOf(blueprint.issue.identifier)),
            index,
            blueprint.centre,
            blueprint.phase,
          ),
        ),
      ) ?? new Geometry();
    const positions: number[] = [];
    const distances: number[] = [];
    const bobs: number[] = [];
    const phases: number[] = [];
    for (const blueprint of placed) {
      const points = blueprint.tether?.getPoints(40) ?? [];
      let distance = 0;
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (a === undefined || b === undefined) continue;
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        distances.push(distance, distance + a.distanceTo(b));
        distance += a.distanceTo(b);
        bobs.push(1 - i / 40, 1 - (i + 1) / 40);
        phases.push(blueprint.phase, blueprint.phase);
      }
    }
    const lines = new Geometry();
    lines.setAttribute("position", new Float32BufferAttribute(positions, 3));
    lines.setAttribute("aDistance", new Float32BufferAttribute(distances, 1));
    lines.setAttribute("aBob", new Float32BufferAttribute(bobs, 1));
    lines.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
    tethers.geometry.dispose();
    tethers.geometry = lines;
    placed.forEach((blueprint, index) => {
      object.position.copy(blueprint.centre);
      object.scale.setScalar(blueprint.size * 1.6);
      object.updateMatrix();
      proxies.setMatrixAt(index, object.matrix);
    });
    proxies.count = placed.length;
    proxies.instanceMatrix.needsUpdate = true;
    targets = placed.map((blueprint) => ({
      kind: PICK_KIND.PLANNED,
      id: blueprint.issue.identifier,
    }));
  };

  const placeMotes = (elapsed: number, moving: boolean) => {
    let index = 0;
    for (const blueprint of placed) {
      if (blueprint.tether === undefined || !moving) continue;
      for (let k = 0; k < MOTES_PER_TETHER; k += 1) {
        const t = (elapsed * 0.16 + k / MOTES_PER_TETHER + blueprint.phase) % 1;
        blueprint.tether.getPoint(t, object.position);
        object.position.y += Math.sin(elapsed * 0.7 + blueprint.phase) * 0.5 * (1 - t);
        object.scale.setScalar(Math.sin(Math.PI * t) * (0.6 + blueprint.size * 0.25));
        object.updateMatrix();
        motes.setMatrixAt(index, object.matrix);
        index += 1;
      }
    }
    motes.count = index;
    motes.instanceMatrix.needsUpdate = true;
  };

  return {
    update: ({ planned, isles, extent, shown, selected, hovered }) => {
      if (built === undefined || built.planned !== planned || built.isles !== isles) {
        build(planned, isles, extent);
        built = { planned, isles };
      }
      const indexOf = (identifier: string | undefined) =>
        placed.findIndex((blueprint) => blueprint.issue.identifier === identifier);
      if (material.uniforms.uSelected !== undefined)
        material.uniforms.uSelected.value = indexOf(selected);
      if (material.uniforms.uHovered !== undefined)
        material.uniforms.uHovered.value = indexOf(hovered);
      for (const mesh of [blueprints, tethers, motes, proxies]) mesh.visible = shown;
    },
    frame: (elapsed) => placeMotes(elapsed, true),
    placeStill: () => placeMotes(0, false),
  };
}
