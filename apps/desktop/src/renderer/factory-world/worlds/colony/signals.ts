import {
  FACTORY_WORLD_BOUNDS,
  type FactoryDefect,
  type FactoryPlanned,
  LINEAR_PRIORITY,
} from "@luke/features/factory-world-wire";
import type { TimelineEntry } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  type Scene,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  aroundMound,
  type Burrows,
  blobOf,
  type Chamber,
  COLONY,
  clipBelow,
  holeOutline,
} from "./layout";
import { type Motes, motesOf } from "./room";
import {
  beetleGeometry,
  bugMaterial,
  clamp,
  flowerHeadGeometry,
  hashUnit,
  lumpGeometry,
  seeded,
  UP,
  withGlow,
} from "./shapes";
import { grainOf } from "./soil";

/**
 * signals.ts -- the four signals as the colony shows them: shipped work as honeydew stored in the chambers it landed in and flowers on the anthills, planned work as chalk outlines of chambers not yet dug, and defects as beetles in the burrows, rubble, and floods.
 *
 * Every signal wears its palette colour unchanged: the honeydew, its pools,
 * and the petals are `shipped`, the chalk `planned`, the beetles `defect`.
 * Shipped work glows by how fresh it is and a pool by how alive its zone is;
 * a merge landed in no zone is a wildflower toward the back of the meadow.
 * A planned issue's outline is dug beside the first zone it is placed on,
 * dotted toward its second; one placed on none is sketched in the open
 * soil near the top. A defect's beetles crawl over its first zone's chamber
 * (or that zone's anthill, or the trail where it has none), and the damage
 * it does to every zone it is placed on (cracks in the soil, rubble, and a
 * flood where the damage runs deep) grows with its events.
 */

const MAX_SHIPPED = FACTORY_WORLD_BOUNDS.MAX_SHIPPED;
const MAX_ZONES = FACTORY_WORLD_BOUNDS.MAX_ZONES;
const MAX_PLANNED = FACTORY_WORLD_BOUNDS.MAX_PLANNED;
const MAX_DEFECTS = FACTORY_WORLD_BOUNDS.MAX_DEFECTS;
/** The most zones one merge stores honeydew in. */
const HONEY_ZONES = 4;
const MAX_HONEY = MAX_SHIPPED * HONEY_ZONES;
const MAX_FLOWERS = MAX_SHIPPED * 2;
const FIREFLIES_EACH = 2;
const MAX_CHALK = 9000;
const BEETLES_EACH = 6;
const MAX_BEETLES = MAX_DEFECTS * BEETLES_EACH;
const MAX_RUBBLE = 800;
const MAX_DRIPS = 240;
/** The damage at which a chamber floods. */
const FLOOD_AT = 20;
const HOUR_MS = 60 * 60 * 1000;

/** How wide a planned chamber is drawn, by its issue's priority: urgent widest. */
const PLANNED_WIDTH = {
  [LINEAR_PRIORITY.NONE]: 2.4,
  [LINEAR_PRIORITY.URGENT]: 4.2,
  [LINEAR_PRIORITY.HIGH]: 3.6,
  [LINEAR_PRIORITY.MEDIUM]: 2.8,
  [LINEAR_PRIORITY.LOW]: 2.1,
} as const satisfies {
  readonly [P in (typeof LINEAR_PRIORITY)[keyof typeof LINEAR_PRIORITY]]: number;
};

/** One merge's honeydew in one zone. */
interface Honey {
  readonly url: string;
  readonly chamber: Chamber;
  readonly local: Vector3;
  readonly radius: number;
  readonly fresh: number;
}

/** One merge's flower on one anthill. */
interface Flower {
  readonly url: string;
  readonly at: Vector3;
  readonly soil: Vector3;
  readonly stem: number;
  readonly head: number;
  readonly tilt: number;
  readonly lines: number;
  readonly fresh: number;
}

/** One planned issue's outline in the soil. */
interface Ghost {
  readonly identifier: string;
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly toward: Chamber | undefined;
}

interface Beetle {
  readonly id: string;
  readonly chamber: Chamber | undefined;
  readonly onMeadow: boolean;
  readonly x: number;
  th: number;
  readonly v: number;
  readonly d: number;
  speed: number;
  readonly wobble: number;
  readonly at: Vector3;
}

interface Drip {
  readonly chamber: Chamber;
  readonly x: number;
  readonly z: number;
  readonly top: number;
  readonly bottom: number;
  readonly period: number;
  readonly phase: number;
}

/** What the world says it shows of the signals, and what of them is chosen. */
interface SignalState {
  readonly shipped: boolean;
  readonly planned: boolean;
  readonly defects: boolean;
  /** The chosen items, selected or hovered: shipped URLs, issue keys, and defect ids. */
  readonly chosenShipped: ReadonlySet<string>;
  readonly chosenPlanned: ReadonlySet<string>;
  readonly chosenDefects: ReadonlySet<string>;
}

export interface Signals {
  readonly honey: InstancedMesh;
  readonly petals: InstancedMesh;
  readonly ghosts: InstancedMesh;
  readonly beetles: InstancedMesh;
  readonly honeyAt: (instance: number) => string | undefined;
  readonly flowerAt: (instance: number) => string | undefined;
  readonly ghostAt: (instance: number) => string | undefined;
  readonly beetleAt: (instance: number) => string | undefined;
  /** Draws the merges in `timeline` as of `now`; answers where each newly drawn one stands, for its sparks. */
  readonly ship: (
    timeline: readonly TimelineEntry[],
    alive: readonly number[],
    burrows: Burrows,
    now: number,
  ) => Vector3[];
  readonly plan: (planned: readonly FactoryPlanned[], burrows: Burrows) => void;
  readonly wound: (defects: readonly FactoryDefect[], burrows: Burrows) => void;
  readonly show: (state: SignalState) => void;
  readonly step: (dt: number, elapsed: number, moving: boolean) => void;
}

/** How much damage the defects do to each chamber, by index: each defect's events, in full where it is placed first. */
export function damageOf(defects: readonly FactoryDefect[], burrows: Burrows): Map<number, number> {
  const damage = new Map<number, number>();
  for (const defect of defects) {
    defect.zonePaths.forEach((path, index) => {
      const chamber = burrows.byPath.get(path);
      if (chamber !== undefined)
        damage.set(
          chamber.index,
          (damage.get(chamber.index) ?? 0) + defect.events * (index === 0 ? 1 : 0.4),
        );
    });
  }
  return damage;
}

function instanced(
  geometry: BufferGeometry,
  material: MeshStandardMaterial | MeshBasicMaterial | MeshPhysicalMaterial,
  capacity: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  return mesh;
}

function glowing(geometry: BufferGeometry, capacity: number): InstancedBufferAttribute {
  const glow = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  glow.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aGlow", glow);
  return glow;
}

/** Where a planned issue's outline is dug: the free spot nearest its first zone, or near the top of the open soil for none. */
function ghostsOf(planned: readonly FactoryPlanned[], burrows: Burrows): Ghost[] {
  const taken = burrows.chambers.map((chamber) => ({
    x: chamber.cx,
    y: chamber.cy,
    rx: chamber.rx,
    ry: chamber.ry,
  }));
  const ghosts: Ghost[] = [];
  for (const issue of planned.slice(0, MAX_PLANNED)) {
    const chamber =
      issue.zonePaths[0] === undefined ? undefined : burrows.byPath.get(issue.zonePaths[0]);
    const rx = PLANNED_WIDTH[issue.priority ?? LINEAR_PRIORITY.NONE];
    const ry = rx * 0.62;
    const random = seeded(Math.floor(hashUnit(issue.identifier) * 1e9));
    const home = chamber ?? {
      cx: (hashUnit(issue.identifier, 4) * 2 - 1) * (COLONY.HALF - 8),
      cy: -9,
      rx: 0,
      ry: 0,
    };
    let best: { x: number; y: number; overlap: number } | undefined;
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      const away = 1.2 + random() * 1.5;
      const x = home.cx + Math.cos(a) * (home.rx + rx + away);
      const y = home.cy + Math.sin(a) * (home.ry + ry + away);
      if (y > -2.5 - ry || y < -COLONY.DEPTH + 2 + ry || Math.abs(x) > COLONY.HALF - rx - 1)
        continue;
      let overlap = 0;
      for (const other of taken) {
        const dx = (x - other.x) / (rx + other.rx + 0.6);
        const dy = (y - other.y) / (ry + other.ry + 0.6);
        const q = dx * dx + dy * dy;
        if (q < 1) overlap += 1 - q;
      }
      if (best === undefined || overlap < best.overlap) best = { x, y, overlap };
    }
    if (best === undefined) continue;
    taken.push({ x: best.x, y: best.y, rx, ry });
    const second = issue.zonePaths[1];
    ghosts.push({
      identifier: issue.identifier,
      x: best.x,
      y: best.y,
      rx,
      ry,
      toward: second === undefined ? undefined : burrows.byPath.get(second),
    });
  }
  return ghosts;
}

/** Each chalk dash of `ghosts`: round each outline, toward each one's second zone, and a cross at its centre. */
function chalkOf(
  ghosts: readonly Ghost[],
): { ghost: number; x: number; y: number; size: number; turn: number; phase: number }[] {
  const dashes: {
    ghost: number;
    x: number;
    y: number;
    size: number;
    turn: number;
    phase: number;
  }[] = [];
  ghosts.forEach((ghost, index) => {
    const random = seeded(Math.floor(hashUnit(ghost.identifier, 8) * 1e9));
    const perimeter =
      Math.PI *
      (3 * (ghost.rx + ghost.ry) -
        Math.sqrt((3 * ghost.rx + ghost.ry) * (ghost.rx + 3 * ghost.ry)));
    const count = Math.round(perimeter / 0.5);
    for (let k = 0; k < count; k += 1) {
      const a = (k / count) * Math.PI * 2;
      dashes.push({
        ghost: index,
        x: ghost.x + Math.cos(a) * ghost.rx,
        y: ghost.y + Math.sin(a) * ghost.ry,
        size: 1,
        turn: Math.atan2(Math.cos(a) * ghost.ry, -Math.sin(a) * ghost.rx),
        phase: random() * 6,
      });
    }
    const toward = ghost.toward;
    if (toward !== undefined) {
      const dx = toward.cx - ghost.x;
      const dy = toward.cy - ghost.y;
      const length = Math.hypot(dx, dy);
      for (
        let d = Math.hypot(ghost.rx, ghost.ry) * 0.85;
        d < length - Math.max(toward.rx, toward.ry) * 0.9;
        d += 1.1
      ) {
        dashes.push({
          ghost: index,
          x: ghost.x + (dx / length) * d,
          y: ghost.y + (dy / length) * d,
          size: 0.6,
          turn: Math.atan2(dy, dx),
          phase: random() * 6,
        });
      }
    }
    for (const [ox, oy, turn] of [
      [-0.3, -0.3, 0.785],
      [0.3, 0.3, 0.785],
      [-0.3, 0.3, -0.785],
      [0.3, -0.3, -0.785],
    ] as const) {
      dashes.push({ ghost: index, x: ghost.x + ox, y: ghost.y + oy, size: 1, turn, phase: 0 });
    }
  });
  return dashes.slice(0, MAX_CHALK);
}

/** The water standing in a flooded chamber, about its centre: its face against the glass, its surface, and the bright line where they meet. */
function floodOf(chamber: Chamber, damage: number) {
  const fraction = clamp(0.16 + (0.56 * Math.log(1 + damage)) / Math.log(85), 0.16, 0.72);
  const top = chamber.cy + chamber.ry * 0.95;
  const level = chamber.floorY + (top - chamber.floorY) * fraction;
  const outline = clipBelow(holeOutline(chamber), level - chamber.cy);
  const front = new ShapeGeometry(
    new Shape(outline.map((point) => new Vector2(point.x, point.y))),
  ).translate(chamber.cx, chamber.cy, -0.03);
  const dy = (level - chamber.cy) / chamber.ry;
  const k = Math.sqrt(Math.max(0, 1 - dy * dy)) * 0.97;
  const surface = new Shape();
  surface.moveTo(chamber.rx * k, 0);
  for (let step = 1; step <= 36; step += 1) {
    const a = (step / 36) * Math.PI;
    surface.lineTo(Math.cos(a) * chamber.rx * k, Math.sin(a) * chamber.rz * k);
  }
  // Note that the surface reaches back from the glass, as the floor does.
  const water = new ShapeGeometry(surface).rotateX(-Math.PI / 2).translate(chamber.cx, level, 0);
  return { parts: [front, water], level };
}

/** A merge landed in no zone, as a flower on the open meadow toward its back, at a place its URL seeds. */
function wildFlowerOf(entry: TimelineEntry, lines: number, fresh: number): Flower {
  const random = seeded(Math.floor(hashUnit(entry.url, 17) * 1e9));
  const x = (random() * 2 - 1) * (COLONY.HALF - 3);
  const z = -COLONY.SLAB + 1.5 + random() * 3;
  return {
    url: entry.url,
    at: new Vector3(x, 0, z),
    soil: new Vector3(x + 0.6, 0, z + 0.3),
    stem: 0.9 + 0.22 * lines ** 0.3,
    head: 0.55 + 0.07 * lines ** 0.3,
    tilt: random() * 0.4 - 0.2,
    lines,
    fresh,
  };
}

/* ----- Public ----- */

export function signalsOf(
  scene: Scene,
  grain: Texture,
  time: { value: number },
  signal: { shipped: string; planned: string; defect: string; selection: string },
): Signals {
  const shipped = new Color(signal.shipped);
  const planned = new Color(signal.planned);
  const defect = new Color(signal.defect);
  const selection = new Color(signal.selection);

  const honeyGeometry = new SphereGeometry(1, 18, 14);
  const honeyGlow = glowing(honeyGeometry, MAX_HONEY);
  const honey = instanced(
    honeyGeometry,
    withGlow(new MeshPhysicalMaterial({ roughness: 0.15, clearcoat: 1 }), 1.3, "honey"),
    MAX_HONEY,
  );
  honey.castShadow = true;
  const heads = instanced(
    new SphereGeometry(1, 8, 6),
    new MeshStandardMaterial({ color: "#3a2418", roughness: 0.5 }),
    MAX_HONEY * 2,
  );
  const petalGeometry = flowerHeadGeometry();
  const petalGlow = glowing(petalGeometry, MAX_FLOWERS);
  const petals = instanced(
    petalGeometry,
    withGlow(new MeshStandardMaterial({ roughness: 0.6 }), 1.4, "petal"),
    MAX_FLOWERS,
  );
  petals.castShadow = true;
  const centreGeometry = new SphereGeometry(0.2, 10, 8);
  const centreGlow = glowing(centreGeometry, MAX_FLOWERS);
  const centres = instanced(
    centreGeometry,
    withGlow(new MeshStandardMaterial({ color: "#ffe9a8", roughness: 0.5 }), 1.5, "centre"),
    MAX_FLOWERS,
  );
  const stems = instanced(
    new CylinderGeometry(0.04, 0.06, 1, 5, 1).translate(0, 0.5, 0),
    new MeshStandardMaterial({ color: "#5f8f36", roughness: 0.7 }),
    MAX_FLOWERS,
  );
  stems.castShadow = true;
  const freshSoil = instanced(
    lumpGeometry(11, 0.55, 0.22, 2),
    new MeshStandardMaterial({
      color: "#4a2c1c",
      roughness: 0.75,
      normalMap: grainOf(grain, 1, 1),
    }),
    MAX_FLOWERS,
  );
  freshSoil.castShadow = true;
  const poolGeometry = new SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const poolGlow = glowing(poolGeometry, MAX_ZONES);
  const pools = instanced(
    poolGeometry,
    withGlow(new MeshPhysicalMaterial({ roughness: 0.12, clearcoat: 1 }), 1.6, "pool"),
    MAX_ZONES,
  );
  const fireflies: Motes = motesOf(
    MAX_HONEY * FIREFLIES_EACH + MAX_FLOWERS * FIREFLIES_EACH,
    time,
    0,
    (_, mote) => {
      mote.color.copy(shipped).multiplyScalar(1.6);
      mote.size = 0.5;
      mote.alpha = 0;
    },
  );
  fireflies.center.setUsage(DynamicDrawUsage);
  fireflies.alpha.setUsage(DynamicDrawUsage);

  const chalk = instanced(
    new PlaneGeometry(0.4, 0.16),
    new MeshBasicMaterial({ depthWrite: false, toneMapped: false }),
    MAX_CHALK,
  );
  chalk.renderOrder = 11;
  // Note that a planned chamber's faint wash is also what picks it, so its whole outline is a target.
  const ghostStandIns = instanced(
    new CircleGeometry(1, 32),
    new MeshBasicMaterial({
      color: planned,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      toneMapped: false,
    }),
    MAX_PLANNED,
  );
  ghostStandIns.renderOrder = 11;

  const beetleGeometryShared = beetleGeometry();
  const beetlePhase = new InstancedBufferAttribute(new Float32Array(MAX_BEETLES), 1);
  beetlePhase.setUsage(DynamicDrawUsage);
  beetleGeometryShared.setAttribute("aPhase", beetlePhase);
  const beetles = instanced(
    beetleGeometryShared,
    bugMaterial(
      { color: 0xffffff, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 },
      "beetle",
    ),
    MAX_BEETLES,
  );
  beetles.castShadow = true;
  const rubble = instanced(
    lumpGeometry(21, 0.8, 0.25, 0),
    new MeshStandardMaterial({ color: "#7a5a44", roughness: 0.9, flatShading: true }),
    MAX_RUBBLE,
  );
  rubble.castShadow = true;
  const water = new MeshPhysicalMaterial({
    color: "#3fb2cc",
    transparent: true,
    opacity: 0.7,
    roughness: 0.05,
    clearcoat: 1,
    emissive: "#0f6e86",
    emissiveIntensity: 0.9,
    normalMap: grainOf(grain, 2, 2),
    normalScale: new Vector2(0.35, 0.35),
    side: DoubleSide,
    depthWrite: false,
  });
  const floods = new Mesh<BufferGeometry, MeshPhysicalMaterial>(
    new PlaneGeometry(0.001, 0.001),
    water,
  );
  floods.renderOrder = 2;
  const drips = instanced(
    new SphereGeometry(0.11, 8, 6).scale(1, 1.7, 1),
    new MeshPhysicalMaterial({
      color: "#9fe3f2",
      emissive: "#2aa4c4",
      emissiveIntensity: 1.2,
      roughness: 0.05,
      clearcoat: 1,
    }),
    MAX_DRIPS,
  );
  const splashes = instanced(
    new TorusGeometry(0.4, 0.035, 4, 24).rotateX(Math.PI / 2),
    new MeshBasicMaterial({
      color: "#c9f6ff",
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    MAX_DRIPS,
  );

  scene.add(
    honey,
    heads,
    petals,
    centres,
    stems,
    freshSoil,
    pools,
    fireflies.mesh,
    chalk,
    ghostStandIns,
    beetles,
    rubble,
    floods,
    drips,
    splashes,
  );

  let honeys: Honey[] = [];
  let flowers: Flower[] = [];
  let poolCount = 0;
  let ghosts: Ghost[] = [];
  let dashes: ReturnType<typeof chalkOf> = [];
  let crawlers: Beetle[] = [];
  let falling: Drip[] = [];
  let shown: SignalState = {
    shipped: true,
    planned: true,
    defects: true,
    chosenShipped: new Set(),
    chosenPlanned: new Set(),
    chosenDefects: new Set(),
  };
  const born = new Map<string, number>();
  let seenUrls: ReadonlySet<string> | undefined;
  let elapsedNow = 0;

  const matrix = new Matrix4();
  const turn = new Quaternion();
  const scale = new Vector3();
  const at = new Vector3();
  const facing = new Vector3();
  const normal = new Vector3();
  const across = new Vector3();
  const lift = new Vector3();
  const basis = new Matrix4();
  const euler = new Euler();
  const tint = new Color();

  /** The pop a newly shipped item grows in by, 1 once it has landed. */
  const grown = (url: string, moving: boolean, seconds: number) => {
    const start = born.get(url);
    if (!moving || start === undefined) return 1;
    const g = clamp((elapsedNow - start) / seconds, 0, 1);
    return g < 1 ? g * (1 + Math.sin(g * Math.PI) * 0.5) : 1;
  };

  const placeShipped = (t: number, moving: boolean) => {
    honeys.forEach((item, index) => {
      const chosen = shown.chosenShipped.has(item.url);
      const sway = moving ? Math.sin(t * 1.4 + index) * 0.04 : 0;
      const g = grown(item.url, moving, 0.9) * (chosen ? 1.45 : 1);
      const c = item.chamber;
      at.set(c.cx + item.local.x + sway, c.cy + item.local.y, item.local.z);
      honey.setMatrixAt(
        index,
        matrix.compose(
          at,
          turn.identity(),
          scale.set(item.radius, item.radius * 1.08, item.radius).multiplyScalar(g),
        ),
      );
      honey.setColorAt(index, chosen ? selection : shipped);
      honeyGlow.setX(index, item.fresh * (1 + (moving ? 0.15 * Math.sin(t * 2 + index) : 0)));
      at.y += item.radius * g * 1.05;
      heads.setMatrixAt(index * 2, matrix.compose(at, turn, scale.setScalar(0.17 * g)));
      at.y += 0.2 * g;
      heads.setMatrixAt(index * 2 + 1, matrix.compose(at, turn, scale.setScalar(0.12 * g)));
      for (let k = 0; k < FIREFLIES_EACH; k += 1) {
        const j = index * FIREFLIES_EACH + k;
        const a = (moving ? t * 0.6 : 0) + j * 2.1;
        fireflies.center.setXYZ(
          j,
          at.x + Math.cos(a) * 1.2,
          at.y - 0.8 + Math.sin(a * 1.3) * 0.5,
          -0.8,
        );
        fireflies.alpha.setX(j, item.fresh * 0.7);
      }
    });
    flowers.forEach((flower, index) => {
      const chosen = shown.chosenShipped.has(flower.url);
      const g = grown(flower.url, moving, 1.2);
      const sway = moving ? Math.sin(t * 1.3 + index * 1.7) * 0.06 : 0;
      turn.setFromEuler(euler.set(flower.tilt + sway, 0, sway * 0.6));
      stems.setMatrixAt(index, matrix.compose(flower.at, turn, scale.set(1, flower.stem * g, 1)));
      at.set(0, flower.stem * g, 0)
        .applyQuaternion(turn)
        .add(flower.at);
      petals.setMatrixAt(
        index,
        matrix.compose(at, turn, scale.setScalar(flower.head * g * (chosen ? 1.45 : 1))),
      );
      petals.setColorAt(index, chosen ? selection : shipped);
      centres.setMatrixAt(index, matrix.compose(at, turn, scale.setScalar(flower.head * g * 1.1)));
      petalGlow.setX(index, flower.fresh * 0.7);
      centreGlow.setX(index, 0.3 + flower.fresh * 1.2);
      freshSoil.setMatrixAt(
        index,
        matrix.compose(
          flower.soil,
          turn.identity(),
          scale.setScalar(0.8 * g * (0.6 + 0.12 * flower.lines ** 0.25)),
        ),
      );
      for (let k = 0; k < FIREFLIES_EACH; k += 1) {
        const j = (MAX_HONEY + index) * FIREFLIES_EACH + k;
        const a = (moving ? t * 0.5 : 0) + j * 1.7;
        fireflies.center.setXYZ(
          j,
          at.x + Math.cos(a) * 1.4,
          at.y + 0.8 + Math.sin(a * 1.4) * 0.8,
          at.z + Math.sin(a) * 1.4,
        );
        fireflies.alpha.setX(j, flower.fresh);
      }
    });
    for (const mesh of [honey, heads, petals, centres, stems, freshSoil])
      mesh.instanceMatrix.needsUpdate = true;
    for (const mesh of [honey, petals])
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    for (const glow of [honeyGlow, petalGlow, centreGlow]) glow.needsUpdate = true;
    fireflies.center.needsUpdate = true;
    fireflies.alpha.needsUpdate = true;
  };

  const placeChalk = (t: number, moving: boolean) => {
    dashes.forEach((dash, index) => {
      const ghost = ghosts[dash.ghost];
      const chosen = ghost !== undefined && shown.chosenPlanned.has(ghost.identifier);
      const breathe = moving ? 0.9 + 0.15 * Math.sin(t * 1.5 + dash.phase) : 1;
      turn.setFromEuler(euler.set(0, 0, dash.turn));
      chalk.setMatrixAt(
        index,
        matrix.compose(
          at.set(dash.x, dash.y, COLONY.GLASS_Z + 0.03),
          turn,
          scale.setScalar(dash.size * breathe * (chosen ? 1.5 : 1)),
        ),
      );
      chalk.setColorAt(index, chosen ? selection : planned);
    });
    chalk.instanceMatrix.needsUpdate = true;
    if (chalk.instanceColor !== null) chalk.instanceColor.needsUpdate = true;
  };

  /** Places beetle `b` on its chamber's ceiling and back wall, its anthill, or the trail. */
  const placeBeetle = (b: Beetle, index: number, dt: number, t: number, moving: boolean) => {
    if (moving) {
      b.th += b.speed * dt * (0.7 + 0.6 * Math.sin(t * 0.7 + b.wobble));
      if (b.th < 0.12 || b.th > Math.PI - 0.12) {
        b.speed *= -1;
        b.th = clamp(b.th, 0.12, Math.PI - 0.12);
      }
      beetlePhase.setX(index, (beetlePhase.getX(index) ?? 0) + dt * 9);
    }
    const c = b.chamber;
    const mound = c?.mound;
    if (c === undefined || (b.onMeadow && mound !== undefined)) {
      const point =
        mound === undefined
          ? at.set(b.x + Math.cos(b.th) * 3, 0.02, COLONY.TRAIL_Z - 1 - Math.sin(b.th) * 2)
          : at.copy(aroundMound(mound, b.th, b.d));
      facing.set(-Math.sin(b.th), 0, Math.cos(b.th)).multiplyScalar(Math.sign(b.speed));
      orient(facing, UP);
      b.at.copy(point);
    } else {
      const v = b.v + (moving ? 0.15 * Math.sin(t * 0.4 + b.wobble) : 0);
      const k = Math.sqrt(1 - v * v);
      const f = blobOf(c, b.th) * 0.97;
      const lx = Math.cos(b.th) * c.rx * f * k;
      const ly = Math.sin(b.th) * c.ry * f * k;
      const lz = -v * c.rz;
      b.at.set(c.cx + lx, c.cy + ly, lz);
      normal.set(-lx / (c.rx * c.rx), -ly / (c.ry * c.ry), -lz / (c.rz * c.rz)).normalize();
      facing
        .set(-Math.sin(b.th) * c.rx, Math.cos(b.th) * c.ry, 0)
        .normalize()
        .multiplyScalar(Math.sign(b.speed));
      facing.addScaledVector(normal, -facing.dot(normal)).normalize();
      orient(facing, normal);
    }
    beetles.setMatrixAt(index, matrix.compose(b.at, turn, scale.setScalar(1.25)));
    beetles.setColorAt(index, shown.chosenDefects.has(b.id) ? selection : defect);
  };
  /** Sets `turn` to face `ahead` with `upward` up. */
  const orient = (ahead: Vector3, upward: Vector3) => {
    across.crossVectors(upward, ahead);
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
    across.normalize();
    lift.crossVectors(ahead, across).normalize();
    basis.makeBasis(across, lift, ahead);
    turn.setFromRotationMatrix(basis);
  };

  const placeDefects = (dt: number, t: number, moving: boolean) => {
    crawlers.forEach((b, index) => {
      placeBeetle(b, index, dt, t, moving);
    });
    beetles.instanceMatrix.needsUpdate = true;
    if (beetles.instanceColor !== null) beetles.instanceColor.needsUpdate = true;
    beetlePhase.needsUpdate = true;
    falling.forEach((drip, index) => {
      const phase = moving ? (t / drip.period + drip.phase) % 1 : drip.phase;
      const fall = phase * phase;
      const y = drip.top + (drip.bottom - drip.top) * Math.min(1, fall * 1.15);
      const c = drip.chamber;
      drips.setMatrixAt(
        index,
        matrix.compose(
          at.set(c.cx + drip.x, c.cy + y, drip.z),
          turn.identity(),
          scale.setScalar(fall * 1.15 < 1 ? 1 : 0),
        ),
      );
      const splash = clamp((fall * 1.15 - 1) / 0.25, 0, 1);
      splashes.setMatrixAt(
        index,
        matrix.compose(
          at.set(c.cx + drip.x, c.cy + drip.bottom + 0.02, drip.z),
          turn,
          scale.setScalar(splash > 0 && splash < 1 ? 0.3 + splash * 1.4 : 0),
        ),
      );
    });
    drips.instanceMatrix.needsUpdate = true;
    splashes.instanceMatrix.needsUpdate = true;
  };

  return {
    honey,
    petals,
    ghosts: ghostStandIns,
    beetles,
    honeyAt: (instance) => honeys[instance]?.url,
    flowerAt: (instance) => flowers[instance]?.url,
    ghostAt: (instance) => ghosts[instance]?.identifier,
    beetleAt: (instance) => crawlers[instance]?.id,
    ship: (timeline, alive, burrows, now) => {
      const recent = timeline.slice(-MAX_SHIPPED);
      const urls = new Set(recent.map((entry) => entry.url));
      const fresh = (entry: TimelineEntry) =>
        0.18 + 0.82 * Math.exp(-Math.max(0, now - entry.mergedAt) / HOUR_MS / 24);
      honeys = [];
      flowers = [];
      const perZone = new Map<number, number>();
      for (const entry of recent) {
        const chambers = entry.zonePaths
          .flatMap((path) => burrows.byPath.get(path) ?? [])
          .slice(0, HONEY_ZONES);
        const lines = Math.max(
          4,
          (entry.additions + entry.deletions) / Math.max(1, chambers.length),
        );
        if (chambers.length === 0 && flowers.length < MAX_FLOWERS) {
          flowers.push(wildFlowerOf(entry, lines, fresh(entry)));
        }
        for (const chamber of chambers) {
          perZone.set(chamber.index, (perZone.get(chamber.index) ?? 0) + 1);
          const random = seeded(Math.floor(hashUnit(entry.url, chamber.index + 1) * 1e9));
          const radius = 0.16 + 0.05 * lines ** 0.33 * (chamber.surface ? 0.75 : 1);
          let x = 0;
          let z = 0;
          do {
            x = random() * 1.24 - 0.62;
            z = -0.2 - random() * 0.65;
          } while (x * x + z * z > 0.6);
          const ceiling =
            chamber.ry *
            blobOf(chamber, Math.PI / 2) *
            Math.sqrt(Math.max(0.05, 1 - x * x - z * z));
          honeys.push({
            url: entry.url,
            chamber,
            local: new Vector3(x * chamber.rx, ceiling - radius - 0.28, z * chamber.rz),
            radius,
            fresh: fresh(entry),
          });
          const mound = chamber.mound;
          if (mound !== undefined && flowers.length < MAX_FLOWERS) {
            const th = random() * (Math.PI + 0.5) - 0.25;
            const d = 0.4 + random() * 2.4;
            const flowerAt = aroundMound(mound, th, d);
            flowerAt.y = 0;
            flowers.push({
              url: entry.url,
              at: flowerAt,
              soil: aroundMound(mound, th + 0.4, 0.2).setY(0),
              stem: 0.9 + 0.22 * lines ** 0.3,
              head: 0.55 + 0.07 * lines ** 0.3,
              tilt: random() * 0.4 - 0.2,
              lines,
              fresh: fresh(entry),
            });
          }
        }
      }
      honeys = honeys.slice(0, MAX_HONEY);
      const sparks: Vector3[] = [];
      // Note that only a merge newly come into view (the scrubber played on, or a fresh read) pops in; the first drawing does not.
      if (seenUrls !== undefined) {
        for (const item of honeys) {
          if (seenUrls.has(item.url) || born.has(item.url)) continue;
          born.set(item.url, elapsedNow);
          sparks.push(
            new Vector3(
              item.chamber.cx + item.local.x,
              item.chamber.cy + item.local.y,
              item.local.z,
            ),
          );
        }
      }
      seenUrls = urls;
      honey.count = honeys.length;
      heads.count = honeys.length * 2;
      for (const mesh of [petals, centres, stems, freshSoil]) mesh.count = flowers.length;
      fireflies.mesh.geometry.instanceCount = (MAX_HONEY + flowers.length) * FIREFLIES_EACH;
      for (let j = honeys.length * FIREFLIES_EACH; j < MAX_HONEY * FIREFLIES_EACH; j += 1)
        fireflies.alpha.setX(j, 0);
      poolCount = 0;
      for (const [index, count] of perZone) {
        const chamber = burrows.chambers[index];
        if (chamber === undefined || poolCount >= MAX_ZONES) continue;
        const k = Math.min(0.88, 0.22 + 0.11 * Math.sqrt(count));
        pools.setMatrixAt(
          poolCount,
          matrix.compose(
            at.set(chamber.cx, chamber.floorY - 0.02, -chamber.fz * 0.5),
            turn.identity(),
            scale.set(chamber.fx * k, 0.12 + 0.06 * Math.sqrt(count), chamber.fz * k * 0.5),
          ),
        );
        pools.setColorAt(poolCount, tint.copy(shipped));
        poolGlow.setX(poolCount, 0.3 + 1.6 * (alive[index] ?? 0));
        poolCount += 1;
      }
      pools.count = poolCount;
      pools.instanceMatrix.needsUpdate = true;
      if (pools.instanceColor !== null) pools.instanceColor.needsUpdate = true;
      poolGlow.needsUpdate = true;
      return sparks;
    },
    plan: (issues, burrows) => {
      ghosts = ghostsOf(issues, burrows);
      dashes = chalkOf(ghosts);
      ghosts.forEach((ghost, index) => {
        ghostStandIns.setMatrixAt(
          index,
          matrix.compose(
            at.set(ghost.x, ghost.y, COLONY.GLASS_Z),
            turn.identity(),
            scale.set(ghost.rx, ghost.ry, 1),
          ),
        );
      });
      ghostStandIns.count = ghosts.length;
      ghostStandIns.instanceMatrix.needsUpdate = true;
      chalk.count = dashes.length;
    },
    wound: (defects, burrows) => {
      crawlers = [];
      for (const report of defects.slice(0, MAX_DEFECTS)) {
        const first = report.zonePaths[0];
        const chamber = first === undefined ? undefined : burrows.byPath.get(first);
        const random = seeded(Math.floor(hashUnit(report.id) * 1e9));
        const count = clamp(Math.round(2 * Math.log2(1 + report.events)), 1, BEETLES_EACH);
        const x = (hashUnit(report.id, 6) * 2 - 1) * (COLONY.HALF - 8);
        for (let k = 0; k < count; k += 1) {
          crawlers.push({
            id: report.id,
            chamber,
            onMeadow: chamber?.mound !== undefined && k % 2 === 0,
            x,
            th: 0.2 + (Math.PI - 0.4) * ((k + 0.5) / count),
            v: 0.25 + random() * 0.5,
            d: 0.6 + (k % 3) * 0.8,
            speed: (0.16 + random() * 0.06) * (Math.floor(k / 2) % 2 ? -1 : 1),
            wobble: random() * 6,
            at: new Vector3(),
          });
        }
      }
      beetles.count = crawlers.length;
      const damage = damageOf(defects, burrows);
      const stones: Matrix4[] = [];
      const floodParts: BufferGeometry[] = [];
      falling = [];
      for (const [index, amount] of damage) {
        const chamber = burrows.chambers[index];
        if (chamber === undefined || amount < 1) continue;
        const random = seeded(index * 977 + 3);
        const count = Math.min(14, Math.round(5 + 4 * Math.log2(1 + amount)));
        const side = random() < 0.5 ? -1 : 1;
        for (let k = 0; k < count && stones.length < MAX_RUBBLE; k += 1) {
          const r = 0.18 + random() * 0.42;
          stones.push(
            new Matrix4().compose(
              new Vector3(
                chamber.cx + side * chamber.fx * (0.25 + random() * 0.5),
                chamber.floorY + r * 0.4 + random() * 0.6 * (k / count),
                -(0.3 + random() * 0.5) * chamber.fz,
              ),
              new Quaternion().setFromEuler(new Euler(random() * 3, random() * 3, random() * 3)),
              new Vector3(r * 2, r * 2, r * 2),
            ),
          );
        }
        if (amount < FLOOD_AT) continue;
        const flood = floodOf(chamber, amount);
        floodParts.push(...flood.parts);
        const drops = Math.min(8, Math.ceil(amount / 7) + 1);
        for (let k = 0; k < drops && falling.length < MAX_DRIPS; k += 1) {
          const x = (random() - 0.5) * chamber.rx;
          const z = -(0.15 + random() * 0.65) * chamber.rz * 0.8;
          const rise = Math.sqrt(Math.max(0.05, 1 - (x / chamber.rx) ** 2 - (z / chamber.rz) ** 2));
          falling.push({
            chamber,
            x,
            z,
            top: chamber.ry * rise * 0.95,
            bottom: flood.level - chamber.cy,
            period: 0.9 + random() * 0.9,
            phase: random(),
          });
        }
      }
      stones.forEach((stone, index) => {
        rubble.setMatrixAt(index, stone);
      });
      rubble.count = stones.length;
      rubble.instanceMatrix.needsUpdate = true;
      drips.count = falling.length;
      splashes.count = falling.length;
      floods.geometry.dispose();
      floods.geometry =
        floodParts.length > 0
          ? mergeGeometries(floodParts.map((part) => part.toNonIndexed()))
          : new PlaneGeometry(0.001, 0.001);
    },
    show: (state) => {
      shown = state;
      for (const mesh of [honey, heads, petals, centres, stems, freshSoil, pools, fireflies.mesh])
        mesh.visible = state.shipped;
      chalk.visible = state.planned;
      ghostStandIns.visible = state.planned;
      for (const mesh of [beetles, rubble, floods, drips, splashes]) mesh.visible = state.defects;
    },
    step: (dt, elapsed, moving) => {
      elapsedNow = elapsed;
      const t = moving ? elapsed : 0;
      placeShipped(t, moving);
      placeChalk(t, moving);
      placeDefects(dt, t, moving);
    },
  };
}
