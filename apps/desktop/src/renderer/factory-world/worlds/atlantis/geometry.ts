import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type Color,
  type Curve,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TAU } from "./sea";

/**
 * geometry.ts -- the shapes Atlantis is built from, each made once as the world is created: the geodesic dome, the lattice of a crane or a rig, the crystal, the corals, the anemone, the rocks, and the tubes the dependencies, tethers, and tentacles run through.
 *
 * Every shape is seeded, never random, so the same world is built the same
 * way every time; `seededRandom` and `unitHashOf` are the seeds, and
 * `fractalNoise` the floor's and the rocks' relief. A shape the world
 * instances is made at unit size, and each instance scales it.
 */

/** A seeded stream of numbers in [0, 1): mulberry32. */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `text` hashed into [0, 1): FNV-1a. */
export function unitHashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Hermite between `edge0` and `edge1`, as GLSL's `smoothstep`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Cubic ease in and out. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function cellHash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = cellHash(xi, yi);
  const b = cellHash(xi + 1, yi);
  const c = cellHash(xi, yi + 1);
  const d = cellHash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise in [0, 1), `octaves` deep. */
export function fractalNoise(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

/**
 * The sea floor's height at `x`, `z`. Note that the city's floor stays near
 * zero so every district stands on y = 0, and only past the outer reef does
 * the canyon wall rise into the fog.
 */
export function seabedHeightAt(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  let height = (fractalNoise(x * 0.018, z * 0.018, 3) - 0.5) * 2;
  height += Math.sin(x * 0.22 + fractalNoise(x * 0.01, z * 0.01, 2) * 8) * 0.16;
  const wall = smoothstep(330, 660, radius);
  height += wall * (18 + 120 * fractalNoise(x * 0.006 + 5, z * 0.006 - 3, 4));
  return height;
}

/** A per-instance attribute of `size` floats for `count` instances, set on `geometry` as `name`. */
export function instancedAttribute(
  geometry: BufferGeometry,
  name: string,
  size: number,
  count: number,
): InstancedBufferAttribute {
  const attribute = new InstancedBufferAttribute(new Float32Array(count * size), size);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
}

/** `geometry`, non-indexed, coloured `color` all over, and shining by `lit` where the material reads `aLit`. */
export function painted(geometry: BufferGeometry, color: Color, lit = 0): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  const count = flat.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) colors.set([color.r, color.g, color.b], index * 3);
  flat.setAttribute("color", new BufferAttribute(colors, 3));
  flat.setAttribute("aLit", new BufferAttribute(new Float32Array(count).fill(lit), 1));
  return flat;
}

/** `parts` as one geometry, keeping only the attributes named in `keep`, which every part must carry. */
export function merged(
  parts: readonly BufferGeometry[],
  keep: readonly string[] = ["position", "normal"],
): BufferGeometry {
  const flat = parts.map((part) => {
    const one = part.index === null ? part : part.toNonIndexed();
    for (const name of Object.keys(one.attributes)) {
      if (!keep.includes(name)) one.deleteAttribute(name);
    }
    return one;
  });
  const whole = mergeGeometries(flat);
  // Note that a merge fails only on parts with different attributes, which `keep` rules out.
  if (whole === null) throw new Error("Atlantis could not merge a shape's parts.");
  return whole;
}

/**
 * A geodesic hemisphere of radius 1 standing on y = 0: each triangle
 * carries its barycentric corners (`bary`, for the struts), its centre's
 * height (`aCy`, for a dome filling as it is built), and a seed (`aRand`).
 */
export function geodesicDome(detail: number): BufferGeometry {
  const sphere = new IcosahedronGeometry(1, detail);
  const source = sphere.getAttribute("position");
  const random = seededRandom(detail * 977 + 3);
  const position: number[] = [];
  const normal: number[] = [];
  const bary: number[] = [];
  const height: number[] = [];
  const seed: number[] = [];
  const corners = [new Vector3(), new Vector3(), new Vector3()] as const;
  for (let index = 0; index < source.count; index += 3) {
    corners.forEach((corner, k) => {
      corner.fromBufferAttribute(source, index + k);
    });
    const centre = (corners[0].y + corners[1].y + corners[2].y) / 3;
    if (centre < -0.03) continue;
    const draw = random();
    corners.forEach((corner, k) => {
      const out = corner.clone().normalize();
      position.push(corner.x, Math.max(corner.y, 0), corner.z);
      normal.push(out.x, out.y, out.z);
      bary.push(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      height.push(Math.max(centre, 0));
      seed.push(draw);
    });
  }
  sphere.dispose();
  const dome = new BufferGeometry();
  dome.setAttribute("position", new Float32BufferAttribute(position, 3));
  dome.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  dome.setAttribute("bary", new Float32BufferAttribute(bary, 3));
  dome.setAttribute("aCy", new Float32BufferAttribute(height, 1));
  dome.setAttribute("aRand", new Float32BufferAttribute(seed, 1));
  return dome;
}

/** A square lattice tower `width` across and `height` tall, in storeys of about `storey`, cross-braced where `braced`. */
export function latticeTower(
  width: number,
  height: number,
  storey: number,
  braced: boolean,
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const storeys = Math.max(2, Math.round(height / storey));
  const step = height / storeys;
  const post = 0.12;
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    parts.push(
      new BoxGeometry(post, height, post).translate((x * width) / 2, height / 2, (z * width) / 2),
    );
  }
  for (let level = 0; level <= storeys; level += 1) {
    const y = level * step;
    const rail = post * 0.8;
    parts.push(new BoxGeometry(width, rail, rail).translate(0, y, width / 2));
    parts.push(new BoxGeometry(width, rail, rail).translate(0, y, -width / 2));
    parts.push(new BoxGeometry(rail, rail, width).translate(width / 2, y, 0));
    parts.push(new BoxGeometry(rail, rail, width).translate(-width / 2, y, 0));
    if (level === storeys || !braced) continue;
    const length = Math.hypot(width, step);
    const slope = Math.atan2(step, width);
    for (let side = 0; side < 4; side += 1) {
      const brace = new BoxGeometry(length, post * 0.6, post * 0.6);
      brace.rotateZ((level % 2 === 1 ? 1 : -1) * slope);
      brace.translate(0, y + step / 2, width / 2);
      brace.rotateY((side * Math.PI) / 2);
      parts.push(brace);
    }
  }
  return merged(parts);
}

/** A six-sided crystal of radius 1 and height 1, standing on y = 0. */
export function crystalGeometry(): BufferGeometry {
  const body = new CylinderGeometry(0.82, 1, 0.78, 6, 1).translate(0, 0.39, 0);
  const tip = new CylinderGeometry(0, 0.82, 0.22, 6, 1).translate(0, 0.89, 0);
  return merged([body, tip]);
}

/** A branching coral about a unit tall, each branch's tips brighter in its vertex colour. */
export function branchCoral(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const random = seededRandom(42);
  const up = new Vector3(0, 1, 0);
  const grow = (from: Vector3, toward: Vector3, length: number, radius: number, depth: number) => {
    const end = from.clone().addScaledVector(toward, length);
    const branch = new CylinderGeometry(radius * 0.7, radius, length, 5, 1);
    branch.applyQuaternion(new Quaternion().setFromUnitVectors(up, toward));
    const middle = from.clone().add(end).multiplyScalar(0.5);
    branch.translate(middle.x, middle.y, middle.z);
    parts.push(shaded(branch, 0.35 + depth * 0.15));
    if (depth >= 3) {
      parts.push(
        shaded(new IcosahedronGeometry(radius * 1.4, 0).translate(end.x, end.y, end.z), 1.6),
      );
      return;
    }
    const forks = 2 + (random() < 0.5 ? 1 : 0);
    for (let fork = 0; fork < forks; fork += 1) {
      const turn = (fork / forks) * TAU + random();
      const side = new Vector3(Math.cos(turn), 0, Math.sin(turn));
      const axis = new Vector3().crossVectors(up, side).normalize();
      const next = toward
        .clone()
        .applyAxisAngle(axis, 0.45 + random() * 0.35)
        .normalize();
      grow(end, next, length * 0.74, radius * 0.7, depth + 1);
    }
  };
  grow(new Vector3(), up.clone(), 0.9, 0.16, 0);
  return merged(parts, ["position", "normal", "color"]);
}

/** `geometry`, non-indexed, its vertex colour a grey of `value`. */
function shaded(geometry: BufferGeometry, value: number): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  const count = flat.getAttribute("position").count;
  flat.setAttribute("color", new BufferAttribute(new Float32Array(count * 3).fill(value), 3));
  return flat;
}

/** A brain coral: a grooved, flattened dome a unit across. */
export function brainCoral(): BufferGeometry {
  const ball = new IcosahedronGeometry(1, 3);
  const position = ball.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const point = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const groove =
      Math.sin(point.x * 11 + Math.sin(point.z * 7) * 2) *
      Math.sin(point.z * 11 + Math.sin(point.y * 6));
    const k = 1 + groove * 0.06;
    position.setXYZ(
      index,
      point.x * k * 0.9,
      Math.max(point.y * 0.62 * k, -0.1) + 0.1,
      point.z * k * 0.9,
    );
    colors.fill(0.55 + groove * 0.35 + point.y * 0.3, index * 3, index * 3 + 3);
  }
  ball.setAttribute("color", new BufferAttribute(colors, 3));
  ball.deleteAttribute("uv");
  ball.computeVertexNormals();
  return ball;
}

/** A cluster of tube coral, brighter towards each tube's mouth. */
export function tubeCoral(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const random = seededRandom(7);
  for (let tube = 0; tube < 7; tube += 1) {
    const height = 0.6 + random() * 1.4;
    const radius = 0.1 + random() * 0.12;
    const shape = new CylinderGeometry(radius, radius * 0.8, height, 7, 3, true);
    const position = shape.getAttribute("position");
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      const t = (position.getY(index) + height / 2) / height;
      colors.fill(0.35 + t * t * 1.3, index * 3, index * 3 + 3);
    }
    shape.setAttribute("color", new BufferAttribute(colors, 3));
    const turn = random() * TAU;
    const out = random() * 0.35;
    shape.translate(0, height / 2, 0);
    shape.rotateX((random() - 0.5) * 0.5);
    shape.rotateZ((random() - 0.5) * 0.5);
    shape.translate(Math.cos(turn) * out, 0, Math.sin(turn) * out);
    parts.push(shape);
  }
  return merged(parts, ["position", "normal", "color"]);
}

/** A sea anemone about a unit tall: sixteen tentacles on a foot, each vertex's height along its tentacle in `aT`. */
export function anemoneGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const point = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (let arm = 0; arm < 16; arm += 1) {
    const shape = new CylinderGeometry(0.03, 0.09, 1, 4, 6, true).translate(0, 0.5, 0);
    const position = shape.getAttribute("position");
    const along = new Float32Array(position.count);
    const turn = (arm / 16) * TAU;
    const tilt = 0.35 + (arm % 3) * 0.2;
    const length = 1.1 + (arm % 4) * 0.25;
    for (let index = 0; index < position.count; index += 1) {
      const y = position.getY(index);
      along[index] = y;
      point.set(position.getX(index), y * length, position.getZ(index));
      point.x += Math.sin(tilt) * y * y * length * 0.9;
      point.applyAxisAngle(up, turn);
      position.setXYZ(index, point.x, point.y, point.z);
    }
    shape.setAttribute("aT", new BufferAttribute(along, 1));
    parts.push(shape);
  }
  const foot = new CylinderGeometry(0.25, 0.32, 0.25, 10).translate(0, 0.1, 0);
  foot.setAttribute(
    "aT",
    new BufferAttribute(new Float32Array(foot.getAttribute("position").count).fill(0.15), 1),
  );
  parts.push(foot);
  return merged(parts, ["position", "normal", "aT"]);
}

/** A boulder a unit across, its faces knocked about by noise seeded `seed`. */
export function boulderGeometry(seed: number): BufferGeometry {
  const rock = new IcosahedronGeometry(1, 2);
  const position = rock.getAttribute("position");
  const point = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const k =
      1 + (fractalNoise(point.x * 1.7 + seed, point.z * 1.7 + point.y * 1.3, 3) - 0.5) * 0.9;
    point.multiplyScalar(k);
    point.y *= 0.62;
    position.setXYZ(index, point.x, point.y, point.z);
  }
  rock.deleteAttribute("uv");
  rock.computeVertexNormals();
  return rock;
}

/**
 * The rock a reef district stands on: radius 1 at its foot, its flat top at
 * y = 1, its foot sunk to y = -0.6 so it never floats on a rise of the floor.
 */
export function reefRockGeometry(seed: number): BufferGeometry {
  const rock = new CylinderGeometry(0.96, 1.22, 1.6, 40, 5);
  rock.translate(0, 0.2, 0);
  const position = rock.getAttribute("position");
  const point = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const turn = Math.atan2(point.z, point.x);
    const k =
      1 +
      (fractalNoise(Math.cos(turn) * 2 + seed, point.y * 2.5 + Math.sin(turn) * 2, 3) - 0.5) * 0.42;
    const top = point.y > 0.99;
    position.setXYZ(
      index,
      point.x * k,
      top ? 1 + (fractalNoise(point.x * 2 + seed, point.z * 2, 2) - 0.5) * 0.12 : point.y,
      point.z * k,
    );
  }
  rock.deleteAttribute("uv");
  rock.computeVertexNormals();
  return rock;
}

/** A fish a unit long, nose to +z, its tail free to wiggle. */
export function fishGeometry(): BufferGeometry {
  const body = new SphereGeometry(0.5, 10, 6).scale(0.34, 0.5, 1.15);
  const tail = new CylinderGeometry(0, 0.42, 0.7, 3)
    .rotateX(Math.PI / 2)
    .scale(0.18, 1, 1)
    .translate(0, 0, -0.85);
  return merged([body, tail]);
}

/**
 * A tube of `segments` rings of `sides` along u in [0, 1], for a shader
 * that bends it along a curve of its instance's own: each vertex's
 * `position` is (u, cos θ, sin θ) and its `uv` (u, θ / 2π).
 */
export function bendableTube(segments: number, sides: number): BufferGeometry {
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let ring = 0; ring <= segments; ring += 1) {
    const u = ring / segments;
    for (let side = 0; side <= sides; side += 1) {
      const v = side / sides;
      position.push(u, Math.cos(v * TAU), Math.sin(v * TAU));
      uv.push(u, v);
    }
  }
  for (let ring = 0; ring < segments; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = ring * (sides + 1) + side;
      const b = a + sides + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const tube = new BufferGeometry();
  tube.setAttribute("position", new Float32BufferAttribute(position, 3));
  tube.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  tube.setIndex(index);
  return tube;
}

/** The GLSL that bends a `bendableTube` along the quadratic Bézier through its instance's `aFrom`, `aBend`, and `aTo`. */
export const GLSL_BEND = /* glsl */ `
attribute vec3 aFrom; attribute vec3 aBend; attribute vec3 aTo;
vec3 bendAt(float u){ float w = 1.0 - u; return w*w*aFrom + 2.0*u*w*aBend + u*u*aTo; }
vec3 bendTangent(float u){ return normalize(2.0*(1.0-u)*(aBend-aFrom) + 2.0*u*(aTo-aBend) + vec3(0.0, 1e-5, 0.0)); }
vec3 bendTube(vec3 p, float radius){
  vec3 t = bendTangent(p.x);
  vec3 side = normalize(cross(t, abs(t.y) > 0.98 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0)));
  vec3 up = cross(side, t);
  return bendAt(p.x) + (side*p.y + up*p.z)*radius;
}
`;

/**
 * A tube along `curve`, tapering from `fromRadius` to `toRadius`, each
 * vertex's distance along it in `aU` and the tube's phase in `aPh`, for the
 * sway a tentacle's material gives it.
 */
export function taperedTube(
  curve: Curve<Vector3>,
  segments: number,
  sides: number,
  fromRadius: number,
  toRadius: number,
  phase: number,
): BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, false);
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const along: number[] = [];
  const phases: number[] = [];
  const index: number[] = [];
  const out = new Vector3();
  for (let ring = 0; ring <= segments; ring += 1) {
    const u = ring / segments;
    const centre = curve.getPointAt(u);
    const radius = lerp(fromRadius, toRadius, u ** 0.8) * (ring === segments ? 0.2 : 1);
    const frameNormal = frames.normals[ring] ?? new Vector3(1, 0, 0);
    const frameBinormal = frames.binormals[ring] ?? new Vector3(0, 0, 1);
    for (let side = 0; side <= sides; side += 1) {
      const v = side / sides;
      out
        .copy(frameNormal)
        .multiplyScalar(Math.cos(v * TAU))
        .addScaledVector(frameBinormal, Math.sin(v * TAU))
        .normalize();
      position.push(
        centre.x + out.x * radius,
        centre.y + out.y * radius,
        centre.z + out.z * radius,
      );
      normal.push(out.x, out.y, out.z);
      uv.push(u, v);
      along.push(u);
      phases.push(phase);
    }
  }
  for (let ring = 0; ring < segments; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = ring * (sides + 1) + side;
      const b = a + sides + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const tube = new BufferGeometry();
  tube.setAttribute("position", new Float32BufferAttribute(position, 3));
  tube.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  tube.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  tube.setAttribute("aU", new Float32BufferAttribute(along, 1));
  tube.setAttribute("aPh", new Float32BufferAttribute(phases, 1));
  tube.setIndex(index);
  return tube;
}
