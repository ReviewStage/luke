import { FACTORY_WORLD_BOUNDS, type FactoryDefect } from "@luke/features/factory-world-wire";
import { PICK_KIND, type PickTarget, type WorldPicking } from "@luke/panel/factory-world/world";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Vector4,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  type CoreZone,
  type CrustZone,
  groundAt,
  MAX_SCORCHES,
  MAX_STRATA,
  PLANET_RADIUS,
  type PlanetLayout,
  type PlanetZone,
  sampleSite,
  ZONE_PLACE,
} from "./globe";
import {
  clamp,
  flush,
  GLSL_NOISE,
  GLSL_OUTPUT,
  HIDDEN,
  hash,
  mix,
  rng,
  rotateToward,
  type SharedUniforms,
  seedOf,
} from "./kit";
import type { Particles } from "./particles";

/**
 * defects.ts -- defects as damage to the planet: a storm over the zone for one that strikes often, a volcano for one that strikes now and then, a crater for a rare one, and the core cracked where one lands in it.
 *
 * A defect lands on the first crust zone it is placed on and scorches the
 * ground there; one placed in the core cracks that shell and vents embers
 * out of the cutaway, and still wounds the crust where it surfaces. A
 * defect placed on nothing the planet holds is a burning meteor circling
 * it. Smoke and embers rise from every wound, animated on the GPU, and
 * while motion runs, sparks fall to the wounds from the shipped ring, since
 * a defect is work that shipped and came back. Nothing fills the defects
 * yet (Sentry comes later), so all of this waits on data.
 */

const MAX = FACTORY_WORLD_BOUNDS.MAX_DEFECTS;

/** How many cloud layers one storm has. */
const STORM_LAYERS = 3;

/** The most smoke or ember specks the wounds share. */
const PLUME_MAX = 4000;

/** How a defect wounds the planet, by how often it strikes. */
const WOUND = {
  STORM: "storm",
  VOLCANO: "volcano",
  CRATER: "crater",
  /** A vent on the floor of the core shell it is placed in, where it is placed on no crust. */
  VENT: "vent",
  /** A burning rock in orbit, for one placed on nothing the planet holds. */
  METEOR: "meteor",
} as const;

type WoundKind = (typeof WOUND)[keyof typeof WOUND];

/** The events at or past which a defect is a storm, and a volcano. */
const STORM_EVENTS = 20;
const VOLCANO_EVENTS = 5;

/** One defect as drawn. */
interface Wound {
  readonly defect: FactoryDefect;
  readonly kind: WoundKind;
  readonly up: Vector3;
  readonly base: Vector3;
  readonly radius: number;
  readonly seed: number;
  /** When the next spark falls to it, in seconds of idle motion. */
  fallIn: number;
}

/** One column of smoke or embers. */
interface Plume {
  readonly at: Vector3;
  readonly up: Vector3;
  readonly height: number;
  readonly spread: number;
  readonly size: number;
  readonly speed: number;
  readonly count: number;
  readonly glow: readonly [number, number, number];
}

function kindOf(events: number): WoundKind {
  if (events >= STORM_EVENTS) return WOUND.STORM;
  if (events >= VOLCANO_EVENTS) return WOUND.VOLCANO;
  return WOUND.CRATER;
}

/** A material lit by its geometry's `aLava`, burning in the defect colour where it is one. */
function lavaMaterial(shared: SharedUniforms, colour: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: colour,
    roughness: 0.95,
    flatShading: true,
    emissive: 0x3a0800,
    emissiveIntensity: 0.6,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uDefect: shared.uDefect });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aLava; varying float vLava;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLava = aLava;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uDefect; varying float vLava;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uDefect * 3.2 * vLava;\ndiffuseColor.rgb *= 1.0 - vLava;",
      );
  };
  return material;
}

function withLava(geometry: BufferGeometry, lava: number): BufferGeometry {
  const plain = geometry.index === null ? geometry : geometry.toNonIndexed();
  plain.deleteAttribute("uv");
  plain.setAttribute(
    "aLava",
    new BufferAttribute(new Float32Array(plain.getAttribute("position").count).fill(lava), 1),
  );
  return plain;
}

/** A volcano a unit wide: a cone, its lava-filled mouth, and three flows down its side. */
function volcanoGeometry(): BufferGeometry {
  const height = 1.05;
  const profile = [
    [0.001, height * 0.72],
    [0.18, height * 0.74],
    [0.27, height],
    [0.5, height * 0.62],
    [0.78, height * 0.22],
    [1, 0],
    [1.05, -0.12],
  ].map(([x = 0, y = 0]) => new Vector2(x, y));
  const flows = [0, 1, 2].map((flow) => {
    const angle = hash(flow * 4.1) * Math.PI * 2;
    const points = [0, 0.33, 0.66, 1].map(
      (t) =>
        new Vector3(
          Math.cos(angle + t * 0.4) * mix(0.25, 0.95, t),
          mix(height * 0.95, 0.02, t),
          Math.sin(angle + t * 0.4) * mix(0.25, 0.95, t),
        ),
    );
    return withLava(new TubeGeometry(new CatmullRomCurve3(points), 12, 0.05, 4), 1);
  });
  return mergeGeometries([
    withLava(new LatheGeometry(profile, 18), 0),
    withLava(new CircleGeometry(0.2, 16).rotateX(-Math.PI / 2).translate(0, height * 0.76, 0), 1),
    ...flows,
  ]);
}

/** A crater a unit wide: its rim, its pit, and the ember at its floor. */
function craterGeometry(): BufferGeometry {
  return mergeGeometries([
    withLava(new TorusGeometry(1, 0.22, 8, 28).rotateX(Math.PI / 2).scale(1, 0.45, 1), 0),
    withLava(new CircleGeometry(0.95, 20).rotateX(-Math.PI / 2).translate(0, 0.01, 0), 0),
    withLava(new CircleGeometry(0.32, 14).rotateX(-Math.PI / 2).translate(0, 0.02, 0), 1),
  ]);
}

function stormMaterial(shared: SharedUniforms): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute float aLayer; attribute float aHeat; attribute float aSeed; attribute float aBend;
      varying vec2 vP; varying float vLayer; varying float vHeat; varying float vSeed;
      void main(){
        vP = position.xz; vLayer = aLayer; vHeat = aHeat; vSeed = aSeed;
        vec3 p = position; p.y -= dot(p.xz, p.xz) * aBend;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uDefect; uniform float uDefects;
      varying vec2 vP; varying float vLayer; varying float vHeat; varying float vSeed; ${GLSL_NOISE}
      void main(){
        float r = length(vP); if (r > 1.0) discard;
        float spin = 0.35 + vLayer * 0.18;
        float a = atan(vP.y, vP.x);
        float rot = uTime * spin / (r + 0.35);
        vec2 q = vec2(cos(a + rot), sin(a + rot)) * r;
        float n = fbm(vec3(q * 3.2, vSeed + vLayer * 3.0 + uTime * 0.05));
        float s = a + rot + log(r + 0.03) * 2.8;
        float arms = smoothstep(-0.1, 0.9, sin(s * 2.0 + n * 3.0));
        float dens = (arms * 0.65 + n * 0.75 - 0.25) * smoothstep(1.0, 0.55, r) * smoothstep(0.07, 0.2, r);
        dens += smoothstep(0.24, 0.13, r) * smoothstep(0.06, 0.13, r) * 0.9;
        dens = clamp(dens, 0.0, 1.0);
        float tick = floor(uTime * 6.0);
        float flash = step(0.9, hash3(vec3(tick, vSeed, vLayer))) * smoothstep(0.55, 0.0, length(q - vec2(hash3(vec3(tick, 1.0, vSeed)) - 0.5, hash3(vec3(tick, 2.0, vSeed)) - 0.5) * 1.2));
        vec3 dark = vec3(0.12, 0.012, 0.02), hot = uDefect * mix(1.6, 2.6, vHeat);
        vec3 c = mix(dark, hot, pow(dens, 1.5)) + vec3(3.0, 2.4, 2.6) * flash * dens;
        c += uDefect * 3.0 * smoothstep(0.12, 0.0, r) * vHeat;
        gl_FragColor = vec4(c, dens * (0.95 - vLayer * 0.2) * uDefects); ${GLSL_OUTPUT}
      }`,
  });
}

function plumeMaterial(shared: SharedUniforms, smoke: boolean): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: smoke ? NormalBlending : AdditiveBlending,
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute vec3 aUp; attribute vec4 aP; attribute vec3 aCol; attribute float aSeed;
      uniform float uTime; uniform float uPixelRatio; uniform float uDefects; varying vec3 vC; varying float vA;
      void main(){
        float life = fract(uTime * aP.w + aSeed);
        vec3 s1 = normalize(cross(aUp, vec3(0.31, 0.87, 0.22))); vec3 s2 = cross(aUp, s1);
        vec3 p = position + aUp * life * aP.x + (s1 * sin(aSeed * 40.0 + life * 3.0) + s2 * cos(aSeed * 23.0 + life * 2.0)) * aP.y * (0.2 + life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vC = aCol; vA = sin(life * 3.14159) * uDefects;
        gl_PointSize = aP.z * ${smoke ? "(0.5 + life * 1.8)" : "(1.0 - life * 0.7)"} * uPixelRatio * 260.0 / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA;
        ${smoke ? "gl_FragColor = vec4(vC, a * 0.55);" : "gl_FragColor = vec4(vC * a, 1.0);"} ${GLSL_OUTPUT} }`,
  });
}

/** One set of plume points, allocated at `PLUME_MAX` and filled from the wounds' columns. */
function plumePoints(shared: SharedUniforms, smoke: boolean) {
  const geometry = new BufferGeometry();
  const attributes = {
    position: new BufferAttribute(new Float32Array(PLUME_MAX * 3), 3),
    aUp: new BufferAttribute(new Float32Array(PLUME_MAX * 3), 3),
    aP: new BufferAttribute(new Float32Array(PLUME_MAX * 4), 4),
    aCol: new BufferAttribute(new Float32Array(PLUME_MAX * 3), 3),
    aSeed: new BufferAttribute(new Float32Array(PLUME_MAX), 1),
  };
  for (const [name, attribute] of Object.entries(attributes))
    geometry.setAttribute(name, attribute);
  const points = new Points(geometry, plumeMaterial(shared, smoke));
  points.frustumCulled = false;
  points.renderOrder = 7;
  const fill = (plumes: readonly Plume[]) => {
    let at = 0;
    for (const plume of plumes) {
      for (let speck = 0; speck < plume.count && at < PLUME_MAX; speck += 1, at += 1) {
        attributes.position.setXYZ(at, plume.at.x, plume.at.y, plume.at.z);
        attributes.aUp.setXYZ(at, plume.up.x, plume.up.y, plume.up.z);
        attributes.aP.setXYZW(at, plume.height, plume.spread, plume.size, plume.speed);
        attributes.aCol.setXYZ(at, ...plume.glow);
        attributes.aSeed.setX(at, hash(at * 1.37 + plume.at.x));
      }
    }
    geometry.setDrawRange(0, at);
    for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
  };
  return { points, fill };
}

function glowPoints(shared: SharedUniforms) {
  const geometry = new BufferGeometry();
  const positions = new BufferAttribute(new Float32Array(MAX * 3), 3);
  const sizes = new BufferAttribute(new Float32Array(MAX), 1);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("aSize", sizes);
  const points = new Points(
    geometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: shared,
      vertexShader: /* glsl */ `
        attribute float aSize; uniform float uProjection; uniform float uPixelRatio;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(aSize * uProjection / -mv.z, 512.0) * uPixelRatio; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uDefect; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 4.0) * smoothstep(1.0, 0.6, d);
          gl_FragColor = vec4(uDefect * 1.6 * a * 0.22, 1.0); ${GLSL_OUTPUT} }`,
    }),
  );
  points.frustumCulled = false;
  return { points, positions, sizes };
}

function instanced(
  geometry: BufferGeometry,
  material: Material,
  count: number,
  shadow = false,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = shadow;
  mesh.count = 0;
  return mesh;
}

export interface Defects {
  readonly group: Group;
  readonly show: (
    layout: PlanetLayout,
    defects: readonly FactoryDefect[],
    taken: Map<PlanetZone, Vector3[]>,
  ) => void;
  readonly choose: (chosen: (id: string) => boolean) => void;
  /** Moves the meteors to `t`; while `falling`, drops sparks on the wounds from `ringPoint`. */
  readonly step: (t: number, delta: number, falling: boolean) => void;
}

export interface DefectSeams {
  readonly scorches: { readonly value: Vector4[] };
  readonly scorchDepths: { readonly value: number[] };
  readonly cracks: { readonly value: number[] };
}

export function createDefects(
  shared: SharedUniforms,
  picking: WorldPicking,
  particles: Particles,
  seams: DefectSeams,
): Defects {
  const group = new Group();
  const storms = instanced(
    new CircleGeometry(1, 64).rotateX(-Math.PI / 2),
    stormMaterial(shared),
    MAX * STORM_LAYERS,
  );
  const stormAttributes = {
    aLayer: new InstancedBufferAttribute(new Float32Array(MAX * STORM_LAYERS), 1),
    aHeat: new InstancedBufferAttribute(new Float32Array(MAX * STORM_LAYERS), 1),
    aSeed: new InstancedBufferAttribute(new Float32Array(MAX * STORM_LAYERS), 1),
    aBend: new InstancedBufferAttribute(new Float32Array(MAX * STORM_LAYERS), 1),
  };
  for (const [name, attribute] of Object.entries(stormAttributes))
    storms.geometry.setAttribute(name, attribute);
  storms.renderOrder = 8;
  const volcanoes = instanced(volcanoGeometry(), lavaMaterial(shared, 0x2a211e), MAX, true);
  const craters = instanced(craterGeometry(), lavaMaterial(shared, 0x2b2522), MAX, true);
  const meteors = instanced(
    new IcosahedronGeometry(0.22, 1),
    new MeshStandardMaterial({
      color: 0x3a2a26,
      roughness: 1,
      flatShading: true,
      emissive: shared.uDefect.value,
      emissiveIntensity: 0.8,
    }),
    MAX,
    true,
  );
  const marks = instanced(
    new RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      color: shared.uChosen.value.clone().multiplyScalar(2.5),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
    MAX,
  );
  const proxies = instanced(
    new SphereGeometry(1, 8, 6),
    new MeshBasicMaterial({ visible: false }),
    MAX,
  );
  const smoke = plumePoints(shared, true);
  const embers = plumePoints(shared, false);
  const glows = glowPoints(shared);
  group.add(
    storms,
    volcanoes,
    craters,
    meteors,
    marks,
    proxies,
    smoke.points,
    embers.points,
    glows.points,
  );

  let wounds: Wound[] = [];
  let targets: PickTarget[] = [];
  let chosen: (id: string) => boolean = () => false;
  picking.addInstances(proxies, (instance) => targets[instance]);
  const placing = new Object3D();
  const UP = new Vector3(0, 1, 0);

  const stand = (mesh: InstancedMesh, at: number, wound: Wound, size: number, lift = 0) => {
    placing.position.copy(wound.base).addScaledVector(wound.up, lift);
    placing.quaternion.setFromUnitVectors(UP, wound.up);
    placing.scale.setScalar(size);
    placing.updateMatrix();
    mesh.setMatrixAt(at, placing.matrix);
  };

  const woundOf = (
    layout: PlanetLayout,
    defect: FactoryDefect,
    taken: Map<PlanetZone, Vector3[]>,
  ): Wound => {
    const draw = rng(seedOf(defect.id));
    const zones = defect.zonePaths.flatMap((path) => layout.byPath.get(path) ?? []);
    const crust = zones.find((zone): zone is CrustZone => zone.place === ZONE_PLACE.CRUST);
    const shell = zones.find((zone): zone is CoreZone => zone.place === ZONE_PLACE.CORE);
    const events = defect.events;
    if (crust === undefined && shell !== undefined) return ventOf(defect, shell, draw);
    if (crust === undefined) {
      const up = new Vector3(draw() - 0.5, draw() * 0.8 - 0.4, draw() - 0.5).normalize();
      return {
        defect,
        kind: WOUND.METEOR,
        up,
        base: up.clone().multiplyScalar(PLANET_RADIUS + 6),
        radius: 0.3,
        seed: draw(),
        fallIn: draw() * 5,
      };
    }
    const kind = kindOf(events);
    const up =
      kind === WOUND.STORM
        ? rotateToward(
            crust.centre,
            crust.theta * (events > 50 ? 0.15 : 0.35),
            draw() * Math.PI * 2,
          )
        : sampleSite(layout, crust, draw, taken, { apart: 0.45, spread: 0.75 }).up.clone();
    const ground = groundAt(layout, up, layout.neighbours.get(crust));
    const base = up.clone().multiplyScalar(PLANET_RADIUS + Math.max(ground.height, 0));
    const radius =
      kind === WOUND.STORM
        ? 0.5 + 0.27 * Math.sqrt(events)
        : kind === WOUND.VOLCANO
          ? 0.18 + 0.075 * Math.sqrt(events)
          : 0.12 + 0.07 * Math.sqrt(events);
    return { defect, kind, up, base, radius, seed: draw(), fallIn: draw() * 5 };
  };

  /** A defect in the core alone: a vent on its shell's floor, or on the heart's face for the heart. */
  const ventOf = (defect: FactoryDefect, shell: CoreZone, draw: () => number): Wound => {
    const heart = shell.shell === 0;
    const up = heart ? new Vector3(1, 1, 1).normalize() : new Vector3(0, 1, 0);
    const angle = ((20 + draw() * 50) * Math.PI) / 180;
    const radius = mix(shell.inner, shell.outer, 0.5);
    const base = heart
      ? up.clone().multiplyScalar(shell.outer)
      : new Vector3(radius * Math.cos(angle), 0.03, radius * Math.sin(angle));
    return { defect, kind: WOUND.VENT, up, base, radius: 0.3, seed: draw(), fallIn: draw() * 5 };
  };

  const plumesOf = (layout: PlanetLayout) => {
    const dark: Plume[] = [];
    const hot: Plume[] = [];
    const defect = shared.uDefect.value;
    const ember = [defect.r * 3.2, defect.g * 3.2 + 0.4, defect.b * 3.2] as const;
    for (const wound of wounds) {
      const events = Math.min(wound.defect.events, 60);
      if (wound.kind === WOUND.VOLCANO) {
        const mouth = wound.base.clone().addScaledVector(wound.up, wound.radius * 0.9);
        dark.push({
          at: mouth,
          up: wound.up,
          height: 1.4 + events * 0.05,
          spread: 0.18,
          size: 0.32,
          speed: 0.12,
          count: 26 + events,
          glow: [0.16, 0.1, 0.1],
        });
        hot.push({
          at: mouth,
          up: wound.up,
          height: 0.7,
          spread: 0.12,
          size: 0.05,
          speed: 0.4,
          count: 14 + events,
          glow: ember,
        });
      } else if (wound.kind === WOUND.CRATER) {
        dark.push({
          at: wound.base.clone().addScaledVector(wound.up, 0.02),
          up: wound.up,
          height: 0.8,
          spread: 0.08,
          size: 0.16,
          speed: 0.15,
          count: 10,
          glow: [0.13, 0.1, 0.1],
        });
      } else if (wound.kind === WOUND.VENT) {
        dark.push({
          at: wound.base,
          up: wound.up,
          height: 1.6,
          spread: 0.15,
          size: 0.25,
          speed: 0.14,
          count: 16 + Math.round(events / 2),
          glow: [0.14, 0.09, 0.09],
        });
        hot.push({
          at: wound.base,
          up: wound.up,
          height: 1.2,
          spread: 0.1,
          size: 0.06,
          speed: 0.35,
          count: 12 + Math.round(events / 2),
          glow: ember,
        });
      }
    }
    for (const defectInCore of coreWounds(layout)) {
      const { shell, events } = defectInCore;
      const draw = rng(shell.index * 7919);
      for (let vent = 0; vent < 3; vent += 1) {
        const angle = ((15 + draw() * 60) * Math.PI) / 180;
        const radius = mix(shell.inner, shell.outer, 0.2 + draw() * 0.6);
        hot.push({
          at: new Vector3(radius * Math.cos(angle), 0.02, radius * Math.sin(angle)),
          up: UP,
          height: 2.2,
          spread: 0.25,
          size: 0.07,
          speed: 0.22 + draw() * 0.1,
          count: Math.round(8 + Math.min(events, 60) * 0.5),
          glow: ember,
        });
      }
    }
    smoke.fill(dark);
    embers.fill(hot);
  };

  let shown: readonly FactoryDefect[] = [];
  const coreWounds = (layout: PlanetLayout) =>
    shown.flatMap((defect) => {
      const shell = defect.zonePaths
        .map((path) => layout.byPath.get(path))
        .find((zone): zone is CoreZone => zone?.place === ZONE_PLACE.CORE);
      return shell === undefined ? [] : [{ shell, events: defect.events }];
    });

  const show: Defects["show"] = (layout, defects, taken) => {
    shown = defects.slice(0, MAX);
    wounds = shown.map((defect) => woundOf(layout, defect, taken));
    seams.cracks.value.fill(0);
    for (const { shell, events } of coreWounds(layout)) {
      if (shell.shell < MAX_STRATA)
        seams.cracks.value[shell.shell] = clamp(
          (seams.cracks.value[shell.shell] ?? 0) + events / 40,
          0.35,
          1.6,
        );
    }
    seams.scorchDepths.value.fill(0);
    wounds
      .filter((wound) => wound.kind !== WOUND.METEOR)
      .slice(0, MAX_SCORCHES)
      .forEach((wound, at) => {
        const reach =
          wound.kind === WOUND.STORM
            ? 0.06 + Math.sqrt(wound.defect.events) * 0.018
            : 0.03 + Math.sqrt(wound.defect.events) * 0.012;
        seams.scorches.value[at]?.set(wound.up.x, wound.up.y, wound.up.z, reach);
        seams.scorchDepths.value[at] = wound.kind === WOUND.STORM ? 0.9 : 0.75;
      });
    placeStill();
    plumesOf(layout);
    targets = wounds.map((wound) => ({ kind: PICK_KIND.DEFECT, id: wound.defect.id }));
    paint();
  };

  const placeStill = () => {
    const counts = { storms: 0, volcanoes: 0, craters: 0, glows: 0 };
    wounds.forEach((wound, at) => {
      if (wound.kind === WOUND.STORM) {
        for (let layer = 0; layer < STORM_LAYERS; layer += 1) {
          const height = PLANET_RADIUS + 1 + layer * 0.22;
          const radius = wound.radius * (1 - layer * 0.12);
          placing.position.copy(wound.up).multiplyScalar(height);
          placing.quaternion.setFromUnitVectors(UP, wound.up);
          placing.scale.set(radius, 1, radius);
          placing.updateMatrix();
          const slot = counts.storms++;
          storms.setMatrixAt(slot, placing.matrix);
          stormAttributes.aLayer.setX(slot, layer);
          stormAttributes.aHeat.setX(slot, clamp(wound.defect.events / 84, 0.35, 1));
          stormAttributes.aSeed.setX(slot, wound.seed * 10);
          stormAttributes.aBend.setX(slot, (radius * radius) / (2 * height));
        }
        const glow = counts.glows++;
        glows.positions.setXYZ(
          glow,
          ...wound.up
            .clone()
            .multiplyScalar(PLANET_RADIUS + 0.6)
            .toArray(),
        );
        glows.sizes.setX(glow, wound.radius * 1.7);
      } else if (wound.kind === WOUND.VOLCANO)
        stand(volcanoes, counts.volcanoes++, wound, wound.radius);
      else if (wound.kind === WOUND.CRATER)
        stand(craters, counts.craters++, wound, wound.radius, 0.015);
      const proxy = wound.kind === WOUND.STORM ? wound.radius * 0.55 : 0.35;
      placing.position.copy(
        wound.kind === WOUND.STORM
          ? wound.up.clone().multiplyScalar(PLANET_RADIUS + 1.1)
          : wound.base,
      );
      placing.scale.setScalar(proxy);
      placing.updateMatrix();
      proxies.setMatrixAt(at, placing.matrix);
    });
    storms.count = counts.storms;
    volcanoes.count = counts.volcanoes;
    craters.count = counts.craters;
    meteors.count = wounds.length;
    marks.count = wounds.length;
    proxies.count = wounds.length;
    glows.points.geometry.setDrawRange(0, counts.glows);
    glows.positions.needsUpdate = true;
    glows.sizes.needsUpdate = true;
    for (const attribute of Object.values(stormAttributes)) attribute.needsUpdate = true;
    for (const mesh of [storms, volcanoes, craters, proxies]) flush(mesh);
  };

  const paint = () => {
    wounds.forEach((wound, at) => {
      if (!chosen(wound.defect.id)) {
        marks.setMatrixAt(at, HIDDEN);
        return;
      }
      stand(
        marks,
        at,
        wound,
        wound.kind === WOUND.STORM ? wound.radius * 0.6 : wound.radius * 1.6 + 0.1,
        0.03,
      );
    });
    flush(marks);
  };

  const meteorAt = (wound: Wound, t: number, out: Vector3) => {
    const axis = new Vector3(0, 1, 0).cross(wound.up).normalize();
    return out
      .copy(wound.base)
      .applyAxisAngle(axis.lengthSq() > 0 ? axis : new Vector3(1, 0, 0), t * 0.08 + wound.seed * 6);
  };

  const fall = (wound: Wound, delta: number) => {
    wound.fallIn -= delta;
    if (wound.fallIn > 0 || wound.kind === WOUND.METEOR) return;
    wound.fallIn =
      (34 / Math.sqrt(Math.max(1, wound.defect.events))) * (0.7 + particles.draw() * 0.6);
    const from = wound.up
      .clone()
      .multiplyScalar(PLANET_RADIUS + 5.4)
      .applyAxisAngle(new Vector3(0, 1, 0), 0.6);
    const end =
      wound.kind === WOUND.STORM
        ? wound.up.clone().multiplyScalar(PLANET_RADIUS + 0.5)
        : wound.base;
    const tone = shared.uDefect.value;
    for (let spark = 0; spark < 16; spark += 1) {
      const k = spark / 15;
      particles.emit(from.clone().lerp(end, k * k), new Vector3(), 0.25 + k * 0.5, 0.1, [
        tone.r * 3,
        tone.g * 3 + 0.5,
        tone.b * 3,
      ]);
    }
    particles.emit(end, new Vector3(), 0.35, 0.9, [tone.r * 3, tone.g * 3, tone.b * 3]);
  };

  return {
    group,
    show,
    choose: (next) => {
      chosen = next;
      paint();
    },
    step: (t, delta, falling) => {
      const at = new Vector3();
      wounds.forEach((wound, index) => {
        if (wound.kind !== WOUND.METEOR) {
          meteors.setMatrixAt(index, HIDDEN);
          if (falling) fall(wound, delta);
          return;
        }
        meteorAt(wound, t, at);
        placing.position.copy(at);
        placing.quaternion.identity();
        placing.rotation.set(t * 0.7 + wound.seed, t * 0.5, 0);
        placing.scale.setScalar(1 + Math.min(wound.defect.events, 40) / 40);
        placing.updateMatrix();
        meteors.setMatrixAt(index, placing.matrix);
        proxies.setMatrixAt(index, placing.matrix);
        if (chosen(wound.defect.id)) marks.setMatrixAt(index, placing.matrix);
        if (falling && particles.draw() < delta * 20) {
          const tone = shared.uDefect.value;
          particles.emit(at, new Vector3(), 0.6, 0.12, [tone.r * 3, tone.g * 3 + 0.4, tone.b * 3]);
        }
      });
      flush(meteors);
      flush(proxies);
      flush(marks);
    },
  };
}
