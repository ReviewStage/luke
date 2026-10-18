import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BackSide,
  type BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  LineCurve3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  Quaternion,
  RGBAFormat,
  type Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  type Texture,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  type Burrows,
  type Chamber,
  COLONY,
  holeOutline,
  MAX_TUNNELS,
  MOUND_KIND,
  type Mound,
} from "./layout";
import {
  anthillGeometry,
  hashUnit,
  leafTentGeometry,
  lumpGeometry,
  seeded,
  stemGeometry,
  UP,
  vnoise,
  withEmissive,
} from "./shapes";
import { grainOf } from "./soil";

/**
 * burrows.ts -- what the burrows are dug as: each zone's chamber, its packed floor, its rim, the core's stone lips, the tunnels and shafts, and the anthills on the meadow.
 *
 * Anything there is one of per zone is an instanced mesh allocated at the
 * contract's bound of zones and placed per instance. What follows a
 * chamber's own outline or a tunnel's own curve, its rim, its lip, the
 * tunnel's tube and the glow along it, is one merged mesh, rebuilt only
 * when the burrows change shape. Every highlight is read from a small
 * texture of one texel per zone (`zones`), so a hover rewrites a few hundred
 * floats rather than a geometry.
 */

const MAX_ZONES = FACTORY_WORLD_BOUNDS.MAX_ZONES;

/** The zone texture's width, one texel per zone; its first row is each rim's colour and strength, its second each zone's blast distance. */
const ZONE_TEXELS = 256;

/** How long, in seconds, the blast radius takes to ripple one dependency further out. */
export const BLAST_STEP = 0.45;

const SPOTS_PER_MUSHROOM = 11;

/** A cairn's three stones, bottom up: each one's size and height, of its anthill's radius, and its colour. */
const CAIRN = [
  [0.9, 0.25, "#a59b93"],
  [0.62, 0.75, "#948f94"],
  [0.42, 1.12, "#b8aa9a"],
] as const;
const TWIGS_PER_MOUND = 9;
const STONES_PER_CAIRN = 3;

/** How one zone is lit: its rim's colour and strength, and the colour its chamber glows from inside. */
export interface ZoneLook {
  readonly rim: Color;
  strength: number;
  readonly glow: Color;
}

/** An instanced mesh whose instances each stand for a zone, by chamber index. */
interface Owned {
  readonly mesh: InstancedMesh;
  readonly owners: number[];
  readonly glow: InstancedBufferAttribute;
}

function owned(
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  capacity: number,
  key: string,
): Owned {
  const glow = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute("aEmissive", glow);
  const mesh = new InstancedMesh(geometry, withEmissive(material, key), capacity);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, owners: [], glow };
}

/** A chamber's cavity: a sphere seen from inside, wobbled by its zone's phases, shaded darker toward its back and floor. */
function cavityOf(capacity: number, grain: Texture) {
  const geometry = new SphereGeometry(1, 48, 28);
  const position = geometry.getAttribute("position");
  const colors: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const k =
      0.3 + 0.24 * (0.5 - 0.5 * y) + 0.2 * Math.max(0, -z) + (vnoise(x * 4, y * 4) - 0.5) * 0.12;
    colors.push(k, k * 0.97, k * 0.94);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const blob = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  const glow = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute("aBlob", blob);
  geometry.setAttribute("aEmissive", glow);
  const material = new MeshStandardMaterial({
    color: "#a2704a",
    roughness: 1,
    side: BackSide,
    vertexColors: true,
    normalMap: grainOf(grain, 5, 3),
    normalScale: new Vector2(0.7, 0.7),
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aBlob;\nattribute vec3 aEmissive;\nvarying vec3 vEmissive;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float around = atan(transformed.y, transformed.x);
        transformed.xy *= 1.0 + 0.06 * sin(3.0 * around + aBlob.x) + 0.04 * sin(5.0 * around + aBlob.y);
        vEmissive = aEmissive;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEmissive;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEmissive;",
      );
  };
  material.customProgramCacheKey = () => "colony-cavity";
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.receiveShadow = true;
  return { mesh, blob, glow };
}

/** A tube's vertex colours: darker toward its back and its floor, as the cavities are. */
function shadeTube(geometry: BufferGeometry): BufferGeometry {
  const normal = geometry.getAttribute("normal");
  const colors: number[] = [];
  for (let index = 0; index < normal.count; index += 1) {
    const k = 0.2 + 0.2 * (0.5 - 0.5 * normal.getY(index)) + 0.2 * Math.max(0, -normal.getZ(index));
    colors.push(k, k * 0.97, k * 0.93);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Tags every vertex of `geometry` with the float `value` under `name`. */
function stamp(geometry: BufferGeometry, name: string, values: readonly number[]): BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const data = new Float32Array(count * values.length);
  for (let index = 0; index < count; index += 1) data.set(values, index * values.length);
  geometry.setAttribute(name, new Float32BufferAttribute(data, values.length));
  return geometry;
}

/** Merges `parts`, or answers an empty geometry for none. */
function merged(parts: BufferGeometry[], attributes: readonly string[]): BufferGeometry {
  if (parts.length > 0) return mergeGeometries(parts);
  const empty = new SphereGeometry(0.001, 3, 2);
  for (const name of attributes)
    stamp(empty, name, name === "aEnds" ? [0, 0] : name === "color" ? [0, 0, 0] : [0]);
  return empty;
}

/** Swaps `mesh`'s geometry for `next`, letting go of the last. */
function swap(mesh: Mesh, next: BufferGeometry): void {
  mesh.geometry.dispose();
  mesh.geometry = next;
}

/** The rim's shader: each zone's colour and strength from its texel, drawn exactly, unlit. */
const RIM_SHADER = {
  vertexShader: `uniform sampler2D uZones; attribute float aZone; varying vec4 vRim;
    void main(){ vRim = texture2D(uZones, vec2((aZone + 0.5) / ${ZONE_TEXELS.toFixed(1)}, 0.25)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec4 vRim;
    void main(){ if (vRim.a < 0.01) discard; gl_FragColor = vRim;
    #include <colorspace_fragment>
    }`,
};

/**
 * The tunnel glow's shader: faint dashes along every dependency, and, while
 * an agent is chosen, the blast radius running up each tunnel from the zone
 * nearer what it touched toward the one depending on it, starting as the
 * ripple reaches it.
 */
const GLOW_SHADER = {
  vertexShader: `uniform sampler2D uZones; attribute vec2 aEnds; attribute float aLength;
    varying vec2 vUv; varying float vOn; varying float vStart; varying float vLength;
    float distanceOf(float zone){ return texture2D(uZones, vec2((zone + 0.5) / ${ZONE_TEXELS.toFixed(1)}, 0.75)).r; }
    void main(){
      vUv = uv; vLength = aLength;
      float from = distanceOf(aEnds.x); float to = distanceOf(aEnds.y);
      vOn = (from >= 0.0 && to >= 0.0 && from > to) ? 1.0 : 0.0;
      vStart = to * ${BLAST_STEP.toFixed(2)};
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `uniform float uTime, uSince, uTrail; uniform vec3 uColor, uTrailColor;
    varying vec2 vUv; varying float vOn; varying float vStart; varying float vLength;
    void main(){
      float a = 1.0 - vUv.x;
      float dash = smoothstep(0.6, 1.0, sin(vUv.x * vLength * 0.8 + uTime * 2.2) * 0.5 + 0.5);
      float p = clamp((uSince - vStart) / max(0.25, vLength * 0.02), 0.0, 1.6);
      float lit = step(a, p) * (0.55 + 0.45 * sin(a * vLength * 1.1 - uTime * 7.0));
      float head = exp(-pow((a - p) * vLength * 0.5, 2.0));
      float v = vOn * (lit * 1.6 + head * 4.0);
      vec3 c = uColor * v + uTrailColor * uTrail * (0.2 + 0.8 * dash);
      gl_FragColor = vec4(c, clamp(v + uTrail, 0.0, 1.0));
      #include <colorspace_fragment>
    }`,
};

/* ----- Public ----- */

/** The burrows as drawn: laid out per shape, lit per state. */
export interface BurrowsMeshes {
  /** Every per-zone instanced mesh and the zone each instance stands for, for picking. */
  readonly pickable: readonly {
    readonly mesh: InstancedMesh;
    readonly owners: readonly number[];
  }[];
  readonly layout: (burrows: Burrows) => void;
  /** Lights the first `count` zones as `looks` says, by chamber index. */
  readonly light: (looks: readonly ZoneLook[], count: number) => void;
  /** Ripples the blast radius out from `distances` (by chamber index), `since` seconds after it began; none draws only the faint trails. */
  readonly blast: (distances: ReadonlyMap<number, number>, since: number, colour: Color) => void;
}

export function burrowsMeshesOf(
  scene: Scene,
  grain: Texture,
  time: { value: number },
): BurrowsMeshes {
  const texels = new Float32Array(ZONE_TEXELS * 2 * 4);
  const zones = new DataTexture(texels, ZONE_TEXELS, 2, RGBAFormat, FloatType);
  zones.magFilter = NearestFilter;
  zones.minFilter = NearestFilter;
  zones.needsUpdate = true;

  const cavity = cavityOf(MAX_ZONES, grain);
  const halfDisc = new Shape();
  halfDisc.moveTo(1, 0);
  for (let step = 1; step <= 32; step += 1)
    halfDisc.lineTo(Math.cos((step / 32) * Math.PI), Math.sin((step / 32) * Math.PI));
  // Note that the floor reaches back from the face, its top up.
  const floors = new InstancedMesh(
    new ShapeGeometry(halfDisc).rotateX(-Math.PI / 2),
    new MeshStandardMaterial({
      color: "#9b6c47",
      roughness: 1,
      normalMap: grainOf(grain, 3, 3),
      normalScale: new Vector2(0.6, 0.6),
    }),
    MAX_ZONES,
  );
  floors.receiveShadow = true;
  floors.count = 0;
  // Note that a chamber's stand-in is never drawn, only raycast, so it costs no draw call.
  const standIns = new InstancedMesh(
    new CircleGeometry(1, 24),
    new MeshBasicMaterial({ visible: false }),
    MAX_ZONES,
  );
  standIns.count = 0;
  const standInOwners: number[] = [];

  const clay = (color: string) =>
    new MeshStandardMaterial({
      color,
      roughness: 0.9,
      vertexColors: true,
      normalMap: grainOf(grain, 3, 2),
      normalScale: new Vector2(0.8, 0.8),
    });
  const plain = (color: string, roughness = 0.9) => new MeshStandardMaterial({ color, roughness });
  const hills = owned(
    anthillGeometry(1.7, { r: 1, g: 1, b: 1 }),
    clay("#ffffff"),
    MAX_ZONES,
    "hill",
  );
  const tents = owned(
    leafTentGeometry(),
    new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.6 }),
    MAX_ZONES,
    "tent",
  );
  const stalks = owned(
    new CylinderGeometry(0.06, 0.08, 1, 6, 1, true).translate(0, 0.5, 0),
    plain("#6f8f3a"),
    MAX_ZONES,
    "stalk",
  );
  const stems = owned(stemGeometry(), plain("#f2e4c8"), MAX_ZONES, "stem");
  const caps = owned(
    new SphereGeometry(1, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1),
    plain("#c87a4a", 0.45),
    MAX_ZONES,
    "cap",
  );
  const gills = owned(
    new CircleGeometry(0.99, 40).rotateX(Math.PI / 2),
    new MeshStandardMaterial({ color: "#efd9b6", side: DoubleSide }),
    MAX_ZONES,
    "gills",
  );
  const spots = owned(
    new SphereGeometry(1, 12, 8).scale(1, 0.35, 1),
    plain("#fff8ea", 0.7),
    MAX_ZONES * SPOTS_PER_MUSHROOM,
    "spots",
  );
  const twigs = owned(
    new CylinderGeometry(0.75, 1, 1, 5, 1, true).translate(0, 0.5, 0),
    plain("#6c4a2e"),
    MAX_ZONES * TWIGS_PER_MOUND,
    "twigs",
  );
  const stones = owned(
    lumpGeometry(7, 0.6, 0.06, 3),
    plain("#ffffff", 0.6),
    MAX_ZONES * STONES_PER_CAIRN,
    "stones",
  );
  const mounds = [hills, tents, stalks, stems, caps, gills, spots, twigs, stones];

  const rims = new Mesh(
    merged([], ["aZone"]),
    new ShaderMaterial({
      ...RIM_SHADER,
      transparent: true,
      depthWrite: false,
      uniforms: { uZones: { value: zones } },
    }),
  );
  rims.frustumCulled = false;
  const lips = new Mesh(
    merged([], []),
    new MeshStandardMaterial({
      color: "#a8957c",
      roughness: 0.7,
      normalMap: grainOf(grain, 8, 1),
      normalScale: new Vector2(0.6, 0.6),
    }),
  );
  lips.castShadow = true;
  const tunnels = new Mesh(
    merged([], ["color"]),
    new MeshStandardMaterial({
      color: "#a2704a",
      roughness: 1,
      side: BackSide,
      vertexColors: true,
      normalMap: grainOf(grain, 12, 1),
      normalScale: new Vector2(0.6, 0.6),
    }),
  );
  tunnels.receiveShadow = true;
  const glowUniforms = {
    uZones: { value: zones },
    uTime: time,
    uSince: { value: 0 },
    uTrail: { value: 0.05 },
    uColor: { value: new Color() },
    uTrailColor: { value: new Color("#ffe2b0") },
  };
  const glows = new Mesh(
    merged([], ["aEnds", "aLength"]),
    new ShaderMaterial({
      ...GLOW_SHADER,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: glowUniforms,
    }),
  );
  glows.frustumCulled = false;
  scene.add(
    cavity.mesh,
    floors,
    standIns,
    rims,
    lips,
    tunnels,
    glows,
    ...mounds.map((mound) => mound.mesh),
  );

  const placing = new Object3D();
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const size = new Vector3();
  let laid: Burrows | undefined;

  /** Places the next instance of `part` for chamber `owner`. */
  const put = (part: Owned, owner: number, at: Matrix4) => {
    const index = part.owners.length;
    part.owners.push(owner);
    part.mesh.setMatrixAt(index, at);
  };
  const rod = (part: Owned, owner: number, from: Vector3, to: Vector3, radius: number) => {
    const direction = to.clone().sub(from);
    turn.setFromUnitVectors(UP, direction.clone().normalize());
    put(part, owner, matrix.compose(from, turn, size.set(radius, direction.length(), radius)));
  };
  const placed = (
    x: number,
    y: number,
    z: number,
    yaw: number,
    sx: number,
    sy: number,
    sz: number,
  ) => {
    placing.position.set(x, y, z);
    placing.rotation.set(0, yaw, 0);
    placing.scale.set(sx, sy, sz);
    placing.updateMatrix();
    return placing.matrix;
  };

  /** Dresses one surface zone's anthill as its kind says. */
  const dress = (chamber: Chamber, mound: Mound) => {
    const { x, z, r, rz } = mound;
    const owner = chamber.index;
    const random = seeded(Math.floor(hashUnit(chamber.zone.path, 13) * 1e9));
    const yaw = random() * Math.PI * 2;
    const hill = (scale: number, color: string) => {
      put(hills, owner, placed(x, 0, z, yaw, r * scale, r * scale, Math.min(r * scale, rz)));
      hills.mesh.setColorAt(hills.owners.length - 1, new Color(color));
    };
    switch (mound.kind) {
      case MOUND_KIND.HILL:
        hill(1, "#c08a55");
        return;
      case MOUND_KIND.LEAF:
        hill(0.45, "#c08a55");
        put(tents, owner, placed(x, 0, z, 0.35, r, r, rz));
        rod(
          stalks,
          owner,
          new Vector3(x + r * Math.cos(0.35), 0.05, z - r * Math.sin(0.35)),
          new Vector3(
            x + 1.35 * r * Math.cos(0.35) + 0.2 * Math.sin(0.35),
            0.5,
            z - 1.35 * r * Math.sin(0.35) + 0.2 * Math.cos(0.35),
          ),
          1,
        );
        return;
      case MOUND_KIND.MUSHROOM: {
        hill(0.5, "#c08a55");
        put(stems, owner, placed(x, 0, z, yaw, r, r, r));
        put(caps, owner, placed(x, r * 0.9, z, yaw, r, r, r));
        put(gills, owner, placed(x, r * 0.9, z, yaw, r, r, r));
        for (let spot = 0; spot < SPOTS_PER_MUSHROOM; spot += 1) {
          const th = random() * Math.PI * 2;
          const ph = 0.15 + random() * 1.05;
          const normal = new Vector3(
            Math.sin(ph) * Math.cos(th),
            Math.cos(ph),
            Math.sin(ph) * Math.sin(th),
          );
          const radius = r * (0.08 + random() * 0.07);
          turn.setFromUnitVectors(UP, normal);
          put(
            spots,
            owner,
            matrix.compose(
              new Vector3(x + normal.x * r, r * 0.9 + normal.y * r * 0.55, z + normal.z * r),
              turn,
              size.set(radius, radius, radius),
            ),
          );
        }
        return;
      }
      case MOUND_KIND.TWIGS:
        hill(0.7, "#9a5f3a");
        for (let twig = 0; twig < TWIGS_PER_MOUND; twig += 1) {
          const th = (twig / TWIGS_PER_MOUND) * Math.PI * 2 + (random() - 0.5) * 0.4;
          const from = new Vector3(x + Math.cos(th) * r * 0.95, 0, z + Math.sin(th) * r * 0.95);
          const to = new Vector3(
            x + Math.cos(th + 2) * 0.35,
            r * 2.3 + random() * 0.8 - 0.3,
            z + Math.sin(th + 2) * 0.35,
          );
          rod(twigs, owner, from, to, 0.07 + random() * 0.06);
        }
        return;
      case MOUND_KIND.CAIRN:
        for (const [scale, lift, color] of CAIRN) {
          const s = r * scale * 2;
          put(stones, owner, placed(x, r * lift, z, random() * 6, s, s, s));
          stones.mesh.setColorAt(stones.owners.length - 1, new Color(color));
        }
        return;
    }
  };

  /** The merged rims, lips, tunnel tubes, and tunnel glows for `burrows`. */
  const sculpt = (burrows: Burrows) => {
    const rimParts: BufferGeometry[] = [];
    const lipParts: BufferGeometry[] = [];
    for (const chamber of burrows.chambers) {
      const outline = holeOutline(chamber, 120).map(
        (point) => new Vector3(chamber.cx + point.x, chamber.cy + point.y, 0.07),
      );
      const core = chamber.zone.layer === ZONE_LAYER.CORE;
      // Note that a core chamber's rim wraps its stone lip, or the lip would hide it.
      const ring = outline.map((point) => new Vector3(point.x, point.y, core ? 0.12 : 0.07));
      const rim = new TubeGeometry(
        new CatmullRomCurve3(ring, true),
        160,
        core ? 0.42 : 0.2,
        6,
        true,
      );
      rimParts.push(stamp(rim, "aZone", [chamber.index]));
      if (core) {
        const lip = new CatmullRomCurve3(
          outline.map((point) => new Vector3(point.x, point.y, 0.12)),
          true,
        );
        lipParts.push(new TubeGeometry(lip, 160, 0.34, 8, true));
      }
    }
    const shellParts: BufferGeometry[] = [];
    const glowParts: BufferGeometry[] = [];
    for (const tunnel of burrows.tunnels.slice(0, MAX_TUNNELS)) {
      const { first, last } = tunnel.open;
      if (last - first >= 2) {
        const curve = new CatmullRomCurve3(
          tunnel.center.slice(first, last + 1).map((point) => new Vector3(point.x, point.y, 0)),
        );
        shellParts.push(
          shadeTube(
            new TubeGeometry(
              curve,
              Math.max(8, (last - first) * 2),
              COLONY.TUNNEL_RADIUS,
              10,
              false,
            ),
          ),
        );
      }
      const glowLine = tunnel.line.points.map((point, index) =>
        point.clone().addScaledVector(tunnel.line.ups[index] ?? UP, 0.06),
      );
      const glow = new TubeGeometry(new CatmullRomCurve3(glowLine), 90, 0.11, 5, false);
      glowParts.push(
        stamp(stamp(glow, "aEnds", [tunnel.from.index, tunnel.to.index]), "aLength", [
          tunnel.length,
        ]),
      );
    }
    for (const bore of burrows.bores) {
      const line = new LineCurve3(
        new Vector3(bore.x, bore.bottom, 0),
        new Vector3(bore.x, bore.top, 0),
      );
      shellParts.push(shadeTube(new TubeGeometry(line, 8, COLONY.TUNNEL_RADIUS, 10, false)));
    }
    swap(rims, merged(rimParts, ["aZone"]));
    swap(lips, merged(lipParts, []));
    swap(tunnels, merged(shellParts, ["color"]));
    swap(glows, merged(glowParts, ["aEnds", "aLength"]));
  };

  return {
    pickable: [{ mesh: standIns, owners: standInOwners }, ...mounds],
    layout: (burrows) => {
      laid = burrows;
      const chambers = burrows.chambers.slice(0, MAX_ZONES);
      chambers.forEach((chamber, index) => {
        cavity.mesh.setMatrixAt(
          index,
          placed(chamber.cx, chamber.cy, 0, 0, chamber.rx, chamber.ry, chamber.rz),
        );
        cavity.blob.setXY(index, chamber.sa, chamber.sb);
        floors.setMatrixAt(
          index,
          placed(chamber.cx, chamber.floorY, 0, 0, chamber.fx, 1, chamber.fz),
        );
        standIns.setMatrixAt(
          index,
          placed(chamber.cx, chamber.cy, 0.2, 0, chamber.rx, chamber.ry, 1),
        );
      });
      standInOwners.splice(0, standInOwners.length, ...chambers.map((chamber) => chamber.index));
      for (const mesh of [cavity.mesh, floors, standIns]) {
        mesh.count = chambers.length;
        mesh.instanceMatrix.needsUpdate = true;
      }
      cavity.blob.needsUpdate = true;
      for (const mound of mounds) mound.owners.length = 0;
      for (const chamber of chambers)
        if (chamber.mound !== undefined) dress(chamber, chamber.mound);
      for (const mound of mounds) {
        mound.mesh.count = mound.owners.length;
        mound.mesh.instanceMatrix.needsUpdate = true;
        if (mound.mesh.instanceColor !== null) mound.mesh.instanceColor.needsUpdate = true;
      }
      sculpt(burrows);
    },
    light: (looks, count) => {
      for (let index = 0; index < Math.min(count, MAX_ZONES); index += 1) {
        const look = looks[index];
        if (look === undefined) continue;
        texels[index * 4] = look.rim.r;
        texels[index * 4 + 1] = look.rim.g;
        texels[index * 4 + 2] = look.rim.b;
        texels[index * 4 + 3] = look.strength;
        cavity.glow.setXYZ(index, look.glow.r, look.glow.g, look.glow.b);
      }
      for (const mound of mounds) {
        mound.owners.forEach((owner, index) => {
          const glow = looks[owner]?.glow;
          mound.glow.setXYZ(index, glow?.r ?? 0, glow?.g ?? 0, glow?.b ?? 0);
        });
        mound.glow.needsUpdate = true;
      }
      cavity.glow.needsUpdate = true;
      zones.needsUpdate = true;
    },
    blast: (distances, since, colour) => {
      const count = laid?.chambers.length ?? 0;
      for (let index = 0; index < Math.min(count, MAX_ZONES); index += 1) {
        texels[(ZONE_TEXELS + index) * 4] = distances.get(index) ?? -1;
      }
      glowUniforms.uSince.value = since;
      glowUniforms.uColor.value.copy(colour).multiplyScalar(1.6);
      glowUniforms.uTrail.value = distances.size > 0 ? 0 : 0.05;
      zones.needsUpdate = true;
    },
  };
}
