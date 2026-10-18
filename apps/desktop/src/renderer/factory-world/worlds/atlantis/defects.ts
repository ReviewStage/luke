import { FACTORY_WORLD_BOUNDS, type FactoryDefect } from "@luke/features/factory-world-wire";
import { PICK_KIND, type PickTarget, type WorldPicking } from "@luke/panel/factory-world/world";
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Quaternion,
  type Scene,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { CITY, type CityLayout, type District } from "./city";
import {
  clamp,
  fractalNoise,
  instancedAttribute,
  lerp,
  merged,
  seededRandom,
  taperedTube,
  unitHashOf,
} from "./geometry";
import { type Sea, TAU } from "./sea";
import { type Billboards, PARTICLE_KIND, PARTICLE_LAYER, type Particles } from "./sprites";

/**
 * defects.ts -- the defects as Atlantis draws them: damage. A crack of red light splits the glass of the zone a defect is placed on, or the rock of a reef, bubbles leak from it, ink clouds the water round it, the zone's ring flickers red, and at the worst breach in any dome a kraken has its tentacles round the glass.
 *
 * A crack is one of four shapes made once (a large and a small on a dome,
 * a large and a small across a reef), turned on its shell to where the
 * defect strikes it, so every crack is an instance. Its size is how many
 * events the defect reached. The kraken is made once at the great dome's
 * scale and moved and scaled to whichever dome is worst hurt. Nothing
 * reports a defect yet, so all of this waits for the first.
 */

const DEFECTS = FACTORY_WORLD_BOUNDS.MAX_DEFECTS;

/** Where a canonical crack strikes its unit shell: this far up from the floor, in radians. */
const STRIKE = 0.55;

/** Events past which a crack is drawn large. */
const LARGE_AT = 20;

/** Ink clouds round the breaches and the kraken, at most. */
const INK = 400;

/** The defects, drawn. */
export interface Defects {
  /** Draws `defects` on `layout`'s districts, `chosen` in the selection's colour; or hides them. */
  readonly draw: (
    layout: CityLayout,
    defects: readonly FactoryDefect[],
    chosen: (id: string) => boolean,
    shown: boolean,
  ) => void;
  /** Breathes the kraken and leaks the breaches, at `elapsed`. */
  readonly step: (delta: number, elapsed: number, particles: Particles) => void;
  readonly paint: (glows: Billboards, inks: Billboards, elapsed: number) => void;
}

const CRACK_VERTEX = /* glsl */ `
attribute vec4 aCrack;
varying vec2 vUv; varying float vDepth; varying vec4 vCrack;
void main(){ vUv = uv; vCrack = aCrack; vec4 mv = viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`;

const CRACK_FRAGMENT = /* glsl */ `
varying vec2 vUv; varying float vDepth; varying vec4 vCrack;
void main(){
  float seed = vCrack.w;
  float flick = mix(1.0, 0.75 + 0.25*sin(uTime*13.0 + vUv.x*30.0 + seed) * sin(uTime*7.0 + seed*3.0), uMotion);
  float core = exp(-pow((fract(vUv.y)-0.5)*3.0, 2.0));
  vec3 c = mix(vCrack.rgb, vec3(1.0,0.7,0.6), core*0.35)*(1.5*flick);
  gl_FragColor = vec4(c*(1.0-fogF(vDepth)*0.8), 1.0);
}`;

/** A crack's branching lines over a unit shell, struck at `STRIKE` above the +x axis, or across a unit disc where `flat`. */
function crackGeometry(size: number, seed: number, flat: boolean): BufferGeometry {
  const random = seededRandom(seed);
  const lines: { points: Vector3[]; depth: number }[] = [];
  const onShell = (theta: number, phi: number) =>
    flat
      ? new Vector3(phi * Math.cos(theta), 0, phi * Math.sin(theta))
      : new Vector3(
          Math.cos(phi) * Math.cos(theta),
          Math.sin(phi),
          Math.cos(phi) * Math.sin(theta),
        ).multiplyScalar(1.004);
  const walk = (theta: number, phi: number, heading: number, length: number, depth: number) => {
    const points = [onShell(theta, phi)];
    const steps = Math.max(3, Math.round(length / 0.03));
    const stride = length / steps;
    let t = theta;
    let p = phi;
    let h = heading;
    for (let step = 0; step < steps; step += 1) {
      h += (random() - 0.5) * 1.1;
      if (flat) {
        const x = p * Math.cos(t) + Math.cos(h) * stride;
        const z = p * Math.sin(t) + Math.sin(h) * stride;
        t = Math.atan2(z, x);
        p = clamp(Math.hypot(x, z), 0, 0.95);
      } else {
        t += (Math.cos(h) * stride) / Math.max(Math.cos(p), 0.2);
        p = clamp(p + Math.sin(h) * stride, 0.04, 1.45);
      }
      points.push(onShell(t, p));
      if (depth < 2 && random() < 0.28) {
        walk(
          t,
          p,
          h + (random() < 0.5 ? 1 : -1) * (0.7 + random() * 0.6),
          length * (0.3 + random() * 0.3),
          depth + 1,
        );
      }
    }
    lines.push({ points, depth });
  };
  const heading = random() * TAU;
  const theta = 0;
  const phi = flat ? 0 : STRIKE;
  walk(theta, phi, heading, size * 0.55, 0);
  walk(theta, phi, heading + Math.PI, size * 0.45, 0);
  const width = (flat ? 0.02 : 0.009) * (size > 0.5 ? 1.4 : 1);
  return merged(
    lines
      .filter((line) => line.points.length >= 2)
      .map(
        (line) =>
          new TubeGeometry(
            new CatmullRomCurve3(line.points),
            line.points.length * 3,
            width * (1 - line.depth * 0.3),
            5,
          ),
      ),
    ["position", "uv"],
  );
}

/** The kraken as made: the whole of it, its mantle that breathes, its eyes that blink, and where its ink hangs. */
interface Kraken {
  readonly group: Group;
  readonly mantle: Mesh;
  readonly eyes: Group[];
  readonly inks: Vector3[];
}

/** The kraken, made at the great dome's scale with its breach at bearing 0: a mantle, two eyes, five tentacles hugging the glass towards the breach and five reaching free. */
function krakenOf(sea: Sea): Kraken {
  const great = CITY.DOME_RADIUS;
  const floor = CITY.DOME_FLOOR;
  const random = seededRandom(1717);
  const group = new Group();
  const body = new Group();
  const bodyBearing = -0.85;
  const bodyAt = new Vector3(Math.cos(bodyBearing) * 72, -1.5, Math.sin(bodyBearing) * 72);
  body.position.copy(bodyAt);
  body.rotation.y = Math.atan2(-bodyAt.x, -bodyAt.z);
  group.add(body);
  const skin = sea.standard(
    { color: "#1c0612", roughness: 0.42, metalness: 0.15 },
    { caustic: 0.5, kraken: true },
  );
  const profile = [
    [0, -0.2],
    [0.62, -0.1],
    [0.92, 0.35],
    [1, 0.8],
    [0.86, 1.4],
    [0.6, 2],
    [0.34, 2.55],
    [0.12, 2.95],
    [0, 3.05],
  ].map(([r, y]) => new Vector2(r, y));
  const mantleShape = new LatheGeometry(profile, 48).toNonIndexed();
  const position = mantleShape.getAttribute("position");
  const point = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const k = 1 + (fractalNoise(point.x * 1.8 + 3, point.y * 1.4 + point.z * 1.8, 3) - 0.5) * 0.22;
    position.setXYZ(index, point.x * k, point.y, point.z * k * 0.9);
  }
  mantleShape.computeVertexNormals();
  const mantle = new Mesh(mantleShape, skin);
  mantle.scale.set(8.5, 9.5, 8.5);
  mantle.position.set(0, 1.5, -5);
  mantle.rotation.x = -0.62;
  body.add(mantle);
  const eyeMaterial = new MeshBasicMaterial({ color: new Color("#ffc828").multiplyScalar(3) });
  const pupilMaterial = new MeshBasicMaterial({ color: "#0a0003" });
  const eyes = [-1, 1].map((side) => {
    const eye = new Group();
    eye.position.set(side * 6, 6.2, 1.2);
    const pupil = new Mesh(new BoxGeometry(0.45, 2.6, 0.5), pupilMaterial);
    pupil.position.z = 1.5;
    const brow = new Mesh(new SphereGeometry(2.1, 20, 12, 0, TAU, 0, Math.PI * 0.42), skin);
    brow.rotation.x = 0.5;
    brow.position.set(0, 0.25, -0.2);
    eye.add(new Mesh(new SphereGeometry(1.7, 24, 16), eyeMaterial), pupil, brow);
    eye.rotation.y = side * 0.4;
    body.add(eye);
    return eye;
  });
  group.updateMatrixWorld(true);
  const rootOf = (side: number) => body.localToWorld(new Vector3(side * 4.2, 1.2, 3));
  const onDome = (theta: number, phi: number, lift: number) =>
    new Vector3(Math.cos(phi) * Math.cos(theta), 0, Math.cos(phi) * Math.sin(theta))
      .multiplyScalar(great + lift)
      .setY(floor + Math.sin(phi) * (great + lift));
  const hugging = sea.standard(
    { color: "#3a0c22", roughness: 0.45, metalness: 0.1 },
    { caustic: 0.6, tentacle: 1 },
  );
  const reaching = sea.standard(
    { color: "#3a0c22", roughness: 0.45, metalness: 0.1 },
    { caustic: 0.6, tentacle: 3 },
  );
  const hugs: BufferGeometry[] = [];
  (
    [
      [-0.14, 0.6, -1.2],
      [-0.02, 0.9, -0.4],
      [0.12, 0.7, 0.4],
      [0.24, 0.42, 1.1],
      [0.36, 0.22, 1.7],
    ] as const
  ).forEach(([reach, rise, side], index) => {
    const root = rootOf(side * 0.8);
    const points = [
      root,
      root
        .clone()
        .lerp(onDome(bodyBearing - 0.05, 0.05, 2), 0.55)
        .setY(3),
    ];
    for (let step = 0; step <= 6; step += 1) {
      const u = step / 6;
      points.push(onDome(lerp(bodyBearing - 0.06, reach, u), lerp(0.08, rise, u), 1.2));
    }
    hugs.push(taperedTube(new CatmullRomCurve3(points), 110, 12, 2.3, 0.22, index * 1.7));
  });
  const reaches: BufferGeometry[] = [];
  (
    [
      [-1, 1],
      [1, -1],
      [-0.6, 1.4],
      [0.7, -1.3],
      [-1.3, -0.6],
    ] as const
  ).forEach(([side, swing], index) => {
    const root = rootOf(side);
    const out = body.localToWorld(new Vector3(side * 14, 2 + index * 3, 10 + index * 2));
    const high = body.localToWorld(
      new Vector3(side * 16 + swing * 4, 12 + index * 6, 4 + index * 3),
    );
    const curl = body.localToWorld(new Vector3(side * 12 + swing * 6, 20 + index * 5, -2));
    const points = [root, root.clone().lerp(out, 0.5).setY(1.5), out, high, curl];
    reaches.push(taperedTube(new CatmullRomCurve3(points), 90, 12, 2, 0.18, 3 + index * 2.1));
  });
  const keep = ["position", "normal", "uv", "aU", "aPh"];
  group.add(new Mesh(merged(hugs, keep), hugging), new Mesh(merged(reaches, keep), reaching));
  for (const child of [mantle, ...group.children]) child.castShadow = child instanceof Mesh;
  const inks = Array.from({ length: 18 }, () =>
    body.localToWorld(new Vector3(random() * 28 - 14, 2 + random() * 20, random() * 22 - 14)),
  );
  return { group, mantle, eyes, inks };
}

/** One defect's crack as placed. */
interface Crack {
  readonly defect: FactoryDefect;
  readonly district: District | undefined;
  /** Where it strikes, in the scene. */
  readonly origin: Vector3;
  /** Its shell's outward normal there. */
  readonly normal: Vector3;
}

/** One cloud of ink, drifting about where it was set. */
interface Ink {
  readonly at: Vector3;
  readonly size: number;
  readonly turn: number;
  readonly spin: number;
  readonly seed: number;
  readonly phase: number;
}

/** The defects in `scene`, picked through `picking`. */
export function defectsOf(scene: Scene, sea: Sea, picking: WorldPicking): Defects {
  const defectColor = new Color(sea.signal.DEFECT);
  const selection = new Color(sea.signal.SELECTION);
  const shapes = [
    crackGeometry(0.9, 11, false),
    crackGeometry(0.4, 23, false),
    crackGeometry(1.4, 37, true),
    crackGeometry(0.7, 41, true),
  ];
  const crackMaterial = sea.shader({}, CRACK_VERTEX, CRACK_FRAGMENT, {
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const cracks = shapes.map((shape) => {
    const look = instancedAttribute(shape, "aCrack", 4, DEFECTS);
    const mesh = new InstancedMesh(shape, crackMaterial, DEFECTS);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    scene.add(mesh);
    return { mesh, look };
  });
  const proxies = new InstancedMesh(
    new IcosahedronGeometry(1, 1),
    new MeshBasicMaterial({ visible: false }),
    DEFECTS,
  );
  proxies.count = 0;
  proxies.frustumCulled = false;
  scene.add(proxies);
  let crackTargets: PickTarget[] = [];
  picking.addInstances(proxies, (instanceId) => crackTargets[instanceId]);

  const kraken = krakenOf(sea);
  kraken.group.visible = false;
  scene.add(kraken.group);
  let releaseKraken: (() => void) | undefined;
  const breachLight = new PointLight(sea.signal.DEFECT, 0, 80, 1);
  scene.add(breachLight);

  let placed: Crack[] = [];
  let inks: Ink[] = [];
  let shown = true;
  let krakenChosen = false;
  let pokedAt = -1e9;
  let lastElapsed = 0;
  const random = seededRandom(404);
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const tilt = new Quaternion();
  const size = new Vector3();
  const at = new Vector3();
  const up = new Vector3(0, 1, 0);
  const forward = new Vector3(0, 0, 1);
  const drift = new Vector3();

  return {
    draw: (layout, defects, chosen, visible) => {
      shown = visible;
      const slots = cracks.map(() => 0);
      placed = [];
      const onZone = new Map<District | undefined, number>();
      for (const defect of defects.slice(0, DEFECTS)) {
        const district = defect.zonePaths
          .map((path) => layout.byPath.get(path))
          .find((found) => found !== undefined);
        const nth = onZone.get(district) ?? 0;
        onZone.set(district, nth + 1);
        const large = defect.events >= LARGE_AT;
        const flat = district !== undefined && district.shell === undefined;
        const kind = (flat ? 2 : 0) + (large ? 0 : 1);
        const crack = cracks[kind];
        if (crack === undefined) continue;
        const slot = slots[kind] ?? 0;
        slots[kind] = slot + 1;
        const hash = unitHashOf(defect.id);
        const spread = (nth % 2 === 1 ? 1 : -1) * (nth === 0 ? 0 : 0.35 + nth * 0.22);
        let origin: Vector3;
        let normal: Vector3;
        if (district?.shell !== undefined) {
          const shell = district.shell;
          const theta =
            district.bearing + (district.kind === "crystal" ? 0 : Math.PI * 0.85) + spread;
          const phi = nth === 0 ? STRIKE : 0.25 + hash * 0.6;
          turn.setFromAxisAngle(up, -theta).multiply(tilt.setFromAxisAngle(forward, phi - STRIKE));
          matrix.compose(shell.centre, turn, size.setScalar(shell.radius));
          normal = new Vector3(
            Math.cos(phi) * Math.cos(theta),
            Math.sin(phi),
            Math.cos(phi) * Math.sin(theta),
          );
          origin = shell.centre.clone().addScaledVector(normal, shell.radius);
        } else {
          const centre =
            district?.centre ??
            new Vector3(Math.cos(hash * TAU), 0, Math.sin(hash * TAU)).multiplyScalar(
              CITY.DOME_RADIUS + 22,
            );
          const base = district?.base ?? 0.2;
          const reach = (district?.radius ?? 6) * 0.8;
          const off = nth === 0 ? 0 : reach * 0.4;
          origin = new Vector3(
            centre.x + Math.cos(spread * 3) * off,
            base + 0.05,
            centre.z + Math.sin(spread * 3) * off,
          );
          normal = new Vector3(0, 1, 0);
          matrix.compose(origin, turn.setFromAxisAngle(up, hash * TAU), size.set(reach, 1, reach));
        }
        crack.mesh.setMatrixAt(slot, matrix);
        const tint = chosen(defect.id) ? selection : defectColor;
        crack.look.setXYZW(slot, tint.r, tint.g, tint.b, hash * 50);
        placed.push({ defect, district, origin, normal });
      }
      cracks.forEach((crack, kind) => {
        crack.mesh.count = shown ? (slots[kind] ?? 0) : 0;
        crack.mesh.instanceMatrix.needsUpdate = true;
        crack.look.needsUpdate = true;
      });
      crackTargets = placed.map((crack) => ({ kind: PICK_KIND.DEFECT, id: crack.defect.id }));
      placed.forEach((crack, index) => {
        matrix.compose(
          crack.origin,
          turn.identity(),
          size.setScalar(1.5 + Math.sqrt(crack.defect.events) * 0.4),
        );
        proxies.setMatrixAt(index, matrix);
      });
      proxies.count = shown ? placed.length : 0;
      proxies.instanceMatrix.needsUpdate = true;

      // Note that ink gathers round each hurt zone's first breach, the more events the more of it.
      inks = [];
      const totals = new Map<District | undefined, { first: Crack; events: number }>();
      for (const crack of placed) {
        const total = totals.get(crack.district);
        totals.set(crack.district, {
          first: total?.first ?? crack,
          events: (total?.events ?? 0) + crack.defect.events,
        });
      }
      for (const { first, events } of totals.values()) {
        const spread = 5 + Math.sqrt(events) * 1.6;
        const clouds = Math.round(5 + Math.sqrt(events) * 4.5);
        const stream = seededRandom(Math.floor(unitHashOf(first.defect.id) * 1e6));
        for (let cloud = 0; cloud < clouds && inks.length < INK - 18; cloud += 1) {
          const point = first.origin
            .clone()
            .addScaledVector(first.normal, 1 + stream() * spread * 0.6)
            .add(
              new Vector3(stream() * 2 - 1, stream() * 1.4 - 0.4, stream() * 2 - 1).multiplyScalar(
                spread,
              ),
            );
          point.y = Math.max(point.y, 1.5);
          inks.push({
            at: point,
            size: 5 + stream() * 4 + Math.sqrt(events) * (0.4 + stream() * 0.9),
            turn: stream() * TAU,
            spin: stream() * 0.2 - 0.1,
            seed: stream(),
            phase: stream() * TAU,
          });
        }
      }

      // Note that the kraken comes for the worst breach in any dome's glass, and only there.
      const worst = placed
        .filter((crack) => crack.district?.shell !== undefined)
        .reduce<Crack | undefined>(
          (most, crack) =>
            most === undefined || crack.defect.events > most.defect.events ? crack : most,
          undefined,
        );
      releaseKraken?.();
      releaseKraken = undefined;
      kraken.group.visible = shown && worst !== undefined;
      breachLight.intensity = kraken.group.visible ? 45 : 0;
      if (worst?.district?.shell !== undefined) {
        const shell = worst.district.shell;
        const theta = Math.atan2(worst.normal.z, worst.normal.x);
        kraken.group.position
          .copy(shell.centre)
          .setY(shell.centre.y - CITY.DOME_FLOOR * (shell.radius / CITY.DOME_RADIUS));
        kraken.group.rotation.set(0, -theta, 0);
        kraken.group.scale.setScalar(Math.max(0.3, shell.radius / CITY.DOME_RADIUS));
        kraken.group.updateMatrixWorld(true);
        breachLight.position.copy(worst.origin).addScaledVector(worst.normal, 4);
        const chose = chosen(worst.defect.id);
        if (chose && !krakenChosen) pokedAt = lastElapsed;
        krakenChosen = chose;
        releaseKraken = picking.add(kraken.group, { kind: PICK_KIND.DEFECT, id: worst.defect.id });
        for (const ink of kraken.inks) {
          if (inks.length >= INK) break;
          const point = kraken.group.localToWorld(ink.clone());
          inks.push({
            at: point,
            size: 8 + random() * 10,
            turn: random() * TAU,
            spin: random() * 0.16 - 0.08,
            seed: random(),
            phase: random() * TAU,
          });
        }
      }
    },
    step: (delta, elapsed, particles) => {
      lastElapsed = elapsed;
      const breathe = Math.sin(elapsed * 0.6);
      kraken.mantle.scale.set(8.5 * (1 - breathe * 0.025), 9.5 * (1 + breathe * 0.04), 8.5);
      const poke = Math.exp(-(elapsed - pokedAt) * 1.2);
      sea.uniforms.uKrakenSway.value = 1 + poke * 2.2;
      const blink = Math.sin(elapsed * 0.37) > -0.96 ? 1 : 0.1;
      for (const eye of kraken.eyes)
        eye.scale.set(1 + poke * 0.5, blink * (1 + poke * 0.5), 1 + poke * 0.5);
      if (!shown) return;
      for (const crack of placed) {
        const rate = 1.5 + crack.defect.events * 0.55;
        if (random() >= delta * rate) continue;
        const large = crack.defect.events > LARGE_AT;
        particles.spawn(
          PARTICLE_KIND.BUBBLE,
          PARTICLE_LAYER.DEFECTS,
          at.copy(crack.origin).add(drift.set(random() - 0.5, 0, random() - 0.5)),
          drift.set((random() - 0.5) * 1.2, 1.5 + random() * 2, (random() - 0.5) * 1.2),
          7 + random() * 5,
          (large ? 0.45 : 0.25) + random() * (large ? 1 : 0.4),
          new Color("#bff6ff"),
          1,
        );
      }
    },
    paint: (glows, inkSprites, elapsed) => {
      if (!shown) return;
      const [inkRed, inkGreen, inkBlue] = sea.mood().ink;
      for (const crack of placed) {
        const k = 0.7 + 0.3 * Math.sin(elapsed * 7 + crack.origin.x);
        const glowAt = crack.origin.clone().addScaledVector(crack.normal, 0.6);
        glows.push(
          glowAt.x,
          glowAt.y,
          glowAt.z,
          3 + Math.sqrt(crack.defect.events) * 2.2,
          defectColor.r * 2.2 * k,
          defectColor.g * 2.2 * k,
          defectColor.b * 2.2 * k,
          1,
        );
      }
      if (kraken.group.visible) {
        const blink = Math.sin(elapsed * 0.37) > -0.96 ? 1 : 0;
        for (const eye of kraken.eyes) {
          const point = eye.localToWorld(at.set(0, 0, 1.8));
          glows.push(
            point.x,
            point.y,
            point.z,
            9 * kraken.group.scale.x,
            1.6 * blink,
            1.0 * blink,
            0.16 * blink,
            1,
          );
        }
      }
      for (const ink of inks) {
        inkSprites.push(
          ink.at.x + Math.sin(elapsed * 0.13 + ink.phase) * 2.5,
          ink.at.y + Math.sin(elapsed * 0.09 + ink.phase * 2) * 1.5,
          ink.at.z + Math.cos(elapsed * 0.11 + ink.phase) * 2.5,
          ink.size * (1 + 0.08 * Math.sin(elapsed * 0.4 + ink.phase)),
          inkRed,
          inkGreen,
          inkBlue,
          ink.seed,
          ink.turn + elapsed * ink.spin,
        );
      }
    },
  };
}
