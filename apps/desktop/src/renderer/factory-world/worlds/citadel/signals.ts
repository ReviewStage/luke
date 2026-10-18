import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import {
  PICK_KIND,
  type PickTarget,
  type WorldPalette,
  type WorldPicking,
  type WorldPoint,
} from "@luke/panel/factory-world/world";
import { type TimelineEntry, ZONE_LAYER } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Points,
  RingGeometry,
  ShaderMaterial,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ZoneSite } from "./layout";
import { HUE } from "./materials";
import { clamp, placed, polar, seeded } from "./math";
import { groundAt, HILL } from "./terrain";

/**
 * signals.ts -- the signals every world draws, in the Citadel's dress: the blast radius as beacons of light rising round the zones the selected agent's work ripples to, step by step outward; shipped work as a torch for every merged pull request where it landed, a lantern over every zone alive with merges, and fireworks over the freshest; and the selection's ring.
 *
 * Each signal is drawn in its colour from the shared palette, unchanged;
 * what is the Citadel's own is the shape it takes.
 */

const MAX_ZONES = FACTORY_WORLD_BOUNDS.MAX_ZONES;
/** A merged pull request lights a torch at each zone it landed in, up to this many in all. */
const MAX_TORCHES = 640;
const ROCKETS = 4;
const SPARKS_PER_ROCKET = 110;

/** How long a beacon waits, a step further out, before it lights: the ripple's pace. */
const RIPPLE_STEP_SECONDS = 0.32;

/** The beacons: an open drum of banded light round each zone, its strength and its delay per instance. */
function beaconMesh() {
  const geometry = new CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
  const state = new InstancedBufferAttribute(new Float32Array(MAX_ZONES * 3), 3);
  geometry.setAttribute("aBeacon", state);
  const since = { value: 1000 };
  const time = { value: 0 };
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uSince: since, uTime: time },
    vertexShader: `attribute vec3 aBeacon; uniform float uSince; varying vec2 vUv; varying float vStrength; varying float vHot; varying vec3 vColor;
      void main(){
        vUv = uv;
        vStrength = aBeacon.x * smoothstep(aBeacon.z, aBeacon.z + 0.45, uSince);
        vHot = aBeacon.y;
        vColor = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0) * step(0.002, vStrength);
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vStrength; varying float vHot; varying vec3 vColor;
      void main(){
        float fade = pow(1.0 - vUv.y, 1.2);
        float bands = 0.6 + 0.4 * sin(vUv.y * 22.0 - uTime * 6.0);
        float foot = smoothstep(0.1, 0.0, vUv.y) * 1.4;
        vec3 color = mix(vColor, vec3(1.0), vHot * 0.3 * foot);
        float a = clamp((fade * bands * 1.25 + foot) * vStrength, 0.0, 0.9);
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new InstancedMesh(geometry, material, MAX_ZONES);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  mesh.setColorAt(0, new Color("#ffffff"));
  mesh.count = 0;
  return { mesh, state, since, time };
}

/** A torch: its pole and iron cup as one geometry, painted per vertex. */
function torchGeometry(): BufferGeometry {
  const paint = (geometry: BufferGeometry, hex: string) => {
    const flat = geometry.toNonIndexed();
    const color = new Color(hex);
    const colors = new Float32Array(flat.getAttribute("position").count * 3);
    for (let at = 0; at < colors.length; at += 3) color.toArray(colors, at);
    flat.setAttribute("color", new BufferAttribute(colors, 3));
    flat.deleteAttribute("uv");
    return flat;
  };
  return mergeGeometries([
    paint(new CylinderGeometry(0.05, 0.07, 0.9, 5).translate(0, 0.45, 0), HUE.WOOD),
    paint(new CylinderGeometry(0.16, 0.08, 0.2, 6).translate(0, 0.95, 0), HUE.IRON),
  ]);
}

/** The glows: soft additive points for the torches' halos and the zones' lanterns, flickering by their own seeds. */
function glowPoints(capacity: number, fogDensity: { value: number }, pixels: { value: number }) {
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(new Float32Array(capacity * 3), 3);
  const look = new Float32BufferAttribute(new Float32Array(capacity * 4), 4);
  const color = new Float32BufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aLook", look);
  geometry.setAttribute("color", color);
  geometry.setDrawRange(0, 0);
  const time = { value: 0 };
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: time, uFogDensity: fogDensity, uPixels: pixels },
    vertexShader: `attribute vec4 aLook; attribute vec3 color; uniform float uTime, uPixels; varying vec3 vColor; varying float vBright; varying float vFog;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float flicker = 1.0 + aLook.z * (0.12 * sin(uTime * 9.0 + aLook.w * 13.0) + 0.08 * sin(uTime * 23.0 + aLook.w * 7.0));
        float pulse = 1.0 + 0.06 * sin(uTime * 2.0 + aLook.w);
        gl_PointSize = aLook.x * flicker * pulse * projectionMatrix[1][1] * uPixels / -mv.z;
        vColor = color; vBright = aLook.y; vFog = -mv.z;
      }`,
    fragmentShader: `uniform float uFogDensity; varying vec3 vColor; varying float vBright; varying float vFog;
      void main(){
        float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        float halo = pow(smoothstep(0.5, 0.0, d), 2.2); float core = smoothstep(0.12, 0.0, d);
        float fog = exp(-uFogDensity * uFogDensity * vFog * vFog);
        gl_FragColor = vec4(mix(vColor, vec3(1.0, 0.98, 0.92), core * 0.6) * vBright * (halo * 0.9 + core * 1.3) * fog, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 7;
  return { points, position, look, color, time };
}

/** The fireworks: a few rockets at a time over the zones freshest with merges, each spark a point placed by the shader from its rocket's launch. */
function fireworkPoints(pixels: { value: number }) {
  const count = ROCKETS * SPARKS_PER_ROCKET;
  const geometry = new BufferGeometry();
  const random = seeded(4242);
  const direction = new Float32Array(count * 4);
  const slot = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const u = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    direction.set([Math.cos(angle) * s, u, Math.sin(angle) * s, 0.85 + random() * 0.3], index * 4);
    slot[index] = Math.floor(index / SPARKS_PER_ROCKET);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aDirection", new Float32BufferAttribute(direction, 4));
  geometry.setAttribute("aSlot", new Float32BufferAttribute(slot, 1));
  const launches = { value: Array.from({ length: ROCKETS }, () => [0, 0, 0, -1]).flat() };
  const color = { value: new Color() };
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uLaunch: launches, uColor: color, uPixels: pixels },
    vertexShader: `attribute vec4 aDirection; attribute float aSlot; uniform float uPixels; uniform float uLaunch[${ROCKETS * 4}]; varying float vAlpha; varying float vWhite;
      void main(){
        int at = int(aSlot + 0.5) * 4;
        vec3 origin = vec3(uLaunch[at], uLaunch[at + 1], uLaunch[at + 2]);
        float age = uLaunch[at + 3];
        float rise = 0.9;
        vec3 p = origin;
        float alpha = 0.0;
        float size = 0.0;
        if (age >= 0.0 && age < rise) {
          float trail = fract(aDirection.w * 7.0) * 0.25;
          float t = max(0.0, age - trail);
          p.y += 19.0 * t - 3.0 * t * t;
          alpha = step(0.97, aDirection.w) * (1.0 - trail * 3.0);
          size = 0.35;
        } else if (age >= rise) {
          float t = age - rise;
          vec3 burst = origin + vec3(0.0, 19.0 * rise - 3.0 * rise * rise, 0.0);
          p = burst + aDirection.xyz * 10.5 * aDirection.w * (1.0 - exp(-1.6 * t)) / 1.6 + vec3(0.0, 1.0 * t - 2.1 * t * t, 0.0);
          float life = clamp(1.0 - t / (1.7 + aDirection.w * 0.8), 0.0, 1.0);
          alpha = life * life;
          size = 0.7 + aDirection.w * 0.25;
        }
        vAlpha = alpha; vWhite = step(0.66, fract(aDirection.w * 31.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * projectionMatrix[1][1] * uPixels / -mv.z * step(0.001, alpha);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vAlpha; varying float vWhite;
      void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float s = smoothstep(0.5, 0.0, d);
        vec3 c = mix(uColor, vec3(1.0, 0.96, 0.85), vWhite * 0.6);
        gl_FragColor = vec4(c * (s * s * 3.0 + smoothstep(0.18, 0.0, d) * 4.0), vAlpha * s);
        #include <colorspace_fragment>
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 8;
  return { points, launches, color };
}

/** The age a torch burns at: brightest the hour it merged, settling to a steady flame over a few hours. */
function torchGlowOf(mergedAt: number, now: number): number {
  return now < mergedAt ? 0 : 0.35 + 0.65 * Math.exp(-(now - mergedAt) / (2.6 * 3600 * 1000));
}

/** The signals as the world draws them. */
export interface Signals {
  readonly meshes: readonly (InstancedMesh | Points)[];
  /** Sets the blast radius and the chosen zones' beacons: the ripple starts over when the blast changes. */
  readonly beacon: (
    sites: readonly ZoneSite[],
    blast: ReadonlyMap<string, number>,
    chosen: (target: PickTarget) => boolean,
    rippleFrom: number,
  ) => void;
  /** Lights a torch for each merged pull request where it landed, and a lantern over each zone alive with merges. */
  readonly ship: (
    timeline: readonly TimelineEntry[],
    sites: ReadonlyMap<string, ZoneSite>,
    now: number,
    shown: boolean,
    chosen: (target: PickTarget) => boolean,
    gates: readonly number[],
  ) => void;
  /** Rings the chosen and the hovered at the floor. */
  readonly ring: (spots: readonly (WorldPoint & { readonly size: number })[]) => void;
  /** Steps the beacons' bands and their ripple, `since` seconds after the blast changed, the flames' flicker, and the fireworks. */
  readonly step: (elapsed: number, fireworks: boolean, since: number) => void;
  /** Where a merged pull request's first torch stands. */
  readonly spotOf: (url: string) => (WorldPoint & { readonly size: number }) | undefined;
}

export function buildSignals(
  palette: WorldPalette,
  picking: WorldPicking,
  fogDensity: { value: number },
  pixels: { value: number },
): Signals {
  const beacons = beaconMesh();
  const bodies = new InstancedMesh(
    torchGeometry(),
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    MAX_TORCHES,
  );
  bodies.castShadow = true;
  bodies.count = 0;
  const flames = new InstancedMesh(
    new OctahedronGeometry(0.2).scale(1, 1.7, 1),
    new MeshBasicMaterial(),
    MAX_TORCHES,
  );
  flames.setColorAt(0, new Color(palette.signal.SHIPPED));
  flames.count = 0;
  const glows = glowPoints(MAX_TORCHES + MAX_ZONES, fogDensity, pixels);
  const fireworks = fireworkPoints(pixels);
  fireworks.color.value.set(palette.signal.SHIPPED);
  const rings = new InstancedMesh(
    new RingGeometry(0.62, 0.8, 40).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      color: palette.signal.SELECTION,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: DoubleSide,
    }),
    2,
  );
  rings.renderOrder = 9;
  rings.count = 0;
  // Note that a torch's pick box stands round its pole and flame together, since both are slight.
  const torchProxies = new InstancedMesh(
    new BoxGeometry(0.9, 1.6, 0.9).translate(0, 0.8, 0),
    new MeshBasicMaterial({ visible: false }),
    MAX_TORCHES,
  );
  torchProxies.count = 0;

  let torchTargets: PickTarget[] = [];
  const torchSpots = new Map<string, WorldPoint>();
  picking.addInstances(torchProxies, (instanceId) => torchTargets[instanceId]);
  picking.addInstances(flames, (instanceId) => torchTargets[instanceId]);
  let freshest: WorldPoint[] = [];
  const matrix = new Matrix4();
  const tint = new Color();
  const white = new Color("#ffffff");

  return {
    meshes: [beacons.mesh, bodies, flames, torchProxies, glows.points, fireworks.points, rings],
    beacon: (sites, blast, chosen, rippleFrom) => {
      beacons.since.value = rippleFrom;
      sites.slice(0, MAX_ZONES).forEach((site, index) => {
        const target = { kind: PICK_KIND.ZONE, id: site.zone.path };
        const distance = blast.get(site.zone.path);
        const picked = chosen(target);
        const radius = site.heart
          ? 5
          : site.layer === ZONE_LAYER.CORE
            ? site.size + 0.9
            : site.layer === ZONE_LAYER.DOMAIN
              ? site.size * 1.3 + 0.8
              : site.layer === ZONE_LAYER.TOOLING
                ? site.size + 2
                : 4.2;
        const foot = site.layer === ZONE_LAYER.SURFACE ? site.base - 1 : site.base - 0.5;
        const height = site.layer === ZONE_LAYER.CORE ? site.top - site.base + 3 : 17;
        const at =
          site.layer === ZONE_LAYER.SURFACE
            ? polar(HILL.OUTER_RADIUS + 0.4, site.angle)
            : ([site.x, site.z] as const);
        beacons.mesh.setMatrixAt(
          index,
          placed(matrix, at[0], foot, at[1], 0, radius, height, radius),
        );
        beacons.mesh.setColorAt(
          index,
          tint.set(picked ? palette.signal.SELECTION : palette.signal.BLAST_RADIUS),
        );
        const strength = picked
          ? 0.75
          : distance === undefined
            ? 0
            : distance === 0
              ? 1
              : clamp(0.85 - distance * 0.08, 0.45, 0.85);
        beacons.state.setXYZ(
          index,
          strength,
          distance === 0 && !picked ? 1 : 0,
          picked ? 0 : (distance ?? 0) * RIPPLE_STEP_SECONDS,
        );
      });
      beacons.mesh.count = Math.min(MAX_ZONES, sites.length);
      beacons.mesh.instanceMatrix.needsUpdate = true;
      if (beacons.mesh.instanceColor !== null) beacons.mesh.instanceColor.needsUpdate = true;
      beacons.state.needsUpdate = true;
    },
    ship: (timeline, sites, now, shown, chosen, gates) => {
      const used = new Map<ZoneSite | undefined, number>();
      const torches: { entry: TimelineEntry; at: WorldPoint }[] = [];
      torchSpots.clear();
      // Note that every merge's first zone gets its torch before any merge's second, so a crowded town still shows every merge.
      const passes = Math.max(1, ...timeline.map((entry) => entry.zonePaths.length));
      for (let pass = 0; pass < passes && torches.length < MAX_TORCHES; pass += 1) {
        for (const entry of timeline) {
          if (torches.length >= MAX_TORCHES) break;
          const path = entry.zonePaths[pass];
          if (pass > 0 && path === undefined) continue;
          const site = path === undefined ? undefined : sites.get(path);
          const k = used.get(site) ?? 0;
          used.set(site, k + 1);
          const at = torchSpot(site, k, gates);
          torches.push({ entry, at });
          if (shown && !torchSpots.has(entry.url)) torchSpots.set(entry.url, at);
        }
      }
      const drawn = shown ? torches : [];
      torchTargets = drawn.map(({ entry }) => ({ kind: PICK_KIND.SHIPPED, id: entry.url }));
      drawn.forEach(({ entry, at }, index) => {
        const glow = torchGlowOf(entry.mergedAt, now);
        const picked = chosen({ kind: PICK_KIND.SHIPPED, id: entry.url });
        bodies.setMatrixAt(index, placed(matrix, at.x, at.y, at.z));
        torchProxies.setMatrixAt(index, matrix);
        flames.setMatrixAt(index, placed(matrix, at.x, at.y + 1.12, at.z));
        flames.setColorAt(
          index,
          tint
            .set(picked ? palette.signal.SELECTION : palette.signal.SHIPPED)
            .lerp(white, picked ? 0.2 : glow * 0.25),
        );
        glows.position.setXYZ(index, at.x, at.y + 1.15, at.z);
        glows.look.setXYZW(
          index,
          picked ? 2.2 : 1.1 + glow * 0.9,
          picked ? 1.3 : 0.55 + glow * 0.6,
          1,
          index * 0.37,
        );
        tint.set(picked ? palette.signal.SELECTION : palette.signal.SHIPPED);
        glows.color.setXYZ(index, tint.r, tint.g, tint.b);
      });
      for (const mesh of [bodies, flames, torchProxies]) {
        mesh.count = drawn.length;
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (flames.instanceColor !== null) flames.instanceColor.needsUpdate = true;
      // Note that a lantern hangs over each zone as alive as its merges make it, larger and brighter the more alive.
      let glowCount = drawn.length;
      freshest = [];
      tint.set(palette.signal.SHIPPED);
      const alive = shown ? [...sites.values()].filter((site) => site.zone.alive > 0.02) : [];
      for (const site of alive) {
        glows.position.setXYZ(glowCount, site.crown.x, site.crown.y + 1.4, site.crown.z);
        glows.look.setXYZW(
          glowCount,
          2.4 + site.zone.alive * 3.6,
          0.3 + site.zone.alive * 0.7,
          0,
          glowCount * 0.61,
        );
        glows.color.setXYZ(glowCount, tint.r, tint.g, tint.b);
        glowCount += 1;
      }
      freshest = [...alive]
        .sort((left, right) => right.zone.alive - left.zone.alive)
        .slice(0, 12)
        .map((site) => site.crown);
      glows.points.geometry.setDrawRange(0, glowCount);
      for (const attribute of [glows.position, glows.look, glows.color])
        attribute.needsUpdate = true;
    },
    ring: (spots) => {
      for (const [index, spot] of spots.slice(0, 2).entries()) {
        rings.setMatrixAt(
          index,
          placed(matrix, spot.x, spot.y + 0.06, spot.z, 0, spot.size, 1, spot.size),
        );
      }
      rings.count = Math.min(2, spots.length);
      rings.instanceMatrix.needsUpdate = true;
    },
    step: (elapsed, show, since) => {
      beacons.time.value = elapsed;
      beacons.since.value = since;
      glows.time.value = elapsed;
      const launches = fireworks.launches.value;
      for (let rocket = 0; rocket < ROCKETS; rocket += 1) {
        const period = 3.4;
        const clock = elapsed + rocket * 0.85;
        const round = Math.floor(clock / period);
        const crown = freshest[(round * 7 + rocket * 3) % Math.max(1, freshest.length)];
        launches[rocket * 4 + 3] = show && crown !== undefined ? clock - round * period : -1;
        if (crown === undefined) continue;
        launches[rocket * 4] = crown.x;
        launches[rocket * 4 + 1] = crown.y + 0.5;
        launches[rocket * 4 + 2] = crown.z;
      }
    },
    spotOf: (url) => {
      const at = torchSpots.get(url);
      return at === undefined ? undefined : { x: at.x, y: at.y, z: at.z, size: 1 };
    },
  };
}

/** Where a zone's `k`th torch stands: in its torch slots, one round after another a step aside; one landed in no zone stands by the main gate. */
function torchSpot(site: ZoneSite | undefined, k: number, gates: readonly number[]): WorldPoint {
  if (site === undefined || site.torches.length === 0) {
    const gate = gates[0] ?? Math.PI / 2;
    const [x, z] = polar(50.2 + (k % 3) * 1.2, gate + ((Math.floor(k / 3) - 4) * 1.1) / 50);
    return { x, y: groundAt(x, z), z };
  }
  const slot = site.torches[k % site.torches.length] ?? site.crown;
  const round = Math.floor(k / site.torches.length);
  return { x: slot.x + round * 0.5, y: slot.y, z: slot.z + round * 0.4 };
}
