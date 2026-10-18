import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import type { TimelineEntry } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from "three";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import { CITY, type CityLayout, DISTRICT_KIND, type District, groundOf } from "./city";
import type { Districts } from "./districts";
import {
  anemoneGeometry,
  easeInOut,
  fishGeometry,
  instancedAttribute,
  seabedHeightAt,
  seededRandom,
  smoothstep,
} from "./geometry";
import { type Sea, TAU } from "./sea";
import {
  type Billboards,
  PARTICLE_KIND,
  PARTICLE_LAYER,
  type Particles,
  type Pings,
} from "./sprites";

/**
 * shipped.ts -- the merged pull requests as Atlantis draws them: anemones blooming where each landed, glowing brightest while it is new, schools of fish circling the districts most alive with shipped work, columns of light rising over them, and, while the scrubber stands at now, the newest work landing again and again.
 *
 * Each pull request blooms on up to three of the zones it landed in,
 * seeded by its number so it blooms in the same spot every time, and one
 * that landed in no zone blooms on the plaza. A bloom's size is its lines,
 * its glow its age at the scrubber's instant, so winding the clock back
 * dims and then removes it. Each bloom is picked as its pull request.
 */

/** The most anemones: three spots of three for every merged pull request. */
const BLOOMS = FACTORY_WORLD_BOUNDS.MAX_SHIPPED * 9;
const SPOTS = FACTORY_WORLD_BOUNDS.MAX_SHIPPED * 3;
const FISH = 1600;
const BEACONS = FACTORY_WORLD_BOUNDS.MAX_ZONES;
const LAUNCHES = 10;

/** How long a pull request takes to fade from new to settled, in hours. */
const FRESH_HOURS = 2.5;

/** Merged pull requests, drawn. */
export interface Shipped {
  /** Blooms `timeline` over `layout` as of `at`, picked by URL, `chosen` drawn in the selection's colour; or hides it all. */
  readonly draw: (
    layout: CityLayout,
    timeline: readonly TimelineEntry[],
    at: number,
    chosen: (url: string) => boolean,
    shown: boolean,
    alive: readonly number[],
  ) => void;
  /** Circles the fish and lands the newest work, while the scrubber stands at now. */
  readonly step: (delta: number, elapsed: number, live: boolean, particles: Particles) => void;
  readonly paint: (glows: Billboards) => void;
  /** Lands nothing more: drops every launch in flight and puts out every landing's flash and ring. */
  readonly quiet: () => void;
}

const BLOOM_VERTEX = /* glsl */ `
attribute float aT; attribute vec3 aCol; attribute float aGlow; attribute float aSeed;
varying float vT; varying vec3 vCol; varying float vGlow; varying float vDepth; varying float vSeed;
void main(){
  vec3 p = position;
  p.x += sin(uTime*1.6 + aSeed + aT*3.0)*aT*aT*0.28;
  p.z += cos(uTime*1.3 + aSeed*1.7 + aT*2.6)*aT*aT*0.28;
  vec4 w = modelMatrix*instanceMatrix*vec4(p,1.0);
  vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv;
  vT = aT; vCol = aCol; vGlow = aGlow; vSeed = aSeed;
}`;

const BLOOM_FRAGMENT = /* glsl */ `
varying float vT; varying vec3 vCol; varying float vGlow; varying float vDepth; varying float vSeed;
void main(){
  float pulse = 0.7 + 0.3*sin(uTime*2.2 + vSeed - vT*4.0);
  vec3 c = vCol*(0.12 + vT*vT*2.6*pulse)*vGlow + vCol*0.06;
  c += vec3(1.0)*pow(vT, 8.0)*vGlow*1.2;
  gl_FragColor = vec4(mix(c, uFogColor, fogF(vDepth)), 1.0);
}`;

const BEACON_VERTEX = /* glsl */ `
attribute vec2 aBeacon;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec2 vBeacon;
void main(){ vUv = uv; vBeacon = aBeacon; vec4 w = modelMatrix*instanceMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix*instanceMatrix)*normal); vV = cameraPosition - w.xyz; vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`;

const BEACON_FRAGMENT = /* glsl */ `
uniform vec3 uShipped;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec2 vBeacon;
void main(){
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
  float up = 1.0 - vUv.y;
  float rise = mix(0.8, 0.6 + 0.4*sin(vUv.y*18.0 - uTime*3.0), uMotion);
  float flash = clamp(1.0 - (uTime - vBeacon.y)*0.8, 0.0, 1.0);
  float a = pow(up, 1.6) * core * (vBeacon.x*0.5*rise + flash*1.6);
  gl_FragColor = vec4(uShipped*0.4*a*(1.0-fogF(vDepth)*0.7), 1.0);
}`;

/** Where a pull request blooms on `district`, seeded by `random`. */
function spotOn(district: District, random: () => number): Vector3 {
  const turn = random() * TAU;
  const r = district.radius;
  switch (district.kind) {
    case DISTRICT_KIND.CRYSTAL: {
      const out = Math.min(
        r * 2.4 + random() * 4,
        CITY.DOME_RADIUS - 3 - Math.hypot(district.centre.x, district.centre.z),
      );
      return new Vector3(
        district.centre.x + Math.cos(turn) * Math.max(out, r * 1.2),
        CITY.DOME_FLOOR,
        district.centre.z + Math.sin(turn) * Math.max(out, r * 1.2),
      );
    }
    case DISTRICT_KIND.DOME: {
      const out = r + 2.4 + random() * 2.5;
      const x = district.centre.x + Math.cos(turn) * out;
      const z = district.centre.z + Math.sin(turn) * out;
      return new Vector3(x, Math.max(seabedHeightAt(x, z), 0.2), z);
    }
    default: {
      const onTop = random() < 0.65;
      const out = onTop ? r * (0.35 + random() * 0.55) : r * 1.25 + random() * 4;
      const x = district.centre.x + Math.cos(turn) * out;
      const z = district.centre.z + Math.sin(turn) * out;
      return new Vector3(x, onTop ? district.base - 0.15 : seabedHeightAt(x, z), z);
    }
  }
}

/** Where a pull request that landed in no zone blooms: on the plaza, round the great dome, by its number. */
function spotOnPlaza(random: () => number): Vector3 {
  const turn = random() * TAU;
  const out = CITY.DOME_RADIUS + 10 + random() * 6;
  return new Vector3(Math.cos(turn) * out, 0.2, Math.sin(turn) * out);
}

/** One bloom spot of one pull request. */
interface Spot {
  readonly entry: TimelineEntry;
  readonly at: Vector3;
  readonly district: District | undefined;
}

/** One school of fish, circling a district. */
interface School {
  readonly centre: Vector3;
  readonly radius: number;
  readonly height: number;
  readonly speed: number;
  readonly phase: number;
  readonly tilt: number;
  readonly start: number;
  readonly count: number;
}

/** Where a school's path runs at `theta` round its district, at `elapsed`, into `into`. */
function swimPoint(school: School, theta: number, elapsed: number, into: Vector3): Vector3 {
  return into.set(
    school.centre.x + Math.cos(theta) * school.radius,
    school.height +
      Math.sin(theta * 2 + school.phase) * 3 +
      Math.sin(elapsed * 0.3 + school.phase) * 1.5 +
      Math.cos(theta) * school.radius * Math.sin(school.tilt) * 0.2,
    school.centre.z + Math.sin(theta) * school.radius * 0.82,
  );
}

/** One fish in its school: how far it trails, where it swims in the school, its size and wobble. */
interface Fish {
  readonly lag: number;
  readonly offset: Vector3;
  readonly size: number;
  readonly phase: number;
}

/** One pull request landing again: an orb arcing in to its spot. */
interface Launch {
  readonly from: Vector3;
  readonly to: Vector3;
  readonly district: District | undefined;
  readonly startedAt: number;
  readonly at: Vector3;
}

/** Shipped work in `scene`, picked through `picking`, flashing `districts` as it lands. */
export function shippedOf(
  scene: Scene,
  sea: Sea,
  picking: WorldPicking,
  districts: Districts,
  pings: Pings,
): Shipped {
  const shippedColor = new Color(sea.signal.SHIPPED);
  const selection = new Color(sea.signal.SELECTION);
  const pale = new Color("#c8ffe8");

  const bloomShape = anemoneGeometry();
  const bloomColor = instancedAttribute(bloomShape, "aCol", 3, BLOOMS);
  const bloomGlow = instancedAttribute(bloomShape, "aGlow", 1, BLOOMS);
  const bloomSeed = instancedAttribute(bloomShape, "aSeed", 1, BLOOMS);
  const blooms = new InstancedMesh(
    bloomShape,
    sea.shader({}, BLOOM_VERTEX, BLOOM_FRAGMENT, { side: DoubleSide }),
    BLOOMS,
  );
  const proxies = new InstancedMesh(
    new IcosahedronGeometry(1, 1),
    new MeshBasicMaterial({ visible: false }),
    SPOTS,
  );
  const fishShape = fishGeometry();
  const fishPhase = instancedAttribute(fishShape, "aPhase", 1, FISH);
  const fishGlow = instancedAttribute(fishShape, "aGlow", 1, FISH);
  const fishes = new InstancedMesh(
    fishShape,
    sea.standard(
      { color: "#d7eef5", roughness: 0.3, metalness: 0.65 },
      { caustic: 0.5, fish: true, glow: true, glowFromColor: 0.75 },
    ),
    FISH,
  );
  const beaconShape = new CylinderGeometry(0.6, 1, 70, 32, 1, true).translate(0, 35, 0);
  const beaconLook = instancedAttribute(beaconShape, "aBeacon", 2, BEACONS);
  const beacons = new InstancedMesh(
    beaconShape,
    sea.shader({}, BEACON_VERTEX, BEACON_FRAGMENT, {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    }),
    BEACONS,
  );
  beacons.renderOrder = 6;
  for (const mesh of [blooms, proxies, fishes, beacons]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  const random = seededRandom(3);
  for (let fish = 0; fish < FISH; fish += 1) {
    fishPhase.setX(fish, random() * TAU);
    fishGlow.setX(fish, 0.7);
    fishes.setColorAt(fish, new Color(shippedColor).lerp(pale, 0.4 + random() * 0.4));
  }
  const fishBody: Fish[] = Array.from({ length: FISH }, () => ({
    lag: random() * 0.9,
    offset: new Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1),
    size: 0.5 + random() * 0.45,
    phase: random() * TAU,
  }));

  let spotTargets: PickTarget[] = [];
  picking.addInstances(proxies, (instanceId) => spotTargets[instanceId]);

  let spots: Spot[] = [];
  let schools: School[] = [];
  let beaconSlots: (District | undefined)[] = [];
  let shown = true;
  const launches: Launch[] = [];
  let nextLaunch = 2;
  /** When work last landed, or -1 once every landing's flash is out. */
  let lastLanding = -1;
  let lastStep = 0;
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const at = new Vector3();
  const size = new Vector3();
  const up = new Vector3(0, 1, 0);
  const tint = new Color();
  const ahead = new Vector3();
  const side = new Vector3();
  const lift = new Vector3();
  const velocity = new Vector3();

  const swim = (elapsed: number) => {
    let count = 0;
    for (const school of schools) {
      const head = school.phase + elapsed * school.speed;
      for (let index = 0; index < school.count; index += 1) {
        const fish = fishBody[school.start + index];
        if (fish === undefined) continue;
        const angle = head - fish.lag * Math.sign(school.speed);
        swimPoint(school, angle, elapsed, at);
        swimPoint(school, angle + 0.02 * Math.sign(school.speed), elapsed, ahead)
          .sub(at)
          .normalize();
        const wobble = Math.sin(elapsed * 1.3 + fish.phase);
        at.x += fish.offset.x * (2 + Math.sqrt(school.count) * 0.35) + wobble * 0.4;
        at.y +=
          fish.offset.y * (2 + Math.sqrt(school.count) * 0.35) * 0.6 +
          Math.cos(elapsed * 1.1 + fish.phase) * 0.3;
        at.z += fish.offset.z * (2 + Math.sqrt(school.count) * 0.35);
        side.crossVectors(up, ahead).normalize();
        lift.crossVectors(ahead, side);
        matrix.makeBasis(side, lift, ahead).scale(size.setScalar(fish.size)).setPosition(at);
        fishes.setMatrixAt(school.start + index, matrix);
        count = Math.max(count, school.start + index + 1);
      }
    }
    fishes.count = shown ? count : 0;
    fishes.instanceMatrix.needsUpdate = true;
  };

  const quiet = () => {
    if (launches.length === 0 && lastLanding < 0) return;
    launches.length = 0;
    lastLanding = -1;
    districts.quench();
    pings.clear();
    for (let slot = 0; slot < beaconLook.count; slot += 1) beaconLook.setY(slot, -1e6);
    beaconLook.needsUpdate = true;
  };

  return {
    quiet,
    draw: (layout, timeline, now, chosen, visible, alive) => {
      shown = visible;
      if (!visible) quiet();
      spots = [];
      const bySchool = new Map<District, number>();
      for (const entry of timeline) {
        const random = seededRandom(entry.number);
        const landed = entry.zonePaths
          .map((path) => layout.byPath.get(path))
          .filter((district) => district !== undefined)
          .slice(0, 3);
        if (landed.length === 0)
          spots.push({ entry, at: spotOnPlaza(random), district: undefined });
        for (const district of landed) {
          spots.push({ entry, at: spotOn(district, random), district });
          bySchool.set(district, (bySchool.get(district) ?? 0) + 1);
        }
      }
      spots = spots.slice(0, SPOTS);
      spotTargets = spots.map((spot) => ({ kind: PICK_KIND.SHIPPED, id: spot.entry.url }));

      let bloom = 0;
      spots.forEach((spot, index) => {
        const random = seededRandom(spot.entry.number * 7 + index);
        const lines = spot.entry.additions + spot.entry.deletions;
        const hours = Math.max(0, (now - spot.entry.mergedAt) / 3.6e6);
        const glow = 0.35 + 1.6 * Math.exp(-hours / FRESH_HOURS);
        const big = 0.7 + 0.42 * Math.log10(lines + 1);
        const picked = chosen(spot.entry.url);
        const many = 2 + Math.floor(random() * 2);
        for (let petal = 0; petal < many && bloom < BLOOMS; petal += 1) {
          const off = petal === 0 ? 0 : 1;
          matrix.compose(
            at.set(
              spot.at.x + (random() - 0.5) * 2.6 * off,
              spot.at.y,
              spot.at.z + (random() - 0.5) * 2.6 * off,
            ),
            turn.setFromAxisAngle(up, random() * TAU),
            size.setScalar(big * (petal === 0 ? 1 : 0.6 + random() * 0.3)),
          );
          blooms.setMatrixAt(bloom, matrix);
          tint
            .copy(picked ? selection : shippedColor)
            .lerp(pale, picked ? 0.1 : (petal % 3) * 0.18);
          bloomColor.setXYZ(bloom, tint.r, tint.g, tint.b);
          bloomGlow.setX(bloom, picked ? glow + 1.2 : glow);
          bloomSeed.setX(bloom, random() * 100);
          bloom += 1;
        }
        matrix.compose(
          at.copy(spot.at).setY(spot.at.y + big * 0.8),
          turn.identity(),
          size.setScalar(big + 1.6),
        );
        proxies.setMatrixAt(index, matrix);
      });
      blooms.count = shown ? bloom : 0;
      proxies.count = shown ? spots.length : 0;
      for (const attribute of [bloomColor, bloomGlow, bloomSeed]) attribute.needsUpdate = true;
      blooms.instanceMatrix.needsUpdate = true;
      proxies.instanceMatrix.needsUpdate = true;

      // Note that each district's school grows with the work that landed there, and the core's circles the whole great dome.
      schools = [];
      let start = 0;
      for (const [district, landed] of bySchool) {
        const count = Math.min(14 + landed * 5, 130, FISH - start);
        if (count <= 0) break;
        const random = seededRandom(Math.floor(district.seed * 1e6) + 11);
        const core = district.kind === DISTRICT_KIND.CRYSTAL;
        const radius = core ? CITY.DOME_RADIUS + 10 : district.radius + 7 + random() * 4;
        schools.push({
          centre: groundOf(district),
          radius,
          height: (core ? 30 : district.top * 0.75 + 4) + random() * 5 - 2,
          speed: ((0.5 + random() * 0.25) * 14 * (random() < 0.5 ? 1 : -1)) / radius,
          phase: random() * TAU,
          tilt: random() * 0.5 - 0.25,
          start,
          count,
        });
        start += count;
      }
      swim(lastStep);

      beaconSlots = [];
      layout.districts.forEach((district) => {
        // Note that only the districts most alive with shipped work raise a column, so it marks where the work is landing now.
        const glow = smoothstep(0.35, 1, alive[district.index] ?? 0) * 0.8;
        if (!shown || glow <= 0.05 || district.kind === DISTRICT_KIND.CRYSTAL) return;
        const slot = beaconSlots.length;
        const r = district.radius;
        matrix.compose(
          at.set(district.centre.x, district.base, district.centre.z),
          turn.identity(),
          size.set(r * 0.75 + 1.2, 0.35 + 0.65 * glow, r * 0.75 + 1.2),
        );
        beacons.setMatrixAt(slot, matrix);
        beaconLook.setX(slot, glow);
        beaconSlots.push(district);
      });
      beacons.count = beaconSlots.length;
      beacons.instanceMatrix.needsUpdate = true;
      beaconLook.needsUpdate = true;
    },
    step: (delta, elapsed, live, particles) => {
      lastStep = elapsed;
      swim(elapsed);
      // Note that work lands only while the scrubber stands at now and shipped is shown, so nothing green flashes outside its layer or its instant.
      if (!live || !shown) {
        quiet();
        return;
      }
      const green = shippedColor;
      // Note that the newest work keeps landing while the scrubber stands at now, the newest most often.
      nextLaunch -= delta;
      if (live && shown && nextLaunch <= 0 && spots.length > 0 && launches.length < LAUNCHES) {
        nextLaunch = 2.2 + random() * 2;
        const newest = spots.reduce((latest, spot) => Math.max(latest, spot.entry.mergedAt), 0);
        const recent = spots.filter((spot) => newest - spot.entry.mergedAt < 3 * 3.6e6);
        const pool = recent.length > 0 ? recent : spots;
        const spot = pool[Math.floor(Math.sqrt(random()) * pool.length)];
        if (spot !== undefined) {
          const ground = spot.district === undefined ? new Vector3() : groundOf(spot.district);
          const out = new Vector3(spot.at.x - ground.x, 0, spot.at.z - ground.z);
          if (out.lengthSq() < 0.01) out.set(1, 0, 0);
          out.normalize();
          const reach =
            spot.district === undefined
              ? CITY.DOME_RADIUS + 20
              : (spot.district.kind === DISTRICT_KIND.CRYSTAL
                  ? CITY.DOME_RADIUS
                  : spot.district.radius) + 12;
          launches.push({
            from: ground.clone().addScaledVector(out, reach).setY(2),
            to: spot.at.clone().setY(spot.at.y + 0.8),
            district: spot.district,
            startedAt: elapsed,
            at: new Vector3(),
          });
        }
      }
      for (let index = launches.length - 1; index >= 0; index -= 1) {
        const launch = launches[index];
        if (launch === undefined) continue;
        const k = (elapsed - launch.startedAt) / 1.5;
        if (k >= 1) {
          launches.splice(index, 1);
          pings.send(launch.to, launch.to.y + 0.4, 14, green, 2.2, elapsed);
          lastLanding = elapsed;
          for (let mote = 0; mote < 18; mote += 1) {
            const angle = random() * TAU;
            const speed = 1 + random() * 3;
            particles.spawn(
              PARTICLE_KIND.PLANKTON,
              PARTICLE_LAYER.SHIPPED,
              at.copy(launch.to).setY(launch.to.y + 1),
              velocity.set(Math.cos(angle) * speed, 2 + random() * 5, Math.sin(angle) * speed),
              3 + random() * 2.5,
              0.3 + random() * 0.35,
              green,
              1,
            );
          }
          if (launch.district !== undefined) {
            districts.flash(launch.district, elapsed);
            const slot = beaconSlots.indexOf(launch.district);
            if (slot >= 0) {
              beaconLook.setY(slot, elapsed);
              beaconLook.needsUpdate = true;
            }
          }
          continue;
        }
        const e = easeInOut(k);
        const peak = Math.max(launch.from.y, launch.to.y) + 14;
        const w = 1 - e;
        launch.at
          .copy(launch.from)
          .multiplyScalar(w * w)
          .addScaledVector(at.lerpVectors(launch.from, launch.to, 0.5).setY(peak), 2 * e * w)
          .addScaledVector(launch.to, e * e);
        if (random() < delta * 18) {
          particles.spawn(
            PARTICLE_KIND.PLANKTON,
            PARTICLE_LAYER.SHIPPED,
            launch.at,
            velocity.set(random() * 0.6 - 0.3, -0.4, random() * 0.6 - 0.3),
            1.2,
            0.3 + random() * 0.25,
            green,
            0.9,
          );
        }
      }
    },
    paint: (glows) => {
      if (!shown) return;
      for (const launch of launches) {
        glows.push(
          launch.at.x,
          launch.at.y,
          launch.at.z,
          3.2,
          shippedColor.r * 2,
          shippedColor.g * 2,
          shippedColor.b * 2,
          1,
        );
      }
    },
  };
}
