import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import type { TimelineEntry } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import { type Building, placeTower, towerMesh } from "./cities";
import {
  groundAt,
  PLANET_RADIUS,
  type PlanetLayout,
  type PlanetZone,
  type Site,
  sampleSite,
  siteInScene,
  ZONE_PLACE,
} from "./globe";
import {
  clamp,
  flush,
  GLSL_OUTPUT,
  HIDDEN,
  rng,
  rotateToward,
  type SharedUniforms,
  seedOf,
} from "./kit";
import type { Particles } from "./particles";

/**
 * shipped.ts -- merged work as the planet shows it: a fresh tower rising where each pull request landed, the city lights it brightens, and a ring of lights in orbit, one per merge, that rockets climb to.
 *
 * Each merged pull request in the view raises a tower in the first crust
 * zone it landed in, glowing the shipped colour while it is fresh and
 * cooling over the hours after, and scatters lights around it that twinkle
 * on the night side. Above the planet a tilted ring holds one light per
 * merge, in the order they merged, the newest brightest. While motion runs
 * and the scrubber is at now, rockets climb from the newest towers to their
 * lights on the ring, which flare as each arrives and the agents building
 * there cheer. Every age here is read against the view's own instant, so
 * scrubbing back redraws it as it was.
 */

const MAX = FACTORY_WORLD_BOUNDS.MAX_SHIPPED;

/** The most lights one merge scatters around its tower, per zone. */
const MAX_LIGHTS_PER_ZONE = 18;

const RING_RADIUS = PLANET_RADIUS + 5.4;

const ROCKETS = 14;

const HOUR_MS = 60 * 60 * 1000;

/** A fresh tower's stone, warmer than the city's. */
const FRESH_TONE = new Color(0xfff1d6);

/** How long a rocket takes to climb to the ring, in seconds. */
const CLIMB_SECONDS = 3.6;

function rocketGeometry(): BufferGeometry {
  const profile = [
    [0, 0],
    [0.05, 0.02],
    [0.06, 0.12],
    [0.055, 0.24],
    [0.035, 0.32],
    [0, 0.38],
  ].map(([x = 0, y = 0]) => new Vector2(x, y));
  const fins = [0, 1, 2].map((fin) =>
    new BoxGeometry(0.008, 0.08, 0.06)
      .translate(0, 0.05, 0.06)
      .rotateY((fin * Math.PI * 2) / 3)
      .toNonIndexed(),
  );
  return mergeGeometries([new LatheGeometry(profile, 12).toNonIndexed(), ...fins]);
}

function lightsMaterial(shared: SharedUniforms): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute float aAge; attribute float aSeed; uniform float uProjection; uniform float uTime; uniform vec3 uSunDir; uniform float uPixelRatio;
      varying float vA; varying float vFlash;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float fresh = exp(-aAge / 3.5);
        vFlash = exp(-aAge * 5.0);
        float night = smoothstep(0.12, -0.2, dot(normalize(position), uSunDir));
        float twinkle = 0.75 + 0.25 * sin(uTime * 3.0 + aSeed * 60.0);
        vA = (0.4 + 0.6 * night) * (0.35 + 0.65 * fresh) * twinkle + vFlash;
        gl_PointSize = clamp((0.016 + 0.03 * fresh + 0.25 * vFlash) * uProjection / -mv.z, 1.5, 9.0 + 20.0 * vFlash) * uPixelRatio;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uShipped; varying float vA; varying float vFlash;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a;
        vec3 c = mix(uShipped * 2.6, vec3(2.4, 3.0, 2.6), smoothstep(0.35, 0.0, d));
        gl_FragColor = vec4(c * a * vA, 1.0); ${GLSL_OUTPUT} }`,
  });
}

/** One merge as drawn: its tower's place, its ring slot, and when it merged. */
interface Merge {
  readonly entry: TimelineEntry;
  readonly site: Site | undefined;
  readonly slot: number;
  readonly hoursAgo: number;
}

interface Rocket {
  merge: Merge | undefined;
  from: Vector3;
  up: Vector3;
  age: number;
  size: number;
}

export interface Shipped {
  readonly group: Group;
  /** Draws the view's merges, as of `now`, apart from what `taken` holds already. */
  readonly show: (
    layout: PlanetLayout,
    timeline: readonly TimelineEntry[],
    now: number,
    taken: Map<PlanetZone, Vector3[]>,
  ) => void;
  readonly choose: (chosen: (url: string) => boolean) => void;
  /** Turns the ring, flies the rockets, and launches the next while `launching`. */
  readonly step: (t: number, delta: number, launching: boolean) => void;
  /** Lets every rocket in flight go. */
  readonly ground: () => void;
}

/** Every zone of `entry` the planet can stand a tower or light in. */
function landingsOf(layout: PlanetLayout, entry: TimelineEntry): PlanetZone[] {
  return entry.zonePaths.flatMap((path) => layout.byPath.get(path) ?? []);
}

export function createShipped(
  shared: SharedUniforms,
  picking: WorldPicking,
  particles: Particles,
  towers: MeshStandardMaterial,
  onArrive: (zones: readonly string[]) => void,
): Shipped {
  const group = new Group();
  const fresh = towerMesh(towers, MAX);
  const lightCount = MAX * 2 * MAX_LIGHTS_PER_ZONE;
  const lightGeometry = new BufferGeometry();
  const lightPositions = new BufferAttribute(new Float32Array(lightCount * 3), 3);
  const lightAges = new BufferAttribute(new Float32Array(lightCount), 1);
  const lightSeeds = new BufferAttribute(new Float32Array(lightCount), 1);
  lightGeometry.setAttribute("position", lightPositions);
  lightGeometry.setAttribute("aAge", lightAges);
  lightGeometry.setAttribute("aSeed", lightSeeds);
  const lights = new Points(lightGeometry, lightsMaterial(shared));
  lights.frustumCulled = false;
  lights.renderOrder = 2;
  const ring = new Group();
  ring.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0.18, 1, -0.32).normalize());
  const turning = new Group();
  ring.add(turning);
  const band = new Mesh(
    new RingGeometry(RING_RADIUS - 0.02, RING_RADIUS + 0.02, 256).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      color: shared.uShipped.value.clone().multiplyScalar(1.6),
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const dots = new InstancedMesh(
    new SphereGeometry(0.07, 12, 8),
    new MeshBasicMaterial({ color: 0xffffff }),
    MAX,
  );
  dots.frustumCulled = false;
  dots.count = 0;
  turning.add(band, dots);
  const rocketMesh = new InstancedMesh(
    rocketGeometry(),
    new MeshStandardMaterial({
      color: 0xf6f2ea,
      roughness: 0.35,
      metalness: 0.3,
      emissive: 0x3a2400,
      emissiveIntensity: 0.3,
    }),
    ROCKETS,
  );
  rocketMesh.frustumCulled = false;
  rocketMesh.castShadow = true;
  for (let rocket = 0; rocket < ROCKETS; rocket += 1) rocketMesh.setMatrixAt(rocket, HIDDEN);
  group.add(fresh, lights, ring, rocketMesh);

  let merges: Merge[] = [];
  let towerTargets: PickTarget[] = [];
  let dotTargets: PickTarget[] = [];
  let chosen: (url: string) => boolean = () => false;
  const pops = new Float32Array(MAX).fill(-100);
  const rockets: Rocket[] = Array.from({ length: ROCKETS }, () => ({
    merge: undefined,
    from: new Vector3(),
    up: new Vector3(),
    age: -1,
    size: 1,
  }));
  let nextRocket = 0;
  let launchIn = 0;
  let clock = 0;
  picking.addInstances(fresh, (instance) => towerTargets[instance]);
  picking.addInstances(dots, (instance) => dotTargets[instance]);

  const slotAt = (slot: number, out: Vector3) => {
    const angle = 0.2 + (slot / Math.max(1, merges.length - 1)) * Math.PI * 2 * 0.88;
    return out.set(Math.cos(angle) * RING_RADIUS, 0, Math.sin(angle) * RING_RADIUS);
  };

  const scatterLights = (
    layout: PlanetLayout,
    merge: Merge,
    zones: readonly PlanetZone[],
    written: number,
  ) => {
    const draw = rng(seedOf(merge.entry.url) ^ 0x5bd1e995);
    const lines = merge.entry.additions + merge.entry.deletions;
    for (const [order, zone] of zones.slice(0, 2).entries()) {
      if (zone.place !== ZONE_PLACE.CRUST) continue;
      const centre = order === 0 && merge.site !== undefined ? merge.site.up : zone.centre;
      const count = clamp(
        Math.round(4 + Math.sqrt(lines / zones.length) / 3),
        4,
        MAX_LIGHTS_PER_ZONE,
      );
      for (let light = 0; light < count; light += 1) {
        const reach = Math.min(zone.theta * 0.55, 0.12 + Math.sqrt(lines) * 0.004);
        const direction = rotateToward(centre, Math.sqrt(draw()) * reach, draw() * Math.PI * 2);
        const ground = groundAt(layout, direction, layout.neighbours.get(zone));
        if (ground.owner !== zone) continue;
        direction.multiplyScalar(PLANET_RADIUS + Math.max(ground.height, 0) + 0.035);
        lightPositions.setXYZ(written, direction.x, direction.y, direction.z);
        lightAges.setX(written, merge.hoursAgo);
        lightSeeds.setX(written, draw());
        written += 1;
      }
    }
    return written;
  };

  const paint = () => {
    const tint = new Color();
    merges.forEach((merge, slot) => {
      const picked = chosen(merge.entry.url);
      const glow = 0.45 + 0.75 * Math.exp(-merge.hoursAgo / 3);
      tint
        .copy(picked ? shared.uChosen.value : shared.uShipped.value)
        .multiplyScalar(picked ? 3 : 1.6 * glow);
      dots.setColorAt(slot, tint);
    });
    let tower = 0;
    for (const merge of merges) {
      if (merge.site === undefined) continue;
      fresh.setColorAt(
        tower,
        tint.set(chosen(merge.entry.url) ? shared.uChosen.value : FRESH_TONE),
      );
      tower += 1;
    }
    flush(dots);
    flush(fresh);
  };

  const ground = () => {
    for (const rocket of rockets) {
      rocket.age = -1;
      rocket.merge = undefined;
    }
    for (let rocket = 0; rocket < ROCKETS; rocket += 1) rocketMesh.setMatrixAt(rocket, HIDDEN);
    rocketMesh.instanceMatrix.needsUpdate = true;
  };

  const show: Shipped["show"] = (layout, timeline, now, taken) => {
    // Note that a rocket in flight carries a merge of the timeline it was launched from, so a new timeline lets every one go.
    ground();
    const recent = timeline.slice(-MAX);
    merges = recent.map((entry, slot) => {
      const zone = landingsOf(layout, entry).find((landing) => landing.place === ZONE_PLACE.CRUST);
      const draw = rng(seedOf(entry.url));
      const site =
        zone === undefined
          ? undefined
          : sampleSite(layout, zone, draw, taken, { apart: 0.14, spread: 0.7 });
      return { entry, site, slot, hoursAgo: Math.max(0, (now - entry.mergedAt) / HOUR_MS) };
    });
    const freshTowers = merges.filter((merge) => merge.site !== undefined);
    freshTowers.forEach((merge, at) => {
      const draw = rng(seedOf(merge.entry.url) ^ 0x2545f491);
      const lines = merge.entry.additions + merge.entry.deletions;
      const site = merge.site;
      if (site === undefined) return;
      const building: Building = {
        site,
        width: 0.08 + draw() * 0.05,
        depth: 0.08 + draw() * 0.05,
        height: clamp(0.16 + 0.011 * Math.sqrt(lines), 0.16, 1.1),
        yaw: draw() * Math.PI * 2,
        seed: draw(),
      };
      placeTower(fresh, at, building, clamp(merge.hoursAgo / 0.4, 0, 1));
      fresh.geometry.getAttribute("aFresh").setX(at, Math.exp(-merge.hoursAgo / 3));
    });
    fresh.count = freshTowers.length;
    towerTargets = freshTowers.map((merge) => ({ kind: PICK_KIND.SHIPPED, id: merge.entry.url }));
    dotTargets = merges.map((merge) => ({ kind: PICK_KIND.SHIPPED, id: merge.entry.url }));
    for (const name of ["aZone", "aFresh", "aSeed"])
      fresh.geometry.getAttribute(name).needsUpdate = true;
    let written = 0;
    for (const merge of merges)
      written = scatterLights(layout, merge, landingsOf(layout, merge.entry), written);
    lightGeometry.setDrawRange(0, written);
    for (const attribute of [lightPositions, lightAges, lightSeeds]) attribute.needsUpdate = true;
    const placing = new Object3D();
    merges.forEach((merge) => {
      slotAt(merge.slot, placing.position);
      placing.scale.setScalar(
        0.5 + clamp(Math.sqrt(merge.entry.additions + merge.entry.deletions) / 50, 0.15, 1),
      );
      placing.updateMatrix();
      dots.setMatrixAt(merge.slot, placing.matrix);
    });
    dots.count = merges.length;
    paint();
  };

  const launch = () => {
    const weights = merges.map((merge) =>
      merge.site === undefined ? 0 : Math.exp(-merge.hoursAgo / 3) + 0.15,
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return;
    let pick = particles.draw() * total;
    const merge = merges.find((_, at) => {
      pick -= weights[at] ?? 0;
      return pick <= 0;
    });
    if (merge?.site === undefined) return;
    const rocket = rockets[nextRocket];
    nextRocket = (nextRocket + 1) % ROCKETS;
    if (rocket === undefined) return;
    siteInScene(merge.site, clock, rocket.from, rocket.up);
    rocket.merge = merge;
    rocket.age = 0;
    rocket.size =
      1.1 + Math.min(1.6, Math.sqrt(merge.entry.additions + merge.entry.deletions) / 30);
  };

  const target = new Vector3();
  const along = new Vector3();
  const velocity = new Vector3();
  const placing = new Object3D();
  const UP = new Vector3(0, 1, 0);
  const fly = (rocket: Rocket, index: number, delta: number) => {
    const merge = rocket.merge;
    if (rocket.age < 0 || merge === undefined) {
      rocketMesh.setMatrixAt(index, HIDDEN);
      return;
    }
    rocket.age += delta;
    const k = Math.min(rocket.age / CLIMB_SECONDS, 1);
    slotAt(merge.slot, target).applyMatrix4(turning.matrixWorld);
    const p1 = rocket.from.clone().addScaledVector(rocket.up, 3.2);
    const p2 = target.clone().multiplyScalar(1.18);
    const curve = (t: number, out: Vector3) => {
      const u = 1 - t;
      return out
        .copy(rocket.from)
        .multiplyScalar(u * u * u)
        .addScaledVector(p1, 3 * u * u * t)
        .addScaledVector(p2, 3 * u * t * t)
        .addScaledVector(target, t * t * t);
    };
    const eased = k ** 1.5;
    const position = curve(eased, along);
    curve(Math.min(eased + 0.01, 1), velocity).sub(position);
    if (velocity.lengthSq() < 1e-10) velocity.copy(rocket.up);
    velocity.normalize();
    if (k >= 1) {
      arrive(rocket, merge);
      rocketMesh.setMatrixAt(index, HIDDEN);
      return;
    }
    placing.position.copy(position);
    placing.quaternion.setFromUnitVectors(UP, velocity);
    placing.scale.setScalar(rocket.size * (k > 0.85 ? 1 - ((k - 0.85) / 0.15) * 0.6 : 1));
    placing.updateMatrix();
    rocketMesh.setMatrixAt(index, placing.matrix);
    const tail = position.clone().addScaledVector(velocity, -0.03);
    const jitter = () => (particles.draw() - 0.5) * 0.08;
    particles.emit(
      tail,
      velocity
        .clone()
        .multiplyScalar(-0.4)
        .add(new Vector3(jitter(), jitter(), jitter())),
      0.35,
      0.09 * rocket.size,
      [3.2, 1.9, 0.6],
    );
    particles.emit(
      tail,
      velocity.clone().multiplyScalar(-0.05),
      1.6,
      0.05 * rocket.size,
      [0.5, 0.36, 0.12],
      2.5,
    );
  };

  const arrive = (rocket: Rocket, merge: Merge) => {
    rocket.age = -1;
    const burst = new Vector3();
    const shipped = shared.uShipped.value;
    for (let spark = 0; spark < 40; spark += 1) {
      burst
        .set(particles.draw() - 0.5, particles.draw() - 0.5, particles.draw() - 0.5)
        .normalize()
        .multiplyScalar(0.4 + particles.draw() * 0.6);
      particles.emit(
        target,
        burst,
        0.9 + particles.draw() * 0.6,
        0.06,
        spark % 3 ? [shipped.r * 3, shipped.g * 3, shipped.b * 3] : [3, 2.8, 2.4],
      );
    }
    pops[merge.slot] = clock;
    onArrive(merge.entry.zonePaths);
  };

  return {
    group,
    show,
    choose: (next) => {
      chosen = next;
      paint();
    },
    step: (t, delta, launching) => {
      clock = t;
      turning.rotation.y = t * 0.012;
      ring.updateMatrixWorld(true);
      if (launching) {
        launchIn -= delta;
        if (launchIn <= 0) {
          launchIn = 0.9 + particles.draw() * 1.2;
          launch();
        }
      }
      rockets.forEach((rocket, index) => {
        fly(rocket, index, delta);
      });
      merges.forEach((merge) => {
        const pop = Math.exp(-Math.max(t - (pops[merge.slot] ?? -100), 0) * 2.2);
        if (pop < 0.01) return;
        slotAt(merge.slot, placing.position);
        placing.quaternion.identity();
        placing.scale.setScalar(
          (0.5 + clamp(Math.sqrt(merge.entry.additions + merge.entry.deletions) / 50, 0.15, 1)) *
            (1 + pop * 2),
        );
        placing.updateMatrix();
        dots.setMatrixAt(merge.slot, placing.matrix);
      });
      flush(dots);
      rocketMesh.instanceMatrix.needsUpdate = true;
    },
    ground,
  };
}
