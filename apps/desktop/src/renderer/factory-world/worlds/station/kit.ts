import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * kit.ts -- the station's geometry kit: seeded randomness, the bases that stand a part along a direction, primitives whose UVs run in scene units, and `Parts`, which merges every part of one material into one mesh.
 *
 * The station is hundreds of parts, and a part per mesh would be hundreds
 * of draw calls. `Parts` gathers each part under its material and merges
 * them, so the whole hull is one draw call per material. Each part carries
 * the zone it belongs to as an `aZone` vertex attribute (`NO_ZONE` for the
 * station's own frame), which is how one merged material still lights each
 * zone on its own (`materials.ts`). UVs run in scene units over `UV_UNIT`,
 * so a panel texture lies at one scale over every part, however large.
 */

export const TAU = Math.PI * 2;

/** The zone index a part of the station's own frame carries. */
export const NO_ZONE = -1;

/** Scene units one texture repeat spans. */
const UV_UNIT = 6;

const UP_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Only these attributes survive into a merged mesh, so parts from different builders merge. */
const KEPT_ATTRIBUTES: ReadonlySet<string> = new Set(["position", "normal", "uv"]);

export function v3(x = 0, y = 0, z = 0): Vector3 {
  return new Vector3(x, y, z);
}

/** The unit vector on the station plane at `angle`. */
export function radial(angle: number): Vector3 {
  return new Vector3(Math.cos(angle), 0, Math.sin(angle));
}

/** The unit vector along the station plane's circle at `angle`. */
export function tangent(angle: number): Vector3 {
  return new Vector3(-Math.sin(angle), 0, Math.cos(angle));
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Mulberry32: a small seeded generator, so a seed always builds the same station. */
export function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over `text`, so an item's id seeds the same look every time. */
export function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

/** A uniform draw in [low, high) from `random`. */
export function between(random: () => number, low: number, high: number): number {
  return low + (high - low) * random();
}

/** A matrix whose local +Y points along `axis`, placed at `position`. */
export function basisFromY(axis: Vector3, position?: Vector3): Matrix4 {
  const along = axis.clone().normalize();
  const reference = Math.abs(along.y) < 0.9 ? UP_AXIS : X_AXIS;
  const x = new Vector3().crossVectors(along, reference).normalize();
  const z = new Vector3().crossVectors(x, along).normalize();
  const matrix = new Matrix4().makeBasis(x, along, z);
  if (position !== undefined) matrix.setPosition(position);
  return matrix;
}

/** A matrix whose local +Z points along `axis` with +Y near `hint`, placed at `position`. */
export function basisFromZ(axis: Vector3, hint: Vector3 = UP_AXIS, position?: Vector3): Matrix4 {
  const z = axis.clone().normalize();
  let up = hint;
  if (Math.abs(z.dot(up)) > 0.95) up = Math.abs(z.x) < 0.9 ? X_AXIS : Z_AXIS;
  const x = new Vector3().crossVectors(up, z).normalize();
  const y = new Vector3().crossVectors(z, x).normalize();
  const matrix = new Matrix4().makeBasis(x, y, z);
  if (position !== undefined) matrix.setPosition(position);
  return matrix;
}

export function translation(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}

function scaleUV<G extends BufferGeometry>(geometry: G, u: number, v: number): G {
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * u, uv.getY(index) * v);
  }
  return geometry;
}

/** A slice of a torus's tube, its UVs in scene units: the outer ring's segments, and the reactor. */
export function torusPatch(
  major: number,
  minor: number,
  arc: readonly [number, number],
  around: readonly [number, number],
  segments: readonly [number, number],
): BufferGeometry {
  const [t0, t1] = arc;
  const [p0, p1] = around;
  const [nu, nv] = segments;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= nu; i += 1) {
    const t = t0 + ((t1 - t0) * i) / nu;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    for (let j = 0; j <= nv; j += 1) {
      const p = p0 + ((p1 - p0) * j) / nv;
      const cosP = Math.cos(p);
      const sinP = Math.sin(p);
      const reach = major + minor * cosP;
      positions.push(reach * cosT, minor * sinP, reach * sinT);
      normals.push(cosP * cosT, sinP, cosP * sinT);
      uvs.push((major * t) / UV_UNIT, (minor * p) / UV_UNIT);
    }
  }
  for (let i = 0; i < nu; i += 1) {
    for (let j = 0; j < nv; j += 1) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function cylinder(
  top: number,
  bottom: number,
  height: number,
  segments = 24,
  open = false,
  start = 0,
  length = TAU,
): BufferGeometry {
  const geometry = new CylinderGeometry(top, bottom, height, segments, 1, open, start, length);
  return scaleUV(geometry, (Math.max(top, bottom) * length) / UV_UNIT, height / UV_UNIT);
}

export function box(x: number, y: number, z: number): BufferGeometry {
  return scaleUV(new BoxGeometry(x, y, z), Math.max(x, z) / UV_UNIT, Math.max(y, 0.5) / UV_UNIT);
}

export function ring(major: number, minor: number, radial = 8, tubular = 32): BufferGeometry {
  return scaleUV(
    new TorusGeometry(major, minor, radial, tubular),
    (major * TAU) / UV_UNIT,
    (minor * TAU) / UV_UNIT,
  );
}

export function sphere(
  radius: number,
  widthSegments = 24,
  heightSegments = 16,
  phi: readonly [number, number] = [0, TAU],
  theta: readonly [number, number] = [0, Math.PI],
): BufferGeometry {
  return scaleUV(
    new SphereGeometry(radius, widthSegments, heightSegments, phi[0], phi[1], theta[0], theta[1]),
    (radius * TAU) / UV_UNIT,
    (radius * Math.PI) / UV_UNIT,
  );
}

/** Keeps only the attributes every part shares, and indexes a geometry that had none, so any two merge. */
export function clean(geometry: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (!KEPT_ATTRIBUTES.has(name)) geometry.deleteAttribute(name);
  }
  if (geometry.index !== null) return geometry;
  return geometry.setIndex([...Array(geometry.getAttribute("position").count).keys()]);
}

/** Merges geometries that share their attributes; throws on ones that do not, which is a bug in a builder. */
export function merged(geometries: readonly BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries([...geometries], false);
  if (geometry === null) throw new Error("station parts do not share their attributes");
  return geometry;
}

/** One material's parts, gathered until `build` merges each material's into one mesh. */
export class Parts {
  readonly #byMaterial = new Map<Material, BufferGeometry[]>();

  /** Adds `geometry`, placed by `matrix`, under `material`, as part of the zone numbered `zone`. */
  add(material: Material, geometry: BufferGeometry, matrix?: Matrix4, zone = NO_ZONE): this {
    const part = clean(geometry);
    if (matrix !== undefined) part.applyMatrix4(matrix);
    const count = part.getAttribute("position").count;
    part.setAttribute("aZone", new Float32BufferAttribute(new Float32Array(count).fill(zone), 1));
    const list = this.#byMaterial.get(material);
    if (list === undefined) this.#byMaterial.set(material, [part]);
    else list.push(part);
    return this;
  }

  /** Merges each material's parts into one mesh under `parent`, casting shadows where the material is opaque. */
  build(parent: Object3D, shadows = true): Mesh[] {
    const meshes = [...this.#byMaterial].map(([material, list]) => {
      const mesh = new Mesh(merged(list), material);
      for (const part of list) part.dispose();
      mesh.castShadow = shadows && !material.transparent && material.userData.noShadow !== true;
      mesh.receiveShadow = !material.transparent;
      parent.add(mesh);
      return mesh;
    });
    this.#byMaterial.clear();
    return meshes;
  }
}
