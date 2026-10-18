import { FACTORY_WORLD_BOUNDS, type FactoryDefect } from "@luke/features/factory-world-wire";
import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  IcosahedronGeometry,
  InstancedMesh,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  QuadraticBezierCurve3,
  type Scene,
  SphereGeometry,
  Vector3,
} from "three";
import type { PickTarget, WorldPalette, WorldPicking } from "../../world";
import { PICK_KIND } from "../../world";
import type { Effects, SmokeSource } from "./effects";
import type { Isle } from "./islands";
import { hashOf, merged, type Random, randomOf, TAU } from "./kit";
import {
  dashedPath,
  type Puff,
  puffGeometry,
  puffMaterial,
  runningDashes,
  SEA_Y,
  type SkyUniforms,
  setPuffs,
} from "./mood";
import { gateOf } from "./shipped";

/**
 * defects.ts -- the errors a monitor reports, as damage: a storm cell over each defect's zone, lightning striking it, cracks glowing across the island's grass, embers and black smoke rising from them, rock falling away beneath, and a dashed trail of motes running back from the gate to the island it broke, the loop back to planned.
 *
 * A storm is as large as its defect is frequent, and an island's cracks as
 * deep as the defects on it. A defect placed on no zone storms out past the
 * rim. The storms, the cracks, and the trails are built when the defects or
 * the islands change; the lightning, the embers, the smoke, and the falling
 * rock are idle motion, so a still frame says it with the storm, the cracks,
 * and a steady red glow at the worst of them.
 */

const MAX_DEFECTS = FACTORY_WORLD_BOUNDS.MAX_DEFECTS;
const PUFFS_PER_STORM = 51;
const BOLTS = 4;
const BOLT_POINTS = 13;
const DEBRIS = 150;

/** One storm as placed by the last build. */
interface Storm {
  readonly defect: FactoryDefect;
  readonly isle: Isle | undefined;
  readonly centre: Vector3;
  readonly intensity: number;
  readonly spread: number;
  readonly first: number;
  readonly count: number;
  flash: number;
  next: number;
}

/** One island's damage: how deep, from 0 to 1, and the points along its cracks. */
interface Damage {
  readonly isle: Isle;
  readonly intensity: number;
  readonly embers: Vector3[];
  readonly smoke: Vector3[];
}

/** One rock falling from a damaged island, or waiting to. */
interface Debris {
  damage: Damage | undefined;
  readonly at: Vector3;
  readonly velocity: Vector3;
  readonly spin: Vector3;
  readonly turn: Vector3;
  wait: number;
  readonly size: number;
  falling: boolean;
}

/** A crack wandering across an island's top from `start`, as a ribbon `width` wide narrowing as it goes; answers the points it passed. */
function crack(
  isle: Isle,
  random: Random,
  start: Vector3,
  heading: number,
  steps: number,
  width: number,
  into: BufferGeometry[],
): Vector3[] {
  const points: Vector3[] = [];
  let at = start.clone();
  let direction = heading;
  for (let i = 0; i < steps; i += 1) {
    points.push(at.clone());
    direction += (random() - 0.5) * 0.9;
    at = at.clone().add(new Vector3(Math.cos(direction) * 0.7, 0, Math.sin(direction) * 0.7));
    if (Math.hypot(at.x, at.z) > isle.edgeRadius(Math.atan2(at.z, at.x)) * 0.98) break;
  }
  const positions: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    const t = new Vector3().subVectors(b, a).normalize();
    const n = new Vector3(-t.z, 0, t.x);
    const wa = width * (1 - (i / points.length) * 0.7);
    const wb = width * (1 - ((i + 1) / points.length) * 0.7);
    const ya = isle.topHeight(a.x, a.z) + 0.06;
    const yb = isle.topHeight(b.x, b.z) + 0.06;
    const p = isle.position;
    const corners = [
      [a.x + n.x * wa, ya, a.z + n.z * wa],
      [b.x - n.x * wb, yb, b.z - n.z * wb],
      [b.x + n.x * wb, yb, b.z + n.z * wb],
      [a.x + n.x * wa, ya, a.z + n.z * wa],
      [a.x - n.x * wa, ya, a.z - n.z * wa],
      [b.x - n.x * wb, yb, b.z - n.z * wb],
    ] as const;
    for (const [x, y, z] of corners) positions.push(p.x + x, p.y + y, p.z + z);
  }
  if (positions.length > 0) {
    const ribbon = new Geometry();
    ribbon.setAttribute("position", new Float32BufferAttribute(positions, 3));
    into.push(ribbon);
  }
  return points;
}

/** An island's cracks, as many and as deep as its damage, and where they smoke and spark. */
function crackUp(isle: Isle, intensity: number, ribbons: BufferGeometry[]): Damage {
  const random = randomOf(hashOf(isle.zone.path) ^ 0xc4ac);
  const embers: Vector3[] = [];
  const smoke: Vector3[] = [];
  const surface = (point: Vector3) =>
    new Vector3(point.x, isle.topHeight(point.x, point.z) + 0.1, point.z).add(isle.position);
  for (let k = 0; k < Math.round(1 + intensity * 4); k += 1) {
    const theta = random() * TAU;
    const big = k === 0 && intensity > 0.9;
    const start = big
      ? new Vector3(-Math.cos(theta) * isle.radius * 0.8, 0, -Math.sin(theta) * isle.radius * 0.8)
      : new Vector3(Math.cos(theta) * isle.radius * 0.15, 0, Math.sin(theta) * isle.radius * 0.15);
    const points = crack(
      isle,
      random,
      start,
      theta + (random() - 0.5) * (big ? 0.2 : 1),
      Math.round(6 + intensity * 16) + (big ? 14 : 0),
      big ? 0.75 : 0.12 + intensity * 0.4,
      ribbons,
    );
    if (intensity > 0.9)
      for (let i = 1; i < points.length; i += 2) embers.push(surface(points[i] ?? new Vector3()));
    for (let i = 2; i < points.length; i += 4)
      if (random() < 0.6 * intensity + 0.2) smoke.push(surface(points[i] ?? new Vector3()));
    if (intensity <= 0.5) continue;
    for (let i = 3; i < points.length - 2; i += 5)
      crack(
        isle,
        random,
        (points[i] ?? new Vector3()).clone(),
        theta + (random() < 0.5 ? 1.2 : -1.2),
        5,
        0.06 + intensity * 0.12,
        ribbons,
      );
  }
  return { isle, intensity, embers, smoke };
}

/** A storm cell's puffs about `centre`, as many and as tall as its `load`. */
function stormPuffs(centre: Vector3, load: number, spread: number, random: Random): Puff[] {
  return Array.from({ length: Math.round(5 + load * 46) }, () => {
    const a = random() * TAU;
    const tower = random() ** 1.4;
    const d = Math.sqrt(random()) * spread * (1 - tower * 0.55);
    const s = (3.5 + random() * 5) * (0.45 + load * 1.4) * (1 - tower * 0.35);
    return {
      x: centre.x + Math.cos(a) * d,
      y: centre.y + tower * (3 + load * 22) + (random() - 0.5) * 1.5,
      z: centre.z + Math.sin(a) * d,
      w: s * 1.2,
      h: s,
      seed: random(),
    };
  });
}

/** A bolt's two crossed ribbons, `BOLT_POINTS` long, their positions rewritten at each strike. */
function boltRibbon(): Geometry {
  const geometry = new Geometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array((BOLT_POINTS - 1) * 12 * 3), 3),
  );
  return geometry;
}

/** The defects as the world drives them. */
export interface Defects {
  readonly update: (input: {
    readonly defects: readonly FactoryDefect[];
    readonly isles: ReadonlyMap<string, Isle>;
    readonly extent: number;
    readonly shown: boolean;
    readonly selected: string | undefined;
    readonly hovered: string | undefined;
    readonly still: boolean;
  }) => void;
  readonly frame: (delta: number, elapsed: number) => void;
  /** How damaged each zone is, by path, for its texel. */
  readonly damage: () => ReadonlyMap<string, number>;
  /** Where the cracks smoke black. */
  readonly smoke: () => readonly SmokeSource[];
}

/** The defects, allocated in `scene` at their bounds and registered for picking by an invisible stand-in each. */
export function defectsOf(
  scene: Scene,
  picking: WorldPicking,
  palette: WorldPalette,
  sky: SkyUniforms,
  effects: Effects,
): Defects {
  const defectColor = new Color(palette.signal.DEFECT);
  const puffs = puffGeometry(MAX_DEFECTS * PUFFS_PER_STORM);
  const stormMaterial = puffMaterial(sky, true);
  stormMaterial.uniforms.uStormEmber?.value.copy(defectColor);
  stormMaterial.uniforms.uPick?.value.set(palette.signal.SELECTION);
  const storms = new Mesh(puffs, stormMaterial);
  storms.frustumCulled = false;
  storms.renderOrder = 3;
  const crackMaterial = new MeshBasicMaterial({ color: palette.signal.DEFECT, side: DoubleSide });
  const cracks = new Mesh(new Geometry(), crackMaterial);
  const trails = new LineSegments(
    new Geometry(),
    runningDashes(defectColor, sky.uTime, { dash: 1, gap: 1.4, speed: 2.2, opacity: 0.75 }),
  );
  trails.frustumCulled = false;
  const motes = new InstancedMesh(
    new IcosahedronGeometry(0.3, 1),
    new MeshBasicMaterial({ color: palette.signal.DEFECT }),
    MAX_DEFECTS * 16,
  );
  const debris = new InstancedMesh(
    new DodecahedronGeometry(0.4, 0),
    new MeshStandardMaterial({ color: "#8a7466", roughness: 0.9, flatShading: true }),
    DEBRIS,
  );
  const proxies = new InstancedMesh(
    new SphereGeometry(1, 8, 6),
    new MeshBasicMaterial({ visible: false }),
    MAX_DEFECTS,
  );
  for (const mesh of [motes, debris, proxies]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
  }
  debris.castShadow = true;
  const boltCore = new MeshBasicMaterial({
    color: new Color(1.6, 1.45, 1.4),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  const boltGlow = new MeshBasicMaterial({
    color: defectColor,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  const bolts = Array.from({ length: BOLTS }, () => {
    const core = new Mesh(boltRibbon(), boltCore.clone());
    const glow = new Mesh(boltRibbon(), boltGlow.clone());
    for (const mesh of [core, glow]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
    }
    scene.add(core, glow);
    return { core, glow, life: 0 };
  });
  const wound = new PointLight(palette.signal.DEFECT, 0, 46, 1.3);
  scene.add(storms, cracks, trails, motes, debris, proxies, wound);

  let placed: Storm[] = [];
  let damages: Damage[] = [];
  let damageByPath = new Map<string, number>();
  let smoke: SmokeSource[] = [];
  let trailCurves: { curve: QuadraticBezierCurve3; count: number; load: number }[] = [];
  let targets: PickTarget[] = [];
  let built: { defects: readonly FactoryDefect[]; isles: ReadonlyMap<string, Isle> } | undefined;
  let shown = true;
  let worst: Damage | undefined;
  picking.addInstances(proxies, (instanceId) => targets[instanceId]);
  const random = randomOf(0xb017);
  const object = new Object3D();
  const debrisState = Array.from(
    { length: DEBRIS },
    (): Debris => ({
      damage: undefined,
      at: new Vector3(),
      velocity: new Vector3(),
      spin: new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(3),
      turn: new Vector3(random() * 6, random() * 6, 0),
      wait: random() * 8,
      size: 0.4 + random() * 1.1,
      falling: false,
    }),
  );
  const emberColor = new Color();

  const build = (
    defects: readonly FactoryDefect[],
    isles: ReadonlyMap<string, Isle>,
    extent: number,
  ) => {
    const shownDefects = defects.slice(0, MAX_DEFECTS);
    const most = Math.max(1, ...shownDefects.map((defect) => defect.events));
    const load = new Map<Isle, number>();
    for (const defect of shownDefects) {
      defect.zonePaths.forEach((path, k) => {
        const isle = isles.get(path);
        if (isle !== undefined)
          load.set(isle, (load.get(isle) ?? 0) + defect.events * (k === 0 ? 1 : 0.25));
      });
    }
    const heaviest = Math.max(1, ...load.values());
    const ribbons: BufferGeometry[] = [];
    damages = [...load].map(([isle, events]) =>
      crackUp(isle, Math.sqrt(events / heaviest), ribbons),
    );
    damageByPath = new Map(damages.map((damage) => [damage.isle.zone.path, damage.intensity]));
    smoke = damages.flatMap((damage) => damage.smoke.map((at) => ({ at, dark: true })));
    worst = [...damages].sort((a, b) => b.intensity - a.intensity)[0];
    cracks.geometry.dispose();
    cracks.geometry = merged(ribbons) ?? new Geometry();
    const besideCount = new Map<Isle | undefined, number>();
    const all: Puff[] = [];
    const gate = gateOf(extent);
    placed = shownDefects.map((defect, index) => {
      const isle = defect.zonePaths
        .map((path) => isles.get(path))
        .find((candidate) => candidate !== undefined);
      const k = besideCount.get(isle) ?? 0;
      besideCount.set(isle, k + 1);
      const intensity = Math.sqrt(defect.events / most);
      const stormLoad = (defect.events / most) ** 1.5;
      const spread = 2 + stormLoad * 10;
      const theta = (index / Math.max(1, shownDefects.length)) * TAU + 2.1;
      const centre =
        isle === undefined
          ? new Vector3(Math.cos(theta) * (extent + 22), 34, Math.sin(theta) * (extent + 22))
          : new Vector3(
              Math.cos(k * 2.4) * k * 3,
              isle.topHeight(0, 0) + 11 + intensity * 7,
              Math.sin(k * 2.4) * k * 3,
            ).add(isle.position);
      const cell = stormPuffs(centre, stormLoad, spread, randomOf(hashOf(defect.id)));
      const storm: Storm = {
        defect,
        isle,
        centre,
        intensity,
        spread,
        first: all.length,
        count: cell.length,
        flash: 0,
        next: random() * 2,
      };
      all.push(...cell);
      return storm;
    });
    setPuffs(puffs, all);
    trailCurves = placed.flatMap((storm) => {
      if (storm.isle === undefined) return [];
      const end = new Vector3(0, storm.isle.topHeight(0, 0) + 1.5, 0).add(storm.isle.position);
      const control = new Vector3()
        .lerpVectors(gate, end, 0.5)
        .add(new Vector3(0, 22 + storm.intensity * 10, 0));
      return [
        {
          curve: new QuadraticBezierCurve3(gate.clone().add(new Vector3(0, -2, 0)), control, end),
          count: Math.max(1, Math.round(1 + storm.intensity ** 3 * 15)),
          load: storm.intensity,
        },
      ];
    });
    trails.geometry.dispose();
    trails.geometry = dashedPath(trailCurves.map(({ curve }) => curve.getPoints(60)));
    placed.forEach((storm, index) => {
      object.position.copy(storm.centre).add(new Vector3(0, 4, 0));
      object.rotation.set(0, 0, 0);
      object.scale.setScalar(storm.spread + 4);
      object.updateMatrix();
      proxies.setMatrixAt(index, object.matrix);
    });
    proxies.count = placed.length;
    proxies.instanceMatrix.needsUpdate = true;
    targets = placed.map((storm) => ({ kind: PICK_KIND.DEFECT, id: storm.defect.id }));
    if (worst !== undefined)
      wound.position
        .copy(worst.isle.position)
        .add(new Vector3(0, worst.isle.topHeight(0, 0) + 4, 0));
    for (const state of debrisState) state.damage = undefined;
  };

  const strike = (storm: Storm) => {
    const bolt = bolts.find((candidate) => candidate.life <= 0) ?? bolts[0];
    if (bolt === undefined) return;
    const isle = storm.isle;
    const from = storm.centre
      .clone()
      .add(
        new Vector3(
          (random() - 0.5) * 6 * storm.intensity,
          -1,
          (random() - 0.5) * 6 * storm.intensity,
        ),
      );
    const theta = random() * TAU;
    const d = Math.sqrt(random()) * (isle?.radius ?? 3) * 0.7;
    const to =
      isle === undefined
        ? from.clone().add(new Vector3(0, -14, 0))
        : new Vector3(
            Math.cos(theta) * d,
            isle.topHeight(Math.cos(theta) * d, Math.sin(theta) * d),
            Math.sin(theta) * d,
          ).add(isle.position);
    const points = Array.from({ length: BOLT_POINTS }, (_, i) => {
      const t = i / (BOLT_POINTS - 1);
      const point = new Vector3().lerpVectors(from, to, t);
      if (i > 0 && i < BOLT_POINTS - 1)
        point.add(
          new Vector3((random() - 0.5) * 1.6, (random() - 0.5) * 0.6, (random() - 0.5) * 1.6),
        );
      return point;
    });
    for (const [mesh, width] of [
      [bolt.core, 0.07 + storm.intensity * 0.1],
      [bolt.glow, 0.4 + storm.intensity * 0.7],
    ] as const) {
      const position = mesh.geometry.getAttribute("position");
      let v = 0;
      for (let i = 0; i < BOLT_POINTS - 1; i += 1) {
        const a = points[i] ?? from;
        const b = points[i + 1] ?? to;
        for (const [ox, oz] of [
          [width, 0],
          [0, width],
        ] as const) {
          for (const [x, y, z] of [
            [a.x - ox, a.y, a.z - oz],
            [a.x + ox, a.y, a.z + oz],
            [b.x + ox, b.y, b.z + oz],
            [a.x - ox, a.y, a.z - oz],
            [b.x + ox, b.y, b.z + oz],
            [b.x - ox, b.y, b.z - oz],
          ] as const) {
            position.setXYZ(v, x, y, z);
            v += 1;
          }
        }
      }
      position.needsUpdate = true;
      mesh.geometry.computeBoundingSphere();
      mesh.visible = true;
    }
    bolt.life = 0.45;
    storm.flash = 1;
    for (let i = 0; i < 14; i += 1)
      effects.spark(
        to,
        (random() - 0.5) * 4,
        random() * 3,
        (random() - 0.5) * 4,
        emberColor.copy(defectColor).multiplyScalar(2.5),
        0.5,
        0.35,
        0.94,
      );
  };

  const stepDebris = (delta: number) => {
    debrisState.forEach((state, i) => {
      if (!state.falling) {
        state.wait -= delta * (0.4 + (state.damage?.intensity ?? 0));
        if (state.wait <= 0 && damages.length > 0) {
          const damage = damages[Math.floor(random() * damages.length)];
          if (damage !== undefined) {
            const theta = random() * TAU;
            const reach = damage.isle.edgeRadius(theta) * (0.4 + random() * 0.6);
            state.damage = damage;
            state.at
              .set(
                Math.cos(theta) * reach,
                -1.5 - random() * damage.isle.depth * 0.5,
                Math.sin(theta) * reach,
              )
              .add(damage.isle.position);
            state.velocity.set((random() - 0.5) * 0.6, -0.5, (random() - 0.5) * 0.6);
            state.falling = random() < 0.35 + damage.intensity;
            state.wait = 1 + random() * 6;
          }
        }
      }
      if (state.falling) {
        state.velocity.y -= 5 * delta;
        state.at.addScaledVector(state.velocity, delta);
        state.turn.addScaledVector(state.spin, delta);
        if (state.at.y < SEA_Y - 4) state.falling = false;
      }
      object.position.copy(state.at);
      object.rotation.set(state.turn.x, state.turn.y, state.turn.z);
      object.scale.setScalar(
        state.falling ? state.size * (0.6 + (state.damage?.intensity ?? 0)) : 0,
      );
      object.updateMatrix();
      debris.setMatrixAt(i, object.matrix);
    });
    debris.count = damages.length > 0 ? DEBRIS : 0;
    debris.instanceMatrix.needsUpdate = true;
  };

  const placeMotes = (elapsed: number, moving: boolean) => {
    let index = 0;
    for (const trail of trailCurves) {
      if (!moving) break;
      for (let k = 0; k < trail.count; k += 1) {
        const t = (elapsed * 0.075 + k / trail.count + trail.load) % 1;
        trail.curve.getPoint(t, object.position);
        object.rotation.set(elapsed * 2 + k, k, 0);
        object.scale.setScalar((0.9 + trail.load * 0.6) * Math.min(1, t * 8));
        object.updateMatrix();
        motes.setMatrixAt(index, object.matrix);
        index += 1;
      }
    }
    motes.count = index;
    motes.instanceMatrix.needsUpdate = true;
  };

  return {
    update: ({ defects, isles, extent, shown: on, selected, hovered, still }) => {
      shown = on;
      if (built === undefined || built.defects !== defects || built.isles !== isles) {
        build(defects, isles, extent);
        built = { defects, isles };
      }
      const tint = puffs.getAttribute("aTint");
      for (const storm of placed) {
        const chosen = storm.defect.id === selected ? 1 : storm.defect.id === hovered ? 0.6 : 0;
        for (let k = 0; k < storm.count; k += 1) tint.setX(storm.first + k, chosen);
      }
      tint.needsUpdate = true;
      for (const mesh of [storms, cracks, trails, motes, debris, proxies]) mesh.visible = shown;
      crackMaterial.color.set(palette.signal.DEFECT);
      wound.intensity = shown && worst !== undefined ? 60 * worst.intensity : 0;
      // Note that a bolt mid-strike goes with its layer, since `frame` stops fading what is not shown.
      if (still || !shown) {
        for (const bolt of bolts) {
          bolt.core.visible = false;
          bolt.glow.visible = false;
          bolt.life = 0;
        }
      }
      if (still) {
        placeMotes(0, false);
        debris.count = 0;
        for (const bolt of bolts) {
          bolt.core.visible = false;
          bolt.glow.visible = false;
          bolt.life = 0;
        }
      }
    },
    frame: (delta, elapsed) => {
      if (!shown) return;
      const flash = puffs.getAttribute("aFlash");
      for (const storm of placed) {
        storm.next -= delta;
        if (storm.next <= 0) {
          strike(storm);
          storm.next = (0.6 + random() * 2.2) / (0.25 + storm.intensity * 1.2);
        }
        storm.flash = Math.max(0, storm.flash - delta * 3.5);
        for (let k = 0; k < storm.count; k += 1)
          flash.setX(storm.first + k, storm.flash * (0.6 + 0.4 * Math.sin(k * 7.3)));
      }
      flash.needsUpdate = true;
      for (const bolt of bolts) {
        if (bolt.life <= 0) continue;
        bolt.life -= delta;
        const fade = Math.max(0, bolt.life / 0.45);
        bolt.core.material.opacity = fade * (Math.sin(elapsed * 90) > 0.4 ? 0.4 : 1);
        bolt.glow.material.opacity = fade * 0.5;
        bolt.core.visible = bolt.life > 0;
        bolt.glow.visible = bolt.life > 0;
      }
      crackMaterial.color
        .copy(defectColor)
        .multiplyScalar(0.8 + 0.45 * Math.sin(elapsed * 2.4) ** 2);
      for (const damage of damages) {
        if (damage.embers.length === 0) continue;
        const at = damage.embers[Math.floor(random() * damage.embers.length)];
        if (at !== undefined)
          effects.spark(
            at,
            (random() - 0.5) * 0.6,
            1.6 + random() * 2.4,
            (random() - 0.5) * 0.6,
            emberColor.set(random() < 0.6 ? "#ff5a24" : "#ffb050").multiplyScalar(2.2),
            1.6 + random(),
            0.16,
            0.99,
          );
      }
      const storming = placed.find((storm) => storm.isle === worst?.isle);
      wound.intensity =
        worst === undefined
          ? 0
          : 60 *
              worst.intensity *
              (0.75 + 0.25 * Math.sin(elapsed * 5.3) * Math.sin(elapsed * 2.1)) +
            (storming?.flash ?? 0) * 200;
      stepDebris(delta);
      placeMotes(elapsed, true);
    },
    damage: () => damageByPath,
    smoke: () => smoke,
  };
}
