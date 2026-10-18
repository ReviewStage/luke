import {
  type BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  type Material,
  MeshPhysicalMaterial,
  type MeshPhysicalMaterialParameters,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * shapes.ts -- the colony's noise and its modelled shapes: the ant and the beetle with legs a shader walks, the loads a team carries, the anthill, the leaf tent, the flower.
 *
 * Everything here is built once, in a world's `create`, at unit size, and
 * scaled per instance. The noise is a seeded hash rather than a random
 * source, so a zone's chamber, a mound's lumps, and a team's wander land the
 * same way every time the same snapshot is drawn.
 */

export const UP = new Vector3(0, 1, 0);

/** Which part of a bug a vertex belongs to, read by `bugMaterial`'s shader: the body, a leg's two swing groups, or an antenna. */
const LEG = { BODY: 0, LEFT: 1, RIGHT: -1, ANTENNA: 2 } as const;

/** What a bug's vertex is painted, read by `bugMaterial`'s shader: its own colour, an eye's white, its pupil, or a beetle's lit eye. */
const PAINT = { BODY: 0, EYE: 1, PUPIL: 2, GLOW: 3 } as const;

/* ----- Noise ----- */

/** A seeded generator in [0, 1): mulberry32. */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `text` hashed into [0, 1) by FNV-1a, so a path or an id seeds the same draw every time. */
export function hashUnit(text: string, salt = 0): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  return ((hash ^ (hash >>> 13)) >>> 0) / 2 ** 32;
}

export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise in [0, 1]. */
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** `octaves` of value noise, each twice the frequency and half the weight of the last. */
export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let weight = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += weight * vnoise(x * frequency, y * frequency);
    frequency *= 2.03;
    weight *= 0.5;
  }
  return sum;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/* ----- Materials ----- */

/** Adds a per-instance glow (`aGlow`, a float) to `material`: its own colour, emitted `strength` times over. */
export function withGlow<M extends Material>(material: M, strength: number, key: string): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aGlow;\nvarying float vGlow;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * ${strength.toFixed(3)};`,
      );
  };
  material.customProgramCacheKey = () => `colony-glow-${key}`;
  return material;
}

/** Adds a per-instance emitted colour (`aEmissive`, linear RGB) to `material`, the light a highlight casts from inside. */
export function withEmissive<M extends Material>(material: M, key: string): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 aEmissive;\nvarying vec3 vEmissive;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEmissive = aEmissive;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEmissive;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEmissive;",
      );
  };
  material.customProgramCacheKey = () => `colony-emissive-${key}`;
  return material;
}

/**
 * A bug's material: its legs swing from their hips and its antennae sway by
 * the per-instance phase `aPhase`, so a hundred walking ants are one draw.
 * Its eyes are painted by `aPaint` over whatever colour the instance wears.
 */
export function bugMaterial(
  params: MeshPhysicalMaterialParameters,
  key: string,
): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial(params);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec3 aHip; attribute float aLeg; attribute float aPaint; attribute float aPhase;
        varying float vPaint;
        mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
        vPaint = aPaint;
        if (aLeg > 1.5) { vec3 q = transformed - aHip; q.yz = rot2(sin(aPhase * 0.7) * 0.22) * q.yz; q.xz = rot2(sin(aPhase * 0.45 + aHip.x * 30.0) * 0.25) * q.xz; transformed = aHip + q; }
        else if (abs(aLeg) > 0.5) { vec3 q = transformed - aHip; q.xz = rot2(sin(aPhase) * 0.42 * aLeg) * q.xz; q.y += max(0.0, cos(aPhase) * aLeg) * 0.12 * smoothstep(0.0, 0.35, length(q.xz)); transformed = aHip + q; }
        transformed.y += 0.014 * sin(aPhase * 2.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vPaint;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (vPaint > 0.5) diffuseColor.rgb = vPaint < 1.5 ? vec3(0.96, 0.94, 0.88) : (vPaint < 2.5 ? vec3(0.02) : vec3(0.95, 0.12, 0.06));`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\nif (vPaint > 2.5) totalEmissiveRadiance += vec3(5.0, 0.5, 0.2);",
      );
  };
  material.customProgramCacheKey = () => `colony-bug-${key}`;
  return material;
}

/* ----- Bugs ----- */

const ORIGIN = new Vector3();

/** Tags every vertex of `geometry` with its hip, its leg group, and its paint, for `bugMaterial`. */
function tag(geometry: BufferGeometry, hip: Vector3, leg: number, paint: number): BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const hips = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) hips.set([hip.x, hip.y, hip.z], index * 3);
  geometry.setAttribute("aHip", new Float32BufferAttribute(hips, 3));
  geometry.setAttribute("aLeg", new Float32BufferAttribute(new Float32Array(count).fill(leg), 1));
  geometry.setAttribute(
    "aPaint",
    new Float32BufferAttribute(new Float32Array(count).fill(paint), 1),
  );
  return geometry;
}

function ellipsoid(
  size: [number, number, number],
  at: [number, number, number],
  paint: number = PAINT.BODY,
  segments: [number, number] = [10, 8],
): BufferGeometry {
  const geometry = new SphereGeometry(1, segments[0], segments[1]);
  geometry.scale(...size);
  geometry.translate(...at);
  return tag(geometry, ORIGIN, LEG.BODY, paint);
}

function rod(
  from: Vector3,
  to: Vector3,
  radius: number,
  hip: Vector3 = ORIGIN,
  leg: number = LEG.BODY,
  paint: number = PAINT.BODY,
): BufferGeometry {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const geometry = new CylinderGeometry(radius * 0.75, radius, length, 5, 1, true);
  geometry.translate(0, length / 2, 0);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP, direction.normalize()));
  geometry.translate(from.x, from.y, from.z);
  return tag(geometry, hip, leg, paint);
}

/** Three pairs of legs, each a femur and a tibia, alternating tripods so a walk swings them in turn. */
function legs(
  parts: BufferGeometry[],
  hipY: number,
  pairs: readonly [number, number, number],
  reach: readonly [number, number, number],
  shape: { spread: number; femur: number; thick: number },
): void {
  pairs.forEach((z0, pair) => {
    const forward = reach[pair] ?? 0;
    for (const side of [-1, 1]) {
      const hip = new Vector3(side * 0.07 * shape.spread, hipY, z0);
      const knee = new Vector3(side * shape.femur * shape.spread, hipY + 0.15, z0 + forward * 0.6);
      const foot = new Vector3(side * (shape.femur + 0.17) * shape.spread, 0, z0 + forward * 1.6);
      const group = (pair % 2 === 0) === side < 0 ? LEG.LEFT : LEG.RIGHT;
      parts.push(
        rod(hip, knee, shape.thick, hip, group),
        rod(knee, foot, shape.thick * 0.78, hip, group),
      );
    }
  });
}

/** An ant a unit long, facing +z, standing on y = 0. */
export function antGeometry(): BufferGeometry {
  const parts = [
    ellipsoid([0.2, 0.17, 0.28], [0, 0.33, -0.36]),
    ellipsoid([0.06, 0.06, 0.07], [0, 0.29, -0.08]),
    ellipsoid([0.11, 0.1, 0.17], [0, 0.3, 0.06]),
    ellipsoid([0.15, 0.14, 0.15], [0, 0.36, 0.3]),
  ];
  for (const side of [-1, 1]) {
    parts.push(
      ellipsoid([0.068, 0.072, 0.06], [side * 0.085, 0.41, 0.39], PAINT.EYE, [8, 6]),
      ellipsoid([0.036, 0.04, 0.03], [side * 0.095, 0.418, 0.443], PAINT.PUPIL, [6, 5]),
      rod(new Vector3(side * 0.05, 0.28, 0.42), new Vector3(side * 0.02, 0.24, 0.53), 0.026),
    );
    const hip = new Vector3(side * 0.05, 0.47, 0.36);
    const knee = new Vector3(side * 0.13, 0.67, 0.42);
    const tip = new Vector3(side * 0.2, 0.67, 0.63);
    parts.push(
      rod(hip, knee, 0.017, hip, LEG.ANTENNA),
      rod(knee, tip, 0.015, hip, LEG.ANTENNA),
      ellipsoid([0.025, 0.025, 0.025], [tip.x, tip.y, tip.z], PAINT.BODY, [5, 4]),
    );
  }
  legs(parts, 0.27, [0.13, 0.06, -0.01], [0.16, 0, -0.18], {
    spread: 1,
    femur: 0.27,
    thick: 0.024,
  });
  return mergeGeometries(parts);
}

/** A beetle a little over a unit long, facing +z, standing on y = 0, its eyes lit. */
export function beetleGeometry(): BufferGeometry {
  const parts = [
    ellipsoid([0.4, 0.27, 0.52], [0, 0.3, -0.08], PAINT.BODY, [14, 10]),
    ellipsoid([0.2, 0.12, 0.14], [0, 0.27, 0.42]),
    ellipsoid([0.13, 0.1, 0.1], [0, 0.26, 0.55]),
  ];
  for (const side of [-1, 1]) {
    parts.push(
      ellipsoid([0.05, 0.05, 0.05], [side * 0.09, 0.3, 0.62], PAINT.GLOW, [6, 5]),
      rod(new Vector3(side * 0.05, 0.25, 0.62), new Vector3(side * 0.14, 0.2, 0.78), 0.03),
    );
    const hip = new Vector3(side * 0.06, 0.34, 0.6);
    parts.push(rod(hip, new Vector3(side * 0.28, 0.5, 0.86), 0.016, hip, LEG.ANTENNA));
  }
  parts.push(
    rod(
      new Vector3(0, 0.56, -0.5),
      new Vector3(0, 0.56, 0.36),
      0.012,
      ORIGIN,
      LEG.BODY,
      PAINT.PUPIL,
    ),
  );
  legs(parts, 0.22, [0.18, 0.02, -0.16], [0.18, 0, -0.2], {
    spread: 2.2,
    femur: 0.26,
    thick: 0.03,
  });
  return mergeGeometries(parts);
}

/* ----- Loads and props ----- */

/** A cupped leaf a unit long, veined in its vertex colours. */
export function leafGeometry(length = 1, width = 0.62): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(0, -length / 2);
  shape.bezierCurveTo(width * 0.7, -length * 0.3, width * 0.55, length * 0.25, 0, length / 2);
  shape.bezierCurveTo(-width * 0.55, length * 0.25, -width * 0.7, -length * 0.3, 0, -length / 2);
  const geometry = new ShapeGeometry(shape, 10);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const colors: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    position.setY(index, x * x * 0.7 + (z / length) * (z / length) * 0.12);
    const rib = Math.exp(-((x / 0.03) ** 2)) * 0.35;
    const vein = Math.max(0, Math.sin((Math.abs(x) * 9 - z * 6) * 3)) * 0.08;
    colors.push(0.55 + rib + vein, 0.82 + rib * 0.4 + vein, 0.38 + rib * 0.4);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A lump half a unit across, flattened by `flat` and roughened by `rough`, seeded by `seed`. */
export function lumpGeometry(seed: number, flat = 0.75, rough = 0.18, detail = 2): BufferGeometry {
  const geometry = new IcosahedronGeometry(0.5, detail);
  const position = geometry.getAttribute("position");
  const point = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const n = vnoise(point.x * 4 + seed, point.y * 4 + point.z * 3) - 0.5;
    point.multiplyScalar(1 + n * rough * 2);
    point.y *= flat;
    position.setXYZ(index, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** An anthill of radius 1 with its crater at the top, its clay shaded in vertex colours over `color`. */
export function anthillGeometry(
  seed: number,
  color: { r: number; g: number; b: number },
): BufferGeometry {
  const height = 0.8;
  const hole = 0.1;
  const profile: Vector2[] = [];
  for (let index = 0; index <= 20; index += 1) {
    const a = (index / 20) * (Math.PI / 2) * 0.93;
    profile.push(new Vector2(Math.cos(a) ** 1.35, height * Math.sin(a) ** 0.75));
  }
  profile.push(
    new Vector2(hole * 2.2, height * 0.97),
    new Vector2(hole * 1.5, height * 1.02),
    new Vector2(hole * 1.05, height * 0.98),
    new Vector2(hole * 0.9, height * 0.8),
    new Vector2(hole * 0.6, height * 0.5),
  );
  const geometry = new LatheGeometry(profile, 48);
  const position = geometry.getAttribute("position");
  const colors: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    let x = position.getX(index);
    const y = position.getY(index);
    let z = position.getZ(index);
    const r = Math.hypot(x, z);
    const n = fbm(x * 2.4 + seed, z * 2.4 + y * 1.7, 3) - 0.5;
    const push = r > hole * 1.6 ? n * 0.16 * (1 - (0.5 * y) / height) : 0;
    if (r > 1e-4) {
      x *= 1 + push / r;
      z *= 1 + push / r;
    }
    position.setXYZ(index, x, y + n * 0.08, z);
    const inside = r < hole * 1.08 && y < height * 0.99;
    const speck = hash2(Math.round(x * 30), Math.round(z * 30 + y * 23)) > 0.9 ? 0.18 : 0;
    const k = inside ? 0.1 : 0.82 + n * 0.55 + (y / height) * 0.12 + speck;
    colors.push(color.r * k, color.g * k, color.b * k);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A leaf bent over into a tent of radius 1, veined in its vertex colours. */
export function leafTentGeometry(): BufferGeometry {
  const geometry = new PlaneGeometry(1, 1, 30, 12);
  const position = geometry.getAttribute("position");
  const colors: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const u = position.getX(index) * 2;
    const v = position.getY(index) * 2;
    const width = Math.max(0, 1 - u * u) ** 0.55 * 0.62;
    const angle = u * 1.25;
    position.setXYZ(
      index,
      Math.sin(angle) * 1.05,
      (Math.cos(angle) - Math.cos(1.25)) * 0.92 - v * v * 0.1,
      v * width,
    );
    const rib = Math.exp(-((v / 0.05) ** 2)) * 0.3;
    const vein = Math.max(0, Math.sin((Math.abs(v) * 7 - u * 5) * 3)) * 0.07;
    colors.push(0.52 + rib + vein, 0.74 + rib * 0.4 + vein, 0.3 + rib * 0.3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A flower's head of six petals, a unit across. */
export function flowerHeadGeometry(): BufferGeometry {
  const petals: BufferGeometry[] = [];
  for (let index = 0; index < 6; index += 1) {
    const petal = new SphereGeometry(1, 10, 6);
    petal.scale(0.5, 0.12, 0.26);
    petal.translate(0.5, 0, 0);
    petal.rotateZ(0.25);
    petal.rotateY((index / 6) * Math.PI * 2);
    petals.push(petal);
  }
  return mergeGeometries(petals);
}

/** A mushroom's stem, a unit tall to its cap. */
export function stemGeometry(): BufferGeometry {
  return new LatheGeometry(
    [
      new Vector2(0.001, 0),
      new Vector2(0.3, 0),
      new Vector2(0.24, 0.5),
      new Vector2(0.2, 0.95),
      new Vector2(0.001, 0.95),
    ],
    28,
  );
}
