import {
  FACTORY_WORLD_BOUNDS,
  type FactoryPlanned,
  LINEAR_PRIORITY,
} from "@luke/features/factory-world-wire";
import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from "three";
import type { WorldPalette } from "../../world";
import { col, hashOf, PRIM, partGeo } from "./geo";

/**
 * planned.ts -- the Factory's planned work: each Linear issue a hologram of the machine it will become, standing on a blueprint grid in the planned signal's colour.
 *
 * An issue's hologram is one of three machines, picked by its key, as large
 * as its priority is pressing, with a scan line climbing it, and it bobs
 * while motion runs. It stands on the apron of the first zone the issue is
 * placed on, or in the drafting yard by the gate where it is placed on
 * none. Each part is an instanced mesh per machine at the contract's bound:
 * the translucent body, its glowing edges, the grid it stands on, and the
 * scan line.
 */

const MAX = FACTORY_WORLD_BOUNDS.MAX_PLANNED;

/** The machines a hologram may show. */
const VARIANTS = 3;

/** Where one issue's hologram stands, and how large. */
export interface PlannedPlacement {
  readonly issue: FactoryPlanned;
  readonly x: number;
  readonly z: number;
  readonly size: number;
}

/** A hologram's size, by how pressing its issue is. */
export function hologramSizeOf(issue: FactoryPlanned): number {
  switch (issue.priority) {
    case LINEAR_PRIORITY.URGENT:
    case LINEAR_PRIORITY.HIGH:
      return 5.0;
    case LINEAR_PRIORITY.MEDIUM:
      return 3.8;
    default:
      return 2.8;
  }
}

const BODY_VERTEX = /* glsl */ `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
varying vec3 vTint;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  vTint = vec3(1.0);
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #endif
  vec4 view = modelViewMatrix * local;
  vNormal = normalize(normalMatrix * n);
  vView = normalize(-view.xyz);
  vHeight = local.y;
  gl_Position = projectionMatrix * view;
}`;

const BODY_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
varying vec3 vTint;
void main() {
  float f = pow(1.0 - abs(dot(vNormal, vView)), 2.0);
  float scan = smoothstep(0.85, 1.0, sin(vHeight * 9.0 - uTime * 3.0));
  float a = 0.32 + 0.45 * f + 0.25 * scan;
  gl_FragColor = vec4(vTint * (0.9 + 1.8 * f + scan), a);
}`;

const EDGE_VERTEX = /* glsl */ `
attribute vec4 aPlace;
attribute vec3 aTint;
varying vec3 vTint;
void main() {
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * aPlace.w + aPlace.xyz, 1.0);
}`;

const EDGE_FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying vec3 vTint;
void main() {
  gl_FragColor = vec4(vTint * 3.2, uOpacity);
}`;

const GRID_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vUv = uv;
  vTint = vec3(1.0);
  vec4 local = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * local;
}`;

const GRID_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec2 g = abs(fract(vUv * 8.0) - 0.5);
  float line = smoothstep(0.46, 0.5, max(g.x, g.y));
  vec2 e = abs(vUv - 0.5);
  float border = smoothstep(0.47, 0.5, max(e.x, e.y));
  float a = 0.08 + 0.35 * line + 0.8 * border;
  gl_FragColor = vec4(vTint * 1.4, a * (0.75 + 0.25 * sin(uTime * 2.0)));
}`;

/** The three machines, drawn at unit size about their base. */
function variantGeometry(variant: number): BufferGeometry {
  return partGeo((g) => {
    if (variant === 0) {
      g.box(0, 0, 0, 0.8, 0.45, 0.6, "#ffffff");
      g.cyl(0.2, 0.45, 0, 0.16, 0.5, "#ffffff", 12);
      g.cyl(-0.22, 0.45, -0.1, 0.07, 0.8, "#ffffff", 8);
    } else if (variant === 1) {
      g.box(0, 0, 0, 0.85, 0.4, 0.6, "#ffffff");
      g.add(PRIM.prism, "#ffffff", 0, 0.4, -0.15, 0.85, 0.22, 0.3);
      g.add(PRIM.prism, "#ffffff", 0, 0.4, 0.15, 0.85, 0.22, 0.3);
    } else {
      g.cyl(0, 0, 0, 0.3, 0.9, "#ffffff", 12);
      g.dome(0, 0.9, 0, 0.3, 0.2, "#ffffff");
      g.box(0.32, 0, 0, 0.3, 0.35, 0.4, "#ffffff");
    }
  });
}

/** The planned signal, drawn. */
export interface PlannedLayer {
  readonly group: Group;
  /** What is picked: each machine's bodies and every grid. */
  readonly bodies: readonly InstancedMesh[];
  readonly grids: InstancedMesh;
  readonly issueAt: (mesh: InstancedMesh, index: number) => string | undefined;
  readonly show: (
    placements: readonly PlannedPlacement[],
    chosen: (identifier: string) => boolean,
  ) => void;
  /** Bobs the holograms and climbs their scan lines `time` seconds in; at zero, each stands at rest. */
  readonly step: (time: number) => void;
}

/** Builds the planned layer in `palette`'s signal. */
export function plannedLayerOf(palette: WorldPalette): PlannedLayer {
  const group = new Group();
  const time = { value: 0 };
  const bodyMaterial = new ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: BODY_VERTEX,
    fragmentShader: BODY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const edgeMaterial = new ShaderMaterial({
    uniforms: { uOpacity: { value: 0.85 } },
    vertexShader: EDGE_VERTEX,
    fragmentShader: EDGE_FRAGMENT,
    transparent: true,
  });
  const gridMaterial = new ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: GRID_VERTEX,
    fragmentShader: GRID_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const scanMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.18,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const bodies: InstancedMesh[] = [];
  const edges: {
    lines: LineSegments;
    place: InstancedBufferAttribute;
    tint: InstancedBufferAttribute;
    geometry: InstancedBufferGeometry;
  }[] = [];
  for (let variant = 0; variant < VARIANTS; variant += 1) {
    const geometry = variantGeometry(variant);
    const body = new InstancedMesh(geometry, bodyMaterial, MAX);
    body.count = 0;
    body.frustumCulled = false;
    body.renderOrder = 6;
    bodies.push(body);
    const outline = new EdgesGeometry(geometry, 25);
    const instanced = new InstancedBufferGeometry();
    instanced.setAttribute("position", outline.getAttribute("position"));
    const place = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    const tint = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    instanced.setAttribute("aPlace", place);
    instanced.setAttribute("aTint", tint);
    instanced.instanceCount = 0;
    const lines = new LineSegments(instanced, edgeMaterial);
    lines.frustumCulled = false;
    lines.renderOrder = 7;
    edges.push({ lines, place, tint, geometry: instanced });
    group.add(body, lines);
  }
  const grids = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), gridMaterial, MAX);
  const scans = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), scanMaterial, MAX);
  for (const mesh of [grids, scans]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const planned = col(palette.signal.PLANNED);
  const selection = col(palette.signal.SELECTION);
  const scratch = { matrix: new Matrix4(), tint: new Color() };
  let placed: PlannedPlacement[] = [];
  let byVariant: PlannedPlacement[][] = [];
  let isChosen: (identifier: string) => boolean = () => false;

  const variantOf = (issue: FactoryPlanned) => hashOf(issue.identifier) % VARIANTS;
  const phaseOf = (issue: FactoryPlanned) => (hashOf(issue.identifier) % 600) / 100;

  const draw = (now: number) => {
    time.value = now;
    byVariant.forEach((list, variant) => {
      const body = bodies[variant];
      const edge = edges[variant];
      if (body === undefined || edge === undefined) return;
      list.forEach((placement, index) => {
        const bob = now === 0 ? 0 : Math.sin(now * 1.2 + phaseOf(placement.issue)) * 0.12;
        const y = 0.3 + 0.35 + bob;
        const s = placement.size;
        scratch.matrix
          .makeScale(s * 0.9, s * 0.9, s * 0.9)
          .setPosition(placement.x, y, placement.z);
        body.setMatrixAt(index, scratch.matrix);
        const tint = isChosen(placement.issue.identifier) ? selection : planned;
        body.setColorAt(index, tint);
        edge.place.setXYZW(index, placement.x, y, placement.z, s * 0.9);
        edge.tint.setXYZ(index, tint.r, tint.g, tint.b);
      });
      body.count = list.length;
      body.visible = list.length > 0;
      body.instanceMatrix.needsUpdate = true;
      if (body.instanceColor !== null) body.instanceColor.needsUpdate = true;
      edge.geometry.instanceCount = list.length;
      edge.lines.visible = list.length > 0;
      edge.place.needsUpdate = true;
      edge.tint.needsUpdate = true;
    });
    placed.forEach((placement, index) => {
      const s = placement.size;
      scratch.matrix.makeScale(s + 0.4, 1, s + 0.4).setPosition(placement.x, 0.32, placement.z);
      grids.setMatrixAt(index, scratch.matrix);
      const tint = isChosen(placement.issue.identifier) ? selection : planned;
      grids.setColorAt(index, tint);
      const climb = now === 0 ? 0.5 : (now * 0.6 + phaseOf(placement.issue)) % 1;
      scratch.matrix
        .makeScale(s * 0.95, 1, s * 0.95)
        .setPosition(placement.x, 0.3 + climb * s * 0.9, placement.z);
      scans.setMatrixAt(index, scratch.matrix);
      scans.setColorAt(index, scratch.tint.copy(tint).multiplyScalar(1.6 * (1 - climb)));
    });
    for (const mesh of [grids, scans]) {
      mesh.count = placed.length;
      mesh.visible = placed.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  };

  return {
    group,
    bodies,
    grids,
    issueAt: (mesh, index) => {
      if (mesh === grids) return index < grids.count ? placed[index]?.issue.identifier : undefined;
      const variant = bodies.indexOf(mesh);
      return index < mesh.count ? byVariant[variant]?.[index]?.issue.identifier : undefined;
    },
    show: (placements, chosen) => {
      placed = placements.slice(0, MAX);
      byVariant = Array.from({ length: VARIANTS }, (_, variant) =>
        placed.filter((placement) => variantOf(placement.issue) === variant),
      );
      isChosen = chosen;
      draw(time.value);
    },
    step: draw,
  };
}
