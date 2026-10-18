import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector3,
} from "three";
import { Builder, placing, put, shapeOf, UNIT } from "./kit";
import { BOARD, type Layout } from "./layout";

/**
 * tracks.ts -- the permanent way: ballast, rails and sleepers for every loop, mainline and siding, the stone portals where a mainline tunnels under a district, the signals beside each line, and the glow the blast radius runs along.
 *
 * Every length of one kind is extruded into one geometry, so all the track on
 * the board is a handful of draw calls, and the sleepers are one instanced
 * mesh. The glow is one more ribbon over the rails whose every vertex carries
 * the glow id of its length (`layout.ts`'s `Track.glow`), lit through the glow
 * texture the world rewrites as the blast spreads.
 */

/** The ballast's cross-section: shoulders sloping to a flat top. */
const BALLAST: readonly (readonly [number, number])[] = [
  [-0.62, 0.01],
  [-0.44, 0.12],
  [0.44, 0.12],
  [0.62, 0.01],
];

/** A rail's cross-section, `offset` from the track's centre. */
function railSection(offset: number): (readonly [number, number])[] {
  return [
    [offset - 0.035, 0.13],
    [offset - 0.035, BOARD.RAIL_Y],
    [offset + 0.035, BOARD.RAIL_Y],
    [offset + 0.035, 0.13],
  ];
}

/** The glow's cross-section: a flat ribbon just above the rails. */
const GLOW: readonly (readonly [number, number])[] = [
  [-0.55, 0.235],
  [0.55, 0.235],
];

/** What one extrusion writes: positions, and per vertex its glow id where it carries one. */
interface Sweep {
  readonly positions: number[];
  readonly normals: number[];
  readonly glows: number[];
}

/** Sweeps `section` along `points`, writing its triangles (and the glow id of each vertex, where given). */
function extrude(
  points: readonly Vector3[],
  closed: boolean,
  section: readonly (readonly [number, number])[],
  out: Sweep,
  glow?: number,
): void {
  const count = points.length;
  const rings = points.map((point, index) => {
    const before = points[closed ? (index - 1 + count) % count : Math.max(0, index - 1)] ?? point;
    const after = points[closed ? (index + 1) % count : Math.min(count - 1, index + 1)] ?? point;
    let tx = after.x - before.x;
    let tz = after.z - before.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    return section.map(([offset, y]) => [point.x - tz * offset, y, point.z + tx * offset] as const);
  });
  const segments = closed ? count : count - 1;
  for (let index = 0; index < segments; index += 1) {
    const a = rings[index];
    const b = rings[(index + 1) % count];
    if (a === undefined || b === undefined) continue;
    for (let edge = 0; edge < section.length - 1; edge += 1) {
      const quad = [a[edge], b[edge], b[edge + 1], a[edge + 1]];
      const [p0, p1, , p3] = quad;
      if (
        quad.some((vertex) => vertex === undefined) ||
        p0 === undefined ||
        p1 === undefined ||
        p3 === undefined
      )
        continue;
      // Note that each face's normal is written as it is swept, flat, rather than averaged over the whole mesh after.
      ALONG.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      ACROSS.set(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
      FACE.crossVectors(ACROSS, ALONG).normalize();
      for (const vertex of [quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]) {
        if (vertex === undefined) continue;
        out.positions.push(vertex[0], vertex[1], vertex[2]);
        out.normals.push(FACE.x, FACE.y, FACE.z);
        if (glow !== undefined) out.glows.push(glow);
      }
    }
  }
}

const ALONG = new Vector3();
const ACROSS = new Vector3();
const FACE = new Vector3();

/** The most sleepers and tunnel mouths a board draws, however much track it has. */
const BUDGET = { SLEEPERS: 24_000, PORTALS: 400 } as const;

/** A line's length along the ground. */
function lengthOf(points: readonly Vector3[], closed: boolean): number {
  let length = 0;
  for (let index = 0; index < points.length - (closed ? 0 : 1); index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

/** Where the sleepers lie along a line, `spacing` apart: point and heading. */
function sleepersAlong(
  points: readonly Vector3[],
  closed: boolean,
  spacing: number,
  out: number[][],
): void {
  let carry = spacing / 2;
  const segments = closed ? points.length : points.length - 1;
  for (let index = 0; index < segments; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    let along = carry;
    while (along < length) {
      const t = along / length;
      out.push([a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, yaw]);
      along += spacing;
    }
    carry = along - length;
  }
}

function geometryOf(sweep: Sweep, withGlow: boolean): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(sweep.positions), 3));
  if (withGlow) {
    geometry.setAttribute("aGlow", new BufferAttribute(Float32Array.from(sweep.glows), 1));
  } else {
    geometry.setAttribute("normal", new BufferAttribute(Float32Array.from(sweep.normals), 3));
  }
  return geometry;
}

/** The ballast's texture read off the board's own x and z, so the gravel runs on unbroken round every curve. */
function withGroundUv(geometry: BufferGeometry): BufferGeometry {
  const positions = geometry.getAttribute("position");
  const uv = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index += 1) {
    uv[index * 2] = positions.getX(index);
    uv[index * 2 + 1] = positions.getZ(index);
  }
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  return geometry;
}

/** The grassy hump over a tunnel's mouth: a low dome of few facets, as there may be hundreds. */
const HUMP = shapeOf(new SphereGeometry(0.5, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2));

/** The stone arch of a tunnel mouth, with the grassy bank above it, built once. */
function portalGeometry(): BufferGeometry {
  const builder = new Builder();
  const pen = { builder, frame: new Matrix4(), extra: [] };
  const stone = new Color("#a39782");
  for (const side of [-1, 1]) put(pen, UNIT.box, stone, 0, 0, side * 0.68, 0, 0.4, 0.95, 0.28);
  put(pen, UNIT.box, stone, 0, 0.88, 0, 0, 0.4, 0.28, 1.64);
  put(pen, UNIT.box, new Color("#151311"), 0.25, 0, 0, 0, 0.3, 0.95, 1.1);
  // Note that the bank over the mouth is a low grassy hump, so a tunnel reads as a hill rather than a block.
  put(pen, HUMP, new Color("#5f7f3e"), 0.9, 0, 0, 0, 2.2, 1.5, 2.4);
  return builder.build();
}

/** The materials every board's track shares, made once with the world. */
export function trackMaterials(gravel: Texture) {
  return {
    ballast: new MeshStandardMaterial({
      map: gravel,
      color: "#b4ab98",
      roughness: 1,
      side: DoubleSide,
    }),
    rail: new MeshStandardMaterial({
      color: "#b9b2a6",
      roughness: 0.35,
      metalness: 0.6,
      side: DoubleSide,
    }),
    sleeper: new MeshStandardMaterial({ color: "#4d3a2c", roughness: 0.9 }),
    portal: new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    post: new MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.6 }),
    head: new MeshStandardMaterial({ color: "#1a1a1a" }),
    lamp: new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
  };
}

export type TrackMaterials = ReturnType<typeof trackMaterials>;

/** One board's track, as meshes, and the two parts the world relights: the glow and the signal lamps. */
export interface TrackMeshes {
  readonly group: Group;
  readonly glow: Mesh;
  readonly lamps: InstancedMesh;
}

/** Builds every length of track on a board, its sidings, portals, signals, and glow. */
export function buildTracks(
  layout: Layout,
  sidings: readonly (readonly [Vector3, Vector3])[],
  materials: TrackMaterials,
  glowMaterial: ShaderMaterial,
): TrackMeshes {
  const ballast: Sweep = { positions: [], normals: [], glows: [] };
  const rails: Sweep = { positions: [], normals: [], glows: [] };
  const glow: Sweep = { positions: [], normals: [], glows: [] };
  const sleepers: number[][] = [];
  const lines = [
    ...layout.tracks.map((track) => ({
      points: track.points,
      closed: track.closed,
      glow: track.glow,
    })),
    ...sidings.map(([a, b]) => ({ points: [a, b], closed: false, glow: undefined })),
  ];
  // Note that a board of many long lines lays its sleepers further apart, so they stay within their budget.
  const length = lines.reduce((sum, line) => sum + lengthOf(line.points, line.closed), 0);
  const spacing = Math.max(0.5, length / BUDGET.SLEEPERS);
  for (const line of lines) {
    extrude(line.points, line.closed, BALLAST, ballast);
    for (const offset of [-0.28, 0.28])
      extrude(line.points, line.closed, railSection(offset), rails);
    sleepersAlong(line.points, line.closed, spacing, sleepers);
    if (line.glow !== undefined) extrude(line.points, line.closed, GLOW, glow, line.glow);
  }
  const group = new Group();
  const ballastMesh = new Mesh(withGroundUv(geometryOf(ballast, false)), materials.ballast);
  ballastMesh.receiveShadow = true;
  const railMesh = new Mesh(geometryOf(rails, false), materials.rail);
  railMesh.receiveShadow = true;
  const sleeperMesh = new InstancedMesh(
    new BoxGeometry(0.2, 0.05, 1.08).translate(0, 0.12, 0),
    materials.sleeper,
    Math.max(1, sleepers.length),
  );
  const placingSleeper = new Matrix4();
  sleepers.forEach(([x = 0, z = 0, yaw = 0], index) => {
    sleeperMesh.setMatrixAt(index, placing(x, 0, z, yaw, 1, 1, 1, 0, 0, placingSleeper));
  });
  sleeperMesh.count = sleepers.length;
  sleeperMesh.receiveShadow = true;
  const glowMesh = new Mesh(geometryOf(glow, true), glowMaterial);
  glowMesh.renderOrder = 2;
  glowMesh.visible = false;
  // Note that past their budget the tunnels keep their mouths at an even stride, the rest left as hills of grass over the line.
  const mouths = layout.portals.filter(
    (_, index) => index % Math.ceil(layout.portals.length / BUDGET.PORTALS) === 0,
  );
  const portals = new InstancedMesh(portalGeometry(), materials.portal, Math.max(1, mouths.length));
  mouths.forEach((portal, index) => {
    portals.setMatrixAt(index, placing(portal.x, 0, portal.z, portal.yaw));
  });
  portals.count = mouths.length;
  portals.castShadow = true;
  portals.receiveShadow = true;
  const signals = Math.max(1, layout.signals.length);
  const posts = new InstancedMesh(
    new CylinderGeometry(0.05, 0.06, 1.7, 6).translate(0, 0.85, 0),
    materials.post,
    signals,
  );
  const heads = new InstancedMesh(
    new BoxGeometry(0.22, 0.42, 0.18).translate(0, 1.75, 0),
    materials.head,
    signals,
  );
  const lamps = new InstancedMesh(new SphereGeometry(0.075, 8, 6), materials.lamp, signals);
  layout.signals.forEach((signal, index) => {
    const at = placing(signal.x, 0, signal.z);
    posts.setMatrixAt(index, at);
    heads.setMatrixAt(index, at);
    lamps.setMatrixAt(index, placing(signal.x, 1.82, signal.z));
    lamps.setColorAt(index, new Color("#fff3d0"));
  });
  for (const mesh of [posts, heads, lamps]) mesh.count = layout.signals.length;
  group.add(ballastMesh, railMesh, sleeperMesh, glowMesh, portals, posts, heads, lamps);
  return { group, glow: glowMesh, lamps };
}
