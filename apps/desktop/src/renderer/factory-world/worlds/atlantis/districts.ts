import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { PICK_KIND, type PickTarget, type WorldPicking } from "@luke/panel/factory-world/world";
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  type InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  type Scene,
  TorusGeometry,
  Vector3,
} from "three";
import { CITY, type CityLayout, DISTRICT_KIND, type District, outwardOf } from "./city";
import {
  brainCoral,
  branchCoral,
  clamp,
  crystalGeometry,
  geodesicDome,
  instancedAttribute,
  latticeTower,
  merged,
  painted,
  reefRockGeometry,
  seabedHeightAt,
  seededRandom,
  tubeCoral,
} from "./geometry";
import { DOME_MODE, domeLookOf, domesOf } from "./glass";
import { type Sea, TAU } from "./sea";
import type { Billboards } from "./sprites";

/**
 * districts.ts -- the zones as Atlantis builds them: the great dome over the core's crystals, the domain's glass-domed towns, the surface's reefs and lighthouses, the tooling's rigs, and the ring of light round each that the blast radius, a selection, and a defect light up.
 *
 * Everything here is instanced at the snapshot's bound of zones, so the
 * whole city is a few dozen draws however large the repository. `build`
 * places it all whenever the zones change; `paint` relights it on every
 * state, which is where a zone's selection, its place in the blast radius,
 * how alive it is with shipped work, and the damage a defect does to it are
 * drawn. A zone is picked by an invisible cylinder over its district.
 */

const ZONES = FACTORY_WORLD_BOUNDS.MAX_ZONES;

/** The most crystals under the great dome: each core zone's own and up to six around it. */
const CRYSTALS = ZONES * 7;

/** The most buildings and corals in the whole city, of each shape. */
const BUILDINGS = 6000;
const CORALS = 6000;

/** The lighthouse and the rig as built, which each reef and rig scales to its own height. */
const REFERENCE = {
  LIGHTHOUSE_HEIGHT: 20,
  LIGHTHOUSE_RADIUS: 1.4,
  RIG_HEIGHT: 20,
  RIG_BASE: 8,
} as const;

/** The core's crystal colours, warm under the great dome, one to each zone by its path. */
const CRYSTAL_COLORS = ["#fff0c4", "#ffd894", "#ffbf75", "#ffc66b", "#ffdca0", "#ff9c5c"] as const;

/** The corals' colours, muted, so the shipped glow is what reads on them. */
const CORAL_COLORS = ["#7d6470", "#6b7570", "#857263", "#5f6b7d", "#776a82", "#6e7f73"] as const;

/** A footprint past which a reef's lighthouse turns a beam. */
const BEAM_FOOTPRINT = 0.45;

/** How a zone is lit on one state. */
export interface ZoneLight {
  /** How strongly `highlight` lights it. */
  lit: number;
  readonly highlight: Color;
  /** Its steps out in the blast radius, or -1. */
  steps: number;
  /** 1, or less where the developer's focus is elsewhere. */
  dim: number;
  /** How alive it is with shipped work, where shipped is shown. */
  alive: number;
  /** How hurt it is by defects, where defects are shown. */
  hurt: number;
}

/** The city's districts. */
export interface Districts {
  readonly build: (layout: CityLayout) => void;
  /** Relights every district as `lights` says, by its index. */
  readonly paint: (layout: CityLayout, lights: readonly ZoneLight[]) => void;
  /** Puts out every ring's burst of shipped green. */
  readonly quench: () => void;
  /** Lights a district's ring with a burst of shipped green, at `now`. */
  readonly flash: (district: District, now: number) => void;
  /** Draws the standing lights: crowns, lanterns, spire tips; blinking only while `moving`. */
  readonly glow: (
    glows: Billboards,
    elapsed: number,
    lights: readonly ZoneLight[],
    moving: boolean,
  ) => void;
}

const CRYSTAL_VERTEX = /* glsl */ `
attribute vec3 aHiColor; attribute vec2 aHi;
varying vec3 vW; varying float vY; varying float vDepth; varying vec3 vCol; varying vec3 vHiColor; varying vec2 vHi;
void main(){
  vY = position.y; vCol = instanceColor; vHiColor = aHiColor; vHi = aHi;
  vec4 w = modelMatrix*instanceMatrix*vec4(position,1.0); vW = w.xyz;
  vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const CRYSTAL_FRAGMENT = /* glsl */ `
varying vec3 vW; varying float vY; varying float vDepth; varying vec3 vCol; varying vec3 vHiColor; varying vec2 vHi;
void main(){
  vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - abs(dot(N,V)), 2.5);
  float h = clamp(vY, 0.0, 1.0);
  float flow = 0.5 + 0.5*sin(vW.y*1.3 - uTime*2.4);
  float hi = vHi.x + ripple(vHi.y)*0.6;
  vec3 c = vCol*(0.3 + 1.2*pow(h,1.4))*(0.7+0.45*flow);
  c += vCol*fres*1.2 + vec3(1.0)*pow(fres,6.0)*0.6;
  c = mix(c, vHiColor*(0.6 + 1.4*pow(h,1.2) + fres*1.2), clamp(hi, 0.0, 1.0)*0.75);
  float l = max(dot(N, normalize(vec3(0.3,1.0,0.2))), 0.0);
  c *= 0.8 + 0.35*l;
  gl_FragColor = vec4(mix(c, uFogColor, fogF(vDepth)), 1.0);
}`;

const BAND_VERTEX = /* glsl */ `
attribute vec4 aBand; attribute vec3 aHiColor; attribute vec4 aZone;
varying vec2 vUv; varying float vDepth; varying vec4 vBand; varying vec3 vHiColor; varying vec4 vZone;
void main(){
  vec2 d = normalize(position.xz);
  float r = mix(aBand.x, aBand.y, uv.y);
  vec4 w = modelMatrix*instanceMatrix*vec4(d.x*r, 0.0, d.y*r, 1.0);
  vUv = vec2(fract(atan(d.y, d.x)/6.28318 + 1.0), uv.y);
  vBand = aBand; vHiColor = aHiColor; vZone = aZone;
  vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const BAND_FRAGMENT = /* glsl */ `
uniform vec3 uShipped; uniform vec3 uDefect;
varying vec2 vUv; varying float vDepth; varying vec4 vBand; varying vec3 vHiColor; varying vec4 vZone;
void main(){
  float band = exp(-pow((vUv.y-0.5)*5.5, 2.0));
  float tick = 0.75 + 0.25*step(0.5, fract(vUv.x*48.0));
  float dim = vZone.z;
  float hi = vBand.z + ripple(vBand.w)*0.8;
  vec3 c = vec3(0.3,0.9,1.0)*0.35*band*tick*dim;
  c += vHiColor*hi*(band*0.8 + 0.08);
  float flick = mix(1.0, step(0.82, fract(sin(floor(uTime*9.0)*12.9898)*43758.5453)), uMotion);
  c += uDefect*1.6*vZone.x*band*(0.35 + 0.65*flick);
  c += uShipped*1.4*vZone.y*band*0.6;
  float flash = clamp(1.0 - (uTime - vZone.w)*0.8, 0.0, 1.0);
  c += uShipped*2.0*flash*band*1.5;
  gl_FragColor = vec4(c*(1.0-fogF(vDepth)), 1.0);
}`;

const HOOP_VERTEX = /* glsl */ `
attribute float aR;
varying float vDepth;
void main(){
  vec3 p = position; vec2 d = normalize(p.xz); float off = length(p.xz) - 1.0;
  p.xz = d*(aR + off);
  vec4 mv = viewMatrix*modelMatrix*instanceMatrix*vec4(p,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const HOOP_FRAGMENT = /* glsl */ `
uniform vec3 uColor; varying float vDepth;
void main(){ gl_FragColor = vec4(mix(uColor, uFogColor, fogF(vDepth)), 1.0); }`;

const BEAM_VERTEX = /* glsl */ `
attribute vec2 aSpin;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying float vY;
void main(){
  float a = aSpin.x + uTime*aSpin.y; float c = cos(a), s = sin(a);
  vec3 p = vec3(c*position.x - s*position.z, position.y, s*position.x + c*position.z);
  vec3 n = vec3(c*normal.x - s*normal.z, normal.y, s*normal.x + c*normal.z);
  vec4 w = modelMatrix*instanceMatrix*vec4(p,1.0);
  vUv = uv; vY = w.y; vN = normalize(mat3(modelMatrix*instanceMatrix)*n); vV = cameraPosition - w.xyz;
  vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const BEAM_FRAGMENT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying float vY;
void main(){
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
  float a = pow(vUv.y, 2.2) * core * 0.38 * smoothstep(0.0, 5.0, vY) * smoothstep(8.0, 45.0, vDepth);
  gl_FragColor = vec4(vec3(0.75,0.97,1.0)*a*(1.0-fogF(vDepth)*0.7), 1.0);
}`;

const FLOOR_VERTEX = /* glsl */ `
varying vec3 vW; varying float vDepth;
void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`;

const FLOOR_FRAGMENT = /* glsl */ `
varying vec3 vW; varying float vDepth;
void main(){
  vec2 p = vW.xz*0.16; vec2 ip = floor(p), fp = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){ vec2 gg = vec2(float(i),float(j)); vec2 o = hash22(ip+gg); o = 0.5+0.4*sin(uTime*0.25+6.28*o); vec2 r = gg+o-fp; float d = dot(r,r); if (d<d1){ d2=d1; d1=d; } else if (d<d2) d2=d; }
  float edge = sqrt(d2)-sqrt(d1);
  float seam = 1.0 - smoothstep(0.0, 0.07, edge);
  float r = length(vW.xz);
  float heat = 0.55 + 0.45*sin(uTime*1.2 - r*0.25 + fbm2(vW.xz*0.05)*6.0);
  vec3 basalt = vec3(0.045,0.05,0.06)*(0.7+0.6*fbm2(vW.xz*0.3));
  basalt += vec3(0.5,0.9,1.0)*caustic(vW, uTime*0.5)*0.08;
  vec3 lava = mix(vec3(1.0,0.28,0.05), vec3(1.0,0.72,0.3), heat)*3.0;
  float ringGlow = exp(-pow((r-21.0)/0.5, 2.0))*0.8;
  vec3 c = basalt + lava*seam*heat*(0.25 + 0.75*smoothstep(42.0, 4.0, r)) + vec3(1.0,0.7,0.35)*ringGlow;
  gl_FragColor = vec4(mix(c, uFogColor, fogF(vDepth)), 1.0);
}`;

/** One building: where it stands, its footprint, height and turn, and the district it belongs to. */
interface Building {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly yaw: number;
  readonly district: number;
}

/** One coral: where it grows, how big, its turn and colour, and its district. */
interface Coral {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly size: number;
  readonly yaw: number;
  readonly color: string;
  readonly district: number;
}

/** One shape of building or coral: its mesh, its glow, what of it stands, and how large it is drawn. */
interface Placing<Item> {
  readonly glow: InstancedBufferAttribute;
  readonly mesh: InstancedMesh;
  placed: Item[];
  scale: number;
}

/** A lighthouse at the reference height: a tapering tower of stone and metal storeys banded with light, a gallery, a lantern, and a cap. */
function lighthouseGeometry(): BufferGeometry {
  const height = REFERENCE.LIGHTHOUSE_HEIGHT;
  const radius = REFERENCE.LIGHTHOUSE_RADIUS;
  const stone = new Color("#9fb0aa");
  const metal = new Color("#2c3d44");
  const band = new Color("#7fe6f5").multiplyScalar(1.5);
  const parts: BufferGeometry[] = [];
  const storeys = 5;
  for (let storey = 0; storey < storeys; storey += 1) {
    const y0 = (storey / storeys) * height;
    const tall = height / storeys;
    const bottom = radius * (1 - 0.38 * (storey / storeys));
    const top = radius * (1 - 0.38 * ((storey + 1) / storeys));
    parts.push(
      painted(
        new CylinderGeometry(top, bottom, tall, 20).translate(0, y0 + tall / 2, 0),
        storey % 2 === 1 ? metal : stone,
      ),
    );
    parts.push(
      painted(
        new TorusGeometry(top * 1.02, 0.09, 4, 32).rotateX(Math.PI / 2).translate(0, y0 + tall, 0),
        band,
        1,
      ),
    );
  }
  parts.push(
    painted(
      new CylinderGeometry(radius * 0.95, radius * 0.75, 0.5, 20).translate(0, height + 0.25, 0),
      metal,
    ),
  );
  parts.push(
    painted(
      new CylinderGeometry(radius * 0.45, radius * 0.5, 1.8, 16).translate(0, height + 1.4, 0),
      new Color("#e6fdff"),
      2.2,
    ),
  );
  parts.push(painted(new ConeGeometry(radius * 0.7, 1.4, 16).translate(0, height + 3, 0), metal));
  return merged(parts, ["position", "normal", "color", "aLit"]);
}

/** A rig's deck and its pipes at the reference radius. */
function rigBaseGeometry(): BufferGeometry {
  const r = REFERENCE.RIG_BASE;
  const metal = new Color("#2c3d44");
  const parts = [
    painted(new CylinderGeometry(r * 0.8, r * 0.85, 0.6, 24).translate(0, 0.3, 0), metal),
  ];
  for (let pipe = 0; pipe < 3; pipe += 1) {
    parts.push(
      painted(
        new CylinderGeometry(0.35, 0.35, r * 1.4, 10)
          .rotateZ(Math.PI / 2)
          .rotateY(pipe * 1.1)
          .translate(0, 0.9 + pipe * 0.7, 0),
        new Color("#3a4c52"),
      ),
    );
  }
  return merged(parts, ["position", "normal", "color", "aLit"]);
}

/** Up to `count` buildings in a disc of `reach` about `district`'s centre, as tall as `tallest` at its middle, standing at `base`. */
function townOf(
  district: District,
  count: number,
  reach: number,
  tallest: number,
  base: number,
  random: () => number,
): Building[] {
  const placed: Building[] = [];
  for (let tries = 0; tries < count * 12 && placed.length < count; tries += 1) {
    const turn = random() * TAU;
    const out = Math.sqrt(random()) * reach;
    const x = district.centre.x + Math.cos(turn) * out;
    const z = district.centre.z + Math.sin(turn) * out;
    const width = (0.9 + random() * 1.5) * clamp(reach / 9, 0.7, 1.7);
    if (
      placed.some((other) => Math.hypot(other.x - x, other.z - z) < (other.width + width) * 0.62)
    ) {
      continue;
    }
    const profile = Math.sqrt(Math.max(0, 1 - (out / (reach * 1.18)) ** 2));
    placed.push({
      x,
      z,
      y: base,
      width,
      depth: width * (0.7 + random() * 0.6),
      height: Math.max(1.6, tallest * profile * (0.45 + random() * 0.55)),
      yaw: random() * TAU,
      district: district.index,
    });
  }
  return placed;
}

/** `count` corals in a ring from `inner` to `outer` about `district`'s centre, at `y`, or on the floor where `y` is undefined. */
function reefOf(
  district: District,
  count: number,
  inner: number,
  outer: number,
  y: number | undefined,
  sizes: readonly [number, number],
  random: () => number,
): Coral[] {
  return Array.from({ length: count }, () => {
    const turn = random() * TAU;
    const out = inner + (outer - inner) * random();
    const x = district.centre.x + Math.cos(turn) * out;
    const z = district.centre.z + Math.sin(turn) * out;
    return {
      x,
      z,
      y: y ?? seabedHeightAt(x, z) - 0.2,
      size: sizes[0] + (sizes[1] - sizes[0]) * random(),
      yaw: random() * TAU,
      color: CORAL_COLORS[Math.floor(random() * CORAL_COLORS.length)] ?? CORAL_COLORS[0],
      district: district.index,
    };
  });
}

/** The lighthouse's footing on a reef: off-centre on a large one, so the town has room. */
function lighthouseFootOf(district: District): Vector3 {
  const off = district.radius > 9 ? district.radius * 0.18 : 0;
  return outwardOf(district).multiplyScalar(off).add(district.centre);
}

/** What stands on one district: its buildings and its corals. */
interface Settlement {
  readonly buildings: Building[];
  readonly corals: Coral[];
}

/** The buildings and corals of one district. */
function settlementOf(district: District): Settlement {
  const random = seededRandom(Math.floor(district.seed * 1e6));
  const r = district.radius;
  const fill = district.zone.footprint ** 2;
  switch (district.kind) {
    case DISTRICT_KIND.CRYSTAL:
      return { buildings: [], corals: [] };
    case DISTRICT_KIND.DOME:
      return {
        buildings: townOf(
          district,
          Math.round(clamp(46 * fill, 7, 46)),
          r * 0.74,
          r * 0.72,
          district.base,
          random,
        ),
        corals: reefOf(
          district,
          6 + Math.round(r * 0.8),
          r + 3,
          r + 7,
          undefined,
          [0.6, 1.4],
          random,
        ),
      };
    case DISTRICT_KIND.REEF: {
      const foot = lighthouseFootOf(district);
      const clear = REFERENCE.LIGHTHOUSE_RADIUS * (district.height / REFERENCE.LIGHTHOUSE_HEIGHT);
      const buildings = townOf(
        district,
        Math.round(clamp(34 * fill, 4, 34)),
        r * 0.78,
        3 + r * 0.5,
        district.base,
        random,
      ).filter(
        (building) =>
          Math.hypot(building.x - foot.x, building.z - foot.z) >= clear + building.width,
      );
      return { buildings, corals: coralsOnRock(district, random) };
    }
    case DISTRICT_KIND.RIG:
      return { buildings: [], corals: coralsOnRock(district, random) };
  }
}

function coralsOnRock(district: District, random: () => number): Coral[] {
  const r = district.radius;
  return [
    ...reefOf(
      district,
      12 + Math.round(r * 2.2),
      r * 0.55,
      r * 0.95,
      district.base - 0.25,
      [0.6, 1.3 + r * 0.03],
      random,
    ),
    ...reefOf(
      district,
      10 + Math.round(r * 1.8),
      r * 1.2,
      r * 1.2 + 5,
      undefined,
      [0.8, 1.8 + r * 0.04],
      random,
    ),
  ];
}

/** The standing light over one district: where, how wide, its colour, and how it flickers or blinks. */
interface Lamp {
  readonly district: number;
  readonly at: Vector3;
  readonly size: number;
  readonly color: Color;
  readonly flicker: number;
  readonly blinks: boolean;
  readonly seed: number;
}

/** The light over `district`: a crystal's crown, a dome's spire tip, a lighthouse's lantern, a rig's warning lamp. */
function lampOf(district: District): Lamp {
  const seed = district.seed * 50;
  const lamp = { district: district.index, seed, blinks: false };
  switch (district.kind) {
    case DISTRICT_KIND.CRYSTAL: {
      const tone =
        CRYSTAL_COLORS[Math.floor(district.seed * CRYSTAL_COLORS.length)] ?? CRYSTAL_COLORS[0];
      return {
        ...lamp,
        at: district.centre.clone().setY(district.base + district.height + 0.6),
        size: 3 + district.radius * 1.5,
        color: new Color(tone).multiplyScalar(1.4),
        flicker: 0.2,
      };
    }
    case DISTRICT_KIND.DOME:
      return {
        ...lamp,
        at: district.centre.clone().setY(district.base + district.radius * 0.82 + 0.4),
        size: 2.6,
        color: new Color("#9ff6ff").multiplyScalar(1.6),
        flicker: 0.15,
      };
    case DISTRICT_KIND.REEF: {
      const scale = district.height / REFERENCE.LIGHTHOUSE_HEIGHT;
      return {
        ...lamp,
        at: lighthouseFootOf(district).setY(
          district.base + (REFERENCE.LIGHTHOUSE_HEIGHT + 1.4) * scale,
        ),
        size: (6 + REFERENCE.LIGHTHOUSE_RADIUS * 2) * scale,
        color: new Color("#c9fbff").multiplyScalar(1.5),
        flicker: 0.1,
      };
    }
    case DISTRICT_KIND.RIG:
      return {
        ...lamp,
        at: district.centre.clone().setY(district.base + district.height + 0.4),
        size: 3,
        color: new Color("#ff3b2f").multiplyScalar(2),
        flicker: 0,
        blinks: true,
        seed: district.seed,
      };
  }
}

/** The city's districts in `scene`, picked through `picking`. */
export function districtsOf(scene: Scene, sea: Sea, picking: WorldPicking): Districts {
  const metal = sea.standard(
    { color: "#2c3d44", roughness: 0.55, metalness: 0.6 },
    { caustic: 0.9 },
  );
  const stone = sea.standard(
    { color: "#9fb0aa", roughness: 0.8, metalness: 0.05 },
    { caustic: 1.1 },
  );
  const rock = sea.standard(
    { color: "#4f5753", roughness: 0.95, flatShading: true },
    { caustic: 1.3 },
  );
  const paintedMetal = sea.standard(
    { vertexColors: true, roughness: 0.6, metalness: 0.4 },
    { caustic: 0.8, lit: true },
  );
  const lights = new MeshBasicMaterial({ vertexColors: true });

  const instanced = (
    geometry: BufferGeometry,
    material: Material,
    capacity: number,
    shadows: boolean,
  ) => {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    scene.add(mesh);
    return mesh;
  };

  // The great dome over the core: its plinth and steps, its rings of light, its geothermal floor, and its glass.
  const great = CITY.DOME_RADIUS;
  const floorY = CITY.DOME_FLOOR;
  const plinth = new Mesh(new CylinderGeometry(great + 2.6, great + 5.5, 3.2, 128, 1), metal);
  plinth.position.y = floorY - 1.6;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  const step = new Mesh(new CylinderGeometry(great + 6.5, great + 8.5, 1.2, 128, 1), stone);
  step.position.y = -0.2;
  step.receiveShadow = true;
  const cyan = new Color("#7fe6f5").multiplyScalar(1.5);
  const rings = new Mesh(
    merged(
      [
        painted(
          new TorusGeometry(great + 0.4, 0.32, 8, 192)
            .rotateX(Math.PI / 2)
            .translate(0, floorY + 0.2, 0),
          cyan,
        ),
        painted(
          new TorusGeometry(great + 5.6, 0.18, 6, 192).rotateX(Math.PI / 2).translate(0, 0.5, 0),
          new Color("#ffb860").multiplyScalar(2.4),
        ),
        painted(
          new TorusGeometry(3.2, 0.3, 8, 48)
            .rotateX(Math.PI / 2)
            .translate(0, floorY + great - 0.2, 0),
          cyan,
        ),
      ],
      ["position", "normal", "color"],
    ),
    lights,
  );
  const floor = new Mesh(
    new CircleGeometry(great + 0.5, 128).rotateX(-Math.PI / 2),
    sea.shader({}, FLOOR_VERTEX, FLOOR_FRAGMENT),
  );
  floor.position.y = floorY + 0.02;
  scene.add(plinth, step, rings, floor);
  const greatDome = domesOf(sea, geodesicDome(7), 1, {
    opacity: 0.045,
    strutWidth: 0.01,
    strut: "#86f0ff",
    strutGain: 0.7,
  });
  scene.add(greatDome.mesh);

  // The districts' own parts, each one instanced mesh at the bound of zones.
  const crystalShape = crystalGeometry();
  const crystalHi = instancedAttribute(crystalShape, "aHi", 2, CRYSTALS);
  const crystalHiColor = instancedAttribute(crystalShape, "aHiColor", 3, CRYSTALS);
  const crystals = instanced(
    crystalShape,
    sea.shader({}, CRYSTAL_VERTEX, CRYSTAL_FRAGMENT),
    CRYSTALS,
    true,
  );
  crystals.setColorAt(0, new Color());
  const plinths = instanced(new CylinderGeometry(1, 1.13, 2.6, 48, 1), metal, ZONES, true);
  const hoopShape = new TorusGeometry(1, 0.16, 6, 96).rotateX(Math.PI / 2);
  const hoopRadius = instancedAttribute(hoopShape, "aR", 1, ZONES);
  const hoops = instanced(
    hoopShape,
    sea.shader({ uColor: { value: cyan.clone() } }, HOOP_VERTEX, HOOP_FRAGMENT),
    ZONES,
    false,
  );
  const domes = domesOf(sea, geodesicDome(4), ZONES, {
    opacity: 0.05,
    strutWidth: 0.012,
    strut: "#86f0ff",
    strutGain: 0.55,
  });
  scene.add(domes.mesh);
  const spires = instanced(
    new CylinderGeometry(0.33, 1, 1, 8).translate(0, 0.5, 0),
    stone,
    ZONES,
    false,
  );
  const rocks = instanced(reefRockGeometry(3.7), rock, ZONES, true);
  const lighthouses = instanced(lighthouseGeometry(), paintedMetal, ZONES, true);
  const beamShape = new ConeGeometry(8.4, 78.4, 32, 1, true)
    .translate(0, -39.2, 0)
    .rotateZ(Math.PI / 2);
  const beamSpin = instancedAttribute(beamShape, "aSpin", 2, ZONES);
  const beams = instanced(
    beamShape,
    sea.shader({}, BEAM_VERTEX, BEAM_FRAGMENT, {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    }),
    ZONES,
    false,
  );
  beams.renderOrder = 6;
  const rigs = instanced(
    latticeTower(1.8, REFERENCE.RIG_HEIGHT, 1.6, true),
    sea.standard({ color: "#d98b2b", roughness: 0.5, metalness: 0.5 }, { caustic: 0.6 }),
    ZONES,
    true,
  );
  const rigBases = instanced(rigBaseGeometry(), paintedMetal, ZONES, false);
  const bandShape = new RingGeometry(1, 2, 96, 1).rotateX(-Math.PI / 2);
  const band = instancedAttribute(bandShape, "aBand", 4, ZONES);
  const bandHiColor = instancedAttribute(bandShape, "aHiColor", 3, ZONES);
  const bandZone = instancedAttribute(bandShape, "aZone", 4, ZONES);
  const bands = instanced(
    bandShape,
    sea.shader({}, BAND_VERTEX, BAND_FRAGMENT, {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
    ZONES,
    false,
  );
  bands.renderOrder = 2;

  const buildingMaterial = sea.standard(
    { color: "#ffffff", roughness: 0.6, metalness: 0.25 },
    { caustic: 0.7, glow: true, windows: true },
  );
  const buildingShapes = [
    new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new CylinderGeometry(0.5, 0.56, 1, 8).translate(0, 0.5, 0),
  ];
  const towers = buildingShapes.map(
    (shape): Placing<Building> => ({
      glow: instancedAttribute(shape, "aGlow", 1, BUILDINGS),
      mesh: instanced(shape, buildingMaterial, BUILDINGS, true),
      placed: [],
      scale: 1,
    }),
  );
  const coralMaterial = sea.standard(
    { vertexColors: true, roughness: 0.75, side: DoubleSide },
    { caustic: 1, glow: true, shipGlow: true },
  );
  const reefs = [branchCoral(), brainCoral(), tubeCoral()].map(
    (shape): Placing<Coral> => ({
      glow: instancedAttribute(shape, "aGlow", 1, CORALS),
      mesh: instanced(shape, coralMaterial, CORALS, false),
      placed: [],
      scale: 1.5,
    }),
  );
  const brain = reefs[1];
  if (brain !== undefined) brain.scale = 0.8;

  const proxies = instanced(
    new CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0),
    new MeshBasicMaterial({ visible: false }),
    ZONES,
    false,
  );
  let zoneTargets: PickTarget[] = [];
  picking.addInstances(proxies, (instanceId) => zoneTargets[instanceId]);

  const matrix = new Matrix4();
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const at = new Vector3();
  const size = new Vector3();
  const tint = new Color();
  const look = domeLookOf();
  /** Each crystal's district, and the share of the cluster's light it shines with. */
  let crystalOwners: number[] = [];
  /** What each district's index draws in each per-kind mesh, for `paint`. */
  let domeSlots: number[] = [];
  let bandSlots: number[] = [];
  let lamps: Lamp[] = [];

  const finishAll = (mesh: InstancedMesh, count: number) => {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  };

  const build = (layout: CityLayout) => {
    const districts = layout.districts;
    lamps = districts.map(lampOf);
    zoneTargets = districts.map((district) => ({ kind: PICK_KIND.ZONE, id: district.zone.path }));
    districts.forEach((district, index) => {
      matrix.compose(
        at.copy(district.centre),
        turn.identity(),
        size.set(district.hit.radius, district.hit.height, district.hit.radius),
      );
      proxies.setMatrixAt(index, matrix);
    });
    finishAll(proxies, districts.length);

    // The core's crystals: each zone's own, and a ring of smaller ones leaning out round it.
    crystalOwners = [];
    let crystal = 0;
    for (const district of districts) {
      if (district.kind !== DISTRICT_KIND.CRYSTAL) continue;
      const random = seededRandom(Math.floor(district.seed * 1e6));
      const color = tint.set(
        CRYSTAL_COLORS[Math.floor(district.seed * CRYSTAL_COLORS.length)] ?? CRYSTAL_COLORS[0],
      );
      const r = district.radius;
      const place = (
        x: number,
        y: number,
        z: number,
        rotation: Quaternion,
        radius: number,
        height: number,
      ) => {
        if (crystal >= CRYSTALS) return;
        matrix.compose(at.set(x, y, z), rotation, size.set(radius, height, radius));
        crystals.setMatrixAt(crystal, matrix);
        crystals.setColorAt(crystal, color);
        crystalOwners.push(district.index);
        crystal += 1;
      };
      place(
        district.centre.x,
        district.base,
        district.centre.z,
        turn.identity(),
        r,
        district.height,
      );
      const kids = Math.min(6, 5 + Math.floor(r));
      for (let kid = 0; kid < kids; kid += 1) {
        const angle = (kid / kids) * TAU + random() * 0.5;
        const lean = new Quaternion().setFromAxisAngle(
          new Vector3(Math.sin(angle), 0, -Math.cos(angle)),
          -0.35,
        );
        lean.multiply(new Quaternion().setFromAxisAngle(up, random() * 3));
        place(
          district.centre.x + Math.cos(angle) * r * 1.25,
          district.base - 0.3,
          district.centre.z + Math.sin(angle) * r * 1.25,
          lean,
          r * (0.3 + random() * 0.35),
          district.height * (0.2 + random() * 0.4),
        );
      }
    }
    finishAll(crystals, crystal);

    // The domain's towns: plinth, ring of light, glass, spire.
    domeSlots = districts.map(() => -1);
    let dome = 0;
    for (const district of districts) {
      if (district.kind !== DISTRICT_KIND.DOME) continue;
      const r = district.radius;
      matrix.compose(
        at.set(district.centre.x, 0.3, district.centre.z),
        turn.identity(),
        size.set(r + 1.2, 1, r + 1.2),
      );
      plinths.setMatrixAt(dome, matrix);
      matrix.makeTranslation(district.centre.x, 1.65, district.centre.z);
      hoops.setMatrixAt(dome, matrix);
      hoopRadius.setX(dome, r + 0.55);
      matrix.compose(
        at.set(district.centre.x, district.base, district.centre.z),
        turn.identity(),
        size.setScalar(r),
      );
      domeSlots[district.index] = dome;
      look.color.set("#5cd8ff");
      domes.place(dome, matrix, look);
      matrix.compose(at, turn.identity(), size.set(0.55, r * 0.82, 0.55));
      spires.setMatrixAt(dome, matrix);
      dome += 1;
    }
    finishAll(plinths, dome);
    finishAll(hoops, dome);
    hoopRadius.needsUpdate = true;
    finishAll(spires, dome);
    domes.finish(dome);

    // The surface's reefs and the tooling's rigs, each on its rock.
    let reef = 0;
    let lighthouse = 0;
    let beam = 0;
    let rig = 0;
    for (const district of districts) {
      if (district.kind !== DISTRICT_KIND.REEF && district.kind !== DISTRICT_KIND.RIG) continue;
      const r = district.radius;
      matrix.compose(
        at.copy(district.centre),
        turn.setFromAxisAngle(up, district.seed * TAU),
        size.set(r, district.base, r),
      );
      rocks.setMatrixAt(reef, matrix);
      reef += 1;
      if (district.kind === DISTRICT_KIND.REEF) {
        const scale = district.height / REFERENCE.LIGHTHOUSE_HEIGHT;
        const foot = lighthouseFootOf(district).setY(district.base);
        matrix.compose(foot, turn.identity(), size.setScalar(scale));
        lighthouses.setMatrixAt(lighthouse, matrix);
        lighthouse += 1;
        if (district.zone.footprint < BEAM_FOOTPRINT) continue;
        matrix.compose(
          at.set(foot.x, district.base + (REFERENCE.LIGHTHOUSE_HEIGHT + 1.4) * scale, foot.z),
          turn.setFromAxisAngle(new Vector3(0, 0, 1), -0.05),
          size.setScalar(scale),
        );
        beams.setMatrixAt(beam, matrix);
        beamSpin.setXY(beam, district.seed * TAU * 3, 0.22 + district.seed * 0.15);
        beam += 1;
        continue;
      }
      const scale = district.height / REFERENCE.RIG_HEIGHT;
      matrix.compose(
        at.set(district.centre.x, district.base, district.centre.z),
        turn.identity(),
        size.setScalar(scale),
      );
      rigs.setMatrixAt(rig, matrix);
      matrix.compose(at, turn.identity(), size.setScalar(r / REFERENCE.RIG_BASE));
      rigBases.setMatrixAt(rig, matrix);
      rig += 1;
    }
    finishAll(rocks, reef);
    finishAll(lighthouses, lighthouse);
    finishAll(beams, beam);
    beamSpin.needsUpdate = true;
    finishAll(rigs, rig);
    finishAll(rigBases, rig);

    // The ring of light round every district.
    bandSlots = districts.map((_, index) => index);
    districts.forEach((district, index) => {
      const r = district.radius;
      const [inner, outer, y] =
        district.kind === DISTRICT_KIND.CRYSTAL
          ? [r * 2.1, r * 2.6, CITY.DOME_FLOOR + 0.08]
          : district.kind === DISTRICT_KIND.DOME
            ? [r + 2.8, r + 4.2, 0.35]
            : [r * 1.25 + 2.5, r * 1.25 + 4, 0.4];
      matrix.makeTranslation(district.centre.x, y, district.centre.z);
      bands.setMatrixAt(index, matrix);
      band.setXYZW(index, inner, outer, 0, -1);
      bandZone.setXYZW(index, 0, 0, 1, -1e6);
    });
    finishAll(bands, districts.length);
    band.needsUpdate = true;
    bandZone.needsUpdate = true;

    // The towns' buildings and the reefs' corals, seeded by each district's path.
    const settlements = districts.map(settlementOf);
    const buildings = settlements.flatMap((settlement) => settlement.buildings);
    towers.forEach((tower, shape) => {
      tower.placed = buildings.filter((_, index) => index % 2 === shape).slice(0, BUILDINGS);
      tower.placed.forEach((building, index) => {
        matrix.compose(
          at.set(building.x, building.y, building.z),
          turn.setFromAxisAngle(up, building.yaw),
          size.set(building.width, building.height, building.depth),
        );
        tower.mesh.setMatrixAt(index, matrix);
        const random = seededRandom(index * 31 + shape);
        tower.mesh.setColorAt(
          index,
          tint.setHSL(0.48 + random() * 0.08, 0.05 + random() * 0.15, 0.55 + random() * 0.3),
        );
      });
      finishAll(tower.mesh, tower.placed.length);
    });
    const corals = settlements.flatMap((settlement) => settlement.corals);
    reefs.forEach((kind, shape) => {
      kind.placed = corals.filter((_, index) => index % 3 === shape).slice(0, CORALS);
      kind.placed.forEach((coral, index) => {
        matrix.compose(
          at.set(coral.x, coral.y, coral.z),
          turn.setFromAxisAngle(up, coral.yaw),
          size.setScalar(coral.size * kind.scale),
        );
        kind.mesh.setMatrixAt(index, matrix);
        kind.mesh.setColorAt(index, tint.set(coral.color));
      });
      finishAll(kind.mesh, kind.placed.length);
    });
  };

  const paint = (layout: CityLayout, zoneLights: readonly ZoneLight[]) => {
    const districts = layout.districts;
    crystalOwners.forEach((owner, index) => {
      const light = zoneLights[owner];
      if (light === undefined) return;
      crystalHi.setXY(index, light.lit * 0.6, light.steps);
      crystalHiColor.setXYZ(index, light.highlight.r, light.highlight.g, light.highlight.b);
    });
    crystalHi.needsUpdate = true;
    crystalHiColor.needsUpdate = true;

    for (const district of districts) {
      const light = zoneLights[district.index];
      if (light === undefined) continue;
      const slot = domeSlots[district.index] ?? -1;
      if (slot >= 0) {
        domes.mesh.getMatrixAt(slot, matrix);
        look.color.set("#5cd8ff");
        look.highlight.copy(light.highlight);
        look.lit = light.lit * 0.8;
        look.dim = light.dim;
        look.steps = light.steps;
        look.mode = DOME_MODE.BUILT;
        look.fill = 1;
        look.seed = district.seed;
        domes.place(slot, matrix, look);
      }
      const ring = bandSlots[district.index] ?? -1;
      if (ring < 0) continue;
      band.setZ(ring, light.lit);
      band.setW(ring, light.steps);
      bandHiColor.setXYZ(ring, light.highlight.r, light.highlight.g, light.highlight.b);
      bandZone.setX(ring, light.hurt);
      bandZone.setY(ring, light.alive);
      bandZone.setZ(ring, light.dim);
    }
    domes.finish(domes.mesh.count);
    band.needsUpdate = true;
    bandHiColor.needsUpdate = true;
    bandZone.needsUpdate = true;

    // Note that the great dome glows with its brightest crystal's highlight, and dims where the focus is out in the city.
    const cores = districts.filter((district) => district.kind === DISTRICT_KIND.CRYSTAL);
    const brightest = cores.reduce<ZoneLight | undefined>((best, district) => {
      const light = zoneLights[district.index];
      return light !== undefined && (best === undefined || light.lit > best.lit) ? light : best;
    }, undefined);
    look.color.set("#5cd8ff");
    look.highlight.copy(brightest?.highlight ?? tint.set("#ffffff"));
    look.lit = (brightest?.lit ?? 0) * 0.16;
    const focused = zoneLights.some((light) => light.dim < 1);
    const coreInFocus = cores.some((district) => (zoneLights[district.index]?.dim ?? 1) >= 1);
    look.dim = focused && !coreInFocus ? 0.45 : 1;
    look.steps = -1;
    look.mode = DOME_MODE.BUILT;
    look.fill = 1;
    look.seed = 0;
    matrix.compose(at.set(0, floorY, 0), turn.identity(), size.setScalar(great));
    greatDome.place(0, matrix, look);
    greatDome.finish(1);

    for (const tower of towers) {
      tower.placed.forEach((building, index) => {
        const light = zoneLights[building.district];
        tower.glow.setX(index, (light?.alive ?? 0) + (light?.lit ?? 0) * 0.5);
      });
      tower.glow.needsUpdate = true;
    }
    for (const kind of reefs) {
      kind.placed.forEach((coral, index) => {
        const alive = zoneLights[coral.district]?.alive ?? 0;
        kind.glow.setX(index, alive > 0.05 ? 0.15 + alive * 1.1 : 0);
      });
      kind.glow.needsUpdate = true;
    }
  };

  const crown = new Color("#9ff6ff").multiplyScalar(1.6);
  return {
    build,
    paint,
    quench: () => {
      for (let ring = 0; ring < bandZone.count; ring += 1) bandZone.setW(ring, -1e6);
      bandZone.needsUpdate = true;
    },
    flash: (district, now) => {
      const ring = bandSlots[district.index] ?? -1;
      if (ring < 0) return;
      bandZone.setW(ring, now);
      bandZone.needsUpdate = true;
    },
    glow: (glows, elapsed, zoneLights, moving) => {
      const flicker = (amount: number, seed: number) =>
        1 -
        amount * 0.5 +
        amount * 0.5 * Math.sin(elapsed * 7 + seed * 13) * Math.sin(elapsed * 3.1 + seed);
      const crownLight = flicker(0.1, 10);
      glows.push(
        0,
        floorY + great + 1.5,
        0,
        10,
        crown.r * crownLight,
        crown.g * crownLight,
        crown.b * crownLight,
        1,
      );
      for (const lamp of lamps) {
        const light = zoneLights[lamp.district];
        let k =
          (1 + (light?.lit ?? 0) * 0.8 + (light?.alive ?? 0) * 0.5) *
          flicker(lamp.flicker, lamp.seed);
        if (lamp.blinks && moving && Math.sin(elapsed * 2.4 + lamp.seed * TAU) <= 0.2) k = 0.08;
        glows.push(
          lamp.at.x,
          lamp.at.y,
          lamp.at.z,
          lamp.size,
          lamp.color.r * k,
          lamp.color.g * k,
          lamp.color.b * k,
          1,
        );
      }
    },
  };
}
