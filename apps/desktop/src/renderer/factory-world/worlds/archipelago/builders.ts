import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import type { PickTarget, WorldPalette, WorldPicking } from "@luke/panel/factory-world/world";
import { PICK_KIND } from "@luke/panel/factory-world/world";
import {
  AGENT_KIND,
  AGENT_STATE,
  type AgentState,
  type AgentView,
  BUILD_FULL_LINES,
} from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  type Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import type { Effects } from "./effects";
import type { Isle } from "./islands";
import {
  box,
  easeInOut,
  hashOf,
  lit,
  mergedSome,
  PALETTE,
  pickOf,
  type Random,
  randomOf,
  TAU,
  tint,
  windowPane,
  xf,
} from "./kit";
import { glowMaterial, type ZoneUniforms } from "./zone-light";

/**
 * builders.ts -- the agents at work: each a little builder on the island of its primary zone, raising a tower in scaffolding as tall as its pull request is large, or a refactor's airship hull in a sky dock beside it, with a hot-air balloon crane tethered overhead.
 *
 * A builder's state reads at a glance, still or moving. Working, it swings
 * its hammer and now and then jetpacks to the other zones its pull request
 * touches; waiting on the developer, it stands at the top of its scaffold;
 * stuck, it dozes on the scaffold under a sagging grey balloon; failed, it
 * sits with its head in its hands under a slack balloon in the defect's
 * colour. An idle builder has nothing on the go: it rests on its island's
 * rim with no balloon. A builder whose work lands in no zone yet rides its
 * balloon above the archipelago, waiting for a place to build.
 *
 * Every part is an instanced mesh allocated at the contract's bounds; a
 * tower is a stack of instanced storeys, so a scrubbed pull request grows or
 * shrinks its tower without a geometry being built. The selected builder,
 * and the hovered one, stand in a ring of the selection's colour with a
 * beacon over their heads.
 */

const MAX_AGENTS = FACTORY_WORLD_BOUNDS.MAX_AGENTS;

/** The most storeys every tower together holds: a hundred agents, each up to thirteen. */
const MAX_STOREYS = MAX_AGENTS * 14;

/** How tall one storey of a tower is, and how much bigger a builder is than its geometry. */
const STOREY = 0.75;
const BUILDER_SCALE = 1.35;

/** The colour a builder's balloon and hat wear when nothing is on the go. */
const RESTING_GREY = "#a9b6b0";

/** What a site looks like where it stands. */
const SITE = {
  /** A tower in scaffolding on one of its island's plots. */
  TOWER: "tower",
  /** A tower on a rock of its own beside a crowded island. */
  FLOATING: "floating",
  /** A refactor's airship hull in a sky dock beside the island. */
  HULL: "hull",
  /** Nothing built: an idle builder resting on the rim. */
  REST: "rest",
  /** No zone to build in: riding the balloon above the archipelago. */
  AIRBORNE: "airborne",
} as const;

type SiteKind = (typeof SITE)[keyof typeof SITE];

/** One builder as placed by the last update: where it works, faces, and flies its balloon, in the scene's frame. */
interface Builder {
  readonly agent: AgentView;
  readonly site: SiteKind;
  readonly work: Vector3;
  readonly face: Vector3;
  readonly balloon: Vector3;
  readonly visits: readonly Vector3[];
  readonly period: number;
  readonly phase: number;
  readonly size: number;
}

/** The builder the developer selected, and the one the pointer rests on, by agent id. */
interface ChosenIds {
  readonly selected: string | undefined;
  readonly hovered: string | undefined;
}

// ---------------------------------------------------------------- geometry

function colored(geometry: BufferGeometry, hex: string): BufferGeometry {
  return tint(geometry, hex);
}

/** The builder's body parts, each white where the instance colours it, and its own colours elsewhere. */
function bodyParts() {
  return {
    torso: mergedSome([
      colored(new CapsuleGeometry(0.11, 0.12, 3, 10).translate(0, 0.15, 0), "#ffffff"),
      colored(new BoxGeometry(0.16, 0.08, 0.02).translate(0, 0.2, 0.105), "#ffffff"),
    ]),
    head: mergedSome([
      colored(new SphereGeometry(0.13, 14, 10), "#ffffff"),
      colored(new SphereGeometry(0.018, 6, 4).translate(-0.045, 0.01, 0.122), "#120a10"),
      colored(new SphereGeometry(0.018, 6, 4).translate(0.045, 0.01, 0.122), "#120a10"),
      colored(new SphereGeometry(0.03, 6, 4).translate(0, -0.025, 0.13), "#e9a582"),
    ]),
    hat: mergedSome([
      colored(
        new SphereGeometry(0.145, 12, 6, 0, TAU, 0, Math.PI / 2).translate(0, 0.03, 0),
        "#ffffff",
      ),
      colored(new CylinderGeometry(0.19, 0.19, 0.025, 14).translate(0, 0.035, 0.02), "#ffffff"),
      colored(new BoxGeometry(0.03, 0.05, 0.25).translate(0, 0.17, 0), "#ffffff"),
    ]),
    arm: mergedSome([
      colored(new CapsuleGeometry(0.042, 0.13, 3, 6).translate(0, -0.1, 0), "#efe4d2"),
      colored(new SphereGeometry(0.045, 6, 4).translate(0, -0.2, 0), "#e8b98f"),
    ]),
    hammer: mergedSome([
      colored(new CapsuleGeometry(0.042, 0.13, 3, 6).translate(0, -0.1, 0), "#efe4d2"),
      colored(new SphereGeometry(0.045, 6, 4).translate(0, -0.2, 0), "#e8b98f"),
      colored(
        new CylinderGeometry(0.014, 0.014, 0.3, 5).rotateX(Math.PI / 2).translate(0, -0.21, 0.13),
        "#8a5a36",
      ),
      colored(new BoxGeometry(0.13, 0.07, 0.07).translate(0, -0.21, 0.28), "#9aa0aa"),
    ]),
    leg: mergedSome([
      colored(new CapsuleGeometry(0.05, 0.1, 3, 6).translate(0, -0.1, 0), "#3d3a55"),
      colored(new BoxGeometry(0.09, 0.06, 0.14).translate(0, -0.21, 0.02), "#5a3a28"),
    ]),
    pack: mergedSome([
      colored(new BoxGeometry(0.17, 0.2, 0.09), "#c9a04a"),
      colored(new CylinderGeometry(0.045, 0.045, 0.24, 8).translate(-0.065, 0, -0.05), "#b8743a"),
      colored(new CylinderGeometry(0.045, 0.045, 0.24, 8).translate(0.065, 0, -0.05), "#b8743a"),
    ]),
    flame: colored(
      new ConeGeometry(0.05, 0.3, 8).rotateX(Math.PI).translate(0, -0.15, 0),
      "#ffffff",
    ),
  };
}

/** A hot-air balloon's envelope, its gores alternating light and dark, whitened where the instance colours it. */
function envelope(): BufferGeometry {
  const profile = [
    [0.14, -0.62],
    [0.22, -0.55],
    [0.4, -0.38],
    [0.6, -0.15],
    [0.76, 0.1],
    [0.82, 0.35],
    [0.78, 0.58],
    [0.62, 0.8],
    [0.35, 0.95],
    [0.02, 1.0],
  ].map(([x, y]) => new Vector2(x, y));
  const geometry = new LatheGeometry(profile, 16).toNonIndexed();
  geometry.deleteAttribute("uv");
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 3) {
    const cx = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
    const cz = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
    const cy = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    const gore = Math.floor(((Math.atan2(cz, cx) + Math.PI) / TAU) * 16 + 0.5) % 2;
    const k = cy < -0.3 ? 0.55 : gore === 1 ? 1 : 0.62;
    for (let j = 0; j < 3; j += 1) colors.set([k, k, k], (i + j) * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** The basket under the balloon, the rope it lowers, and the crate on the rope. */
function basket(): BufferGeometry {
  const ropes = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x = 0, z = 0]) => {
    const from = new Vector3(x * 0.16, -0.83, z * 0.16);
    const to = new Vector3(x * 0.12, -0.6, z * 0.12);
    const direction = new Vector3().subVectors(to, from);
    return colored(
      new CylinderGeometry(0.008, 0.008, direction.length(), 3),
      PALETTE.WOOD_DARK,
    ).applyMatrix4(
      new Matrix4().compose(
        from.clone().add(to).multiplyScalar(0.5),
        new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
        new Vector3(1, 1, 1),
      ),
    );
  });
  return mergedSome([
    colored(new BoxGeometry(0.34, 0.24, 0.34).translate(0, -0.95, 0), PALETTE.WOOD),
    colored(new BoxGeometry(0.38, 0.04, 0.38).translate(0, -0.83, 0), PALETTE.WOOD_DARK),
    ...ropes,
    colored(new CylinderGeometry(0.006, 0.006, 0.9, 3).translate(0, -1.52, 0), PALETTE.ROPE),
    colored(new BoxGeometry(0.28, 0.24, 0.28).translate(0, -2.0, 0), "#b07d4c"),
    colored(new BoxGeometry(0.29, 0.03, 0.29).translate(0, -1.95, 0), PALETTE.WOOD_DARK),
  ]);
}

/** One storey of a tower's body, a unit wide, its windows lit. */
function storeyBody(): BufferGeometry {
  return mergedSome([
    xf(box(1, STOREY, 1, "#ffffff"), 0, STOREY / 2, 0),
    xf(windowPane(0.18, 0.24, 1.02), 0, STOREY * 0.55, 0),
    xf(windowPane(1.02, 0.24, 0.18), 0, STOREY * 0.55, 0),
  ]);
}

/** One storey of scaffolding about a unit-wide body: four poles and a ring of ledgers at its top. */
function storeyScaffold(): BufferGeometry {
  const o = 0.66;
  const parts: BufferGeometry[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const)
    parts.push(xf(box(0.055, STOREY, 0.055, PALETTE.WOOD), sx * o, STOREY / 2, sz * o));
  parts.push(
    xf(box(o * 2, 0.04, 0.04, PALETTE.WOOD), 0, STOREY, o),
    xf(box(o * 2, 0.04, 0.04, PALETTE.WOOD), 0, STOREY, -o),
    xf(box(0.04, 0.04, o * 2, PALETTE.WOOD), o, STOREY, 0),
    xf(box(0.04, 0.04, o * 2, PALETTE.WOOD), -o, STOREY, 0),
  );
  return mergedSome(parts);
}

/** The top of a tower: the deck its builder stands on, and the flag pole above the scaffold. */
function towerCap(): BufferGeometry {
  const o = 0.66;
  return mergedSome([
    xf(box(o * 2 + 0.1, 0.05, 0.36, "#c49a66"), 0, 0.02, o - 0.1),
    xf(box(0.02, 1.2, 0.02, PALETTE.WOOD_DARK), -o, STOREY + 0.5, -o),
  ]);
}

/** The signal a tower shows in its state's colour: the glowing block of work under way, and the flag. */
function towerSignal(): BufferGeometry {
  const o = 0.66;
  return mergedSome([
    xf(box(0.55, 0.32, 0.55, "#ffffff"), 0.12, 0.17, -0.12),
    xf(box(0.42, 0.24, 0.015, "#ffffff"), -o + 0.21, STOREY + 0.95, -o),
  ]);
}

/** A refactor's airship hull, four units long and its ribs half skinned, along x. */
function hull(): BufferGeometry {
  const length = 4;
  const girth = 1.12;
  const profile = (x: number) => girth * Math.max(0, 1 - ((2 * x) / length) ** 2) ** 0.5;
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < 8; k += 1) {
    const x = -length / 2 + ((k + 0.5) * length) / 8;
    if (x < -length * 0.05) continue;
    parts.push(
      xf(
        tint(new TorusGeometry(Math.max(0.12, profile(x)), 0.045, 3, 14), "#c9a37a"),
        x,
        0,
        0,
        0,
        Math.PI / 2,
      ),
    );
  }
  const skin: Vector2[] = [];
  for (let k = 0; k <= 12; k += 1) {
    const y = -length / 2 + (k / 12) * length * 0.46;
    skin.push(new Vector2(Math.max(0.02, profile(y)), y));
  }
  parts.push(tint(new LatheGeometry(skin, 16).rotateZ(-Math.PI / 2), "#a9cbe3"));
  parts.push(
    xf(box(length * 0.98, 0.07, 0.07, PALETTE.WOOD_DARK), 0, -girth, 0),
    xf(box(length * 0.98, 0.06, 0.06, PALETTE.WOOD_DARK), 0, girth, 0),
  );
  for (const angle of [0.8, 2.35, -0.8, -2.35]) {
    const points: Vector3[] = [];
    for (let k = 0; k <= 16; k += 1) {
      const x = -length / 2 + (k / 16) * length;
      points.push(new Vector3(x, Math.sin(angle) * profile(x), Math.cos(angle) * profile(x)));
    }
    parts.push(
      tint(new TubeGeometry(new CatmullRomCurve3(points), 24, 0.03, 3), PALETTE.WOOD_DARK),
    );
  }
  parts.push(
    xf(box(length * 0.06 + 0.2, girth * 0.7, 0.04, "#3f6c9a"), -length / 2 + 0.2, girth * 0.25, 0),
    xf(
      box(length * 0.3, 0.3 * girth, 0.42 * girth, PALETTE.WOOD),
      -length * 0.12,
      -girth * 1.15,
      0,
    ),
  );
  for (let k = 0; k < 3; k += 1)
    parts.push(
      xf(
        lit(new SphereGeometry(0.08, 6, 4), "#ffcf80", 2.4),
        MathUtils.lerp(-length * 0.4, length * 0.4, k / 2),
        -girth - 0.05,
        0,
      ),
    );
  return mergedSome(parts);
}

// ---------------------------------------------------------------- placing the sites

/** The colour a builder's state wears on its hat, its balloon, and its tower's signal. */
function stateColor(state: AgentState, signal: WorldPalette["signal"]): string {
  if (state === AGENT_STATE.FAILED) return signal.DEFECT;
  if (state === AGENT_STATE.WORKING || state === AGENT_STATE.WAITING) return signal.BUILDING;
  return RESTING_GREY;
}

/** How tall a tower stands for a build of `size`: a foundation for none, twelve units at the full size. */
function towerHeight(size: number): number {
  return 0.9 + 11 * size ** 4;
}

/** One tower or hull as instanced: its frame, its width, how many storeys, and its builder's points in that frame. */
interface Raised {
  readonly matrix: Matrix4;
  readonly width: number;
  readonly storeys: number;
}

/** What one update raises, for the instances to be written from. */
interface Raising {
  readonly towers: Raised[];
  readonly hulls: { matrix: Matrix4; tether: [Vector3, Vector3] }[];
  readonly rocks: Matrix4[];
  readonly owners: { tower: number[]; storey: number[]; hull: number[] };
}

const frame = new Matrix4();
const turn = new Quaternion();
const UP_AXIS = new Vector3(0, 1, 0);

/** A builder's tower at `at` (local to its island), turned `ry`: the frame its storeys stand in, and where the builder works and the balloon flies. */
function raiseTower(
  isle: Isle,
  at: Vector3,
  ry: number,
  size: number,
  raising: Raising,
  owner: number,
  floating: boolean,
) {
  const height = towerHeight(size);
  const width = 0.5 + 0.35 * Math.sqrt(height);
  const storeys = Math.max(1, Math.round((height * 0.8) / STOREY));
  const base = at.clone().add(isle.position);
  const matrix = new Matrix4().compose(
    base,
    turn.setFromAxisAngle(UP_AXIS, ry).clone(),
    new Vector3(width, 1, width),
  );
  raising.towers.push({ matrix, width, storeys });
  raising.owners.tower.push(owner);
  if (floating)
    raising.rocks.push(
      new Matrix4().compose(
        base.clone().add(new Vector3(0, -0.9, 0)),
        new Quaternion(),
        new Vector3(width * 1.4, 1.1, width * 1.4),
      ),
    );
  const top = 0.2 + storeys * STOREY;
  const o = width / 2 + 0.16;
  const local = (x: number, y: number, z: number) =>
    new Vector3(x, y, z).applyMatrix4(
      frame.compose(base, turn.setFromAxisAngle(UP_AXIS, ry), new Vector3(1, 1, 1)),
    );
  return {
    work: local(0, top + 0.05, o - 0.14),
    face: local(width * 0.12, top, -width * 0.12),
    balloon: local(o + 0.9, top + STOREY + 1.8, 0),
  };
}

/** How far round an island's sky dock its hulls have been moored, and on which level. */
interface SkyDock {
  angle: number;
  level: number;
}

/** A refactor's hull in its island's sky dock, moored round from the last, a level higher once the dock is full round. */
function raiseHull(isle: Isle, dock: SkyDock, size: number, raising: Raising, owner: number) {
  const length = MathUtils.clamp(1.4 + 14.6 * size ** 3, 1.4, 16);
  const girth = 0.2 * length + 0.32;
  const reach = isle.radius + girth + 0.7;
  const theta = dock.angle + (length / 2 + 1) / reach;
  dock.angle = theta + (length / 2 + 1) / reach;
  if (dock.angle > isle.outward + 0.9 + TAU) {
    dock.angle = isle.outward + 0.9;
    dock.level += 1;
  }
  const rim = isle.edgeRadius(theta);
  const out = rim + girth + 0.7 + dock.level * 2.5;
  const y =
    isle.topHeight(Math.cos(theta) * rim * 0.9, Math.sin(theta) * rim * 0.9) +
    0.6 +
    girth * 0.4 +
    dock.level * 4.5;
  const at = new Vector3(Math.cos(theta) * out, y, Math.sin(theta) * out).add(isle.position);
  const ry = -theta - Math.PI / 2;
  const rotation = new Quaternion().setFromAxisAngle(UP_AXIS, ry);
  const matrix = new Matrix4().compose(
    at,
    rotation,
    new Vector3(length / 4, girth / 1.12, girth / 1.12),
  );
  const local = (x: number, yy: number, z: number) =>
    new Vector3(x, yy, z).applyQuaternion(rotation).add(at);
  const foot = new Vector3(Math.cos(theta) * rim * 0.92, 0, Math.sin(theta) * rim * 0.92);
  foot.y = isle.topHeight(foot.x, foot.z);
  raising.hulls.push({ matrix, tether: [local(0, -girth, 0), foot.add(isle.position)] });
  raising.owners.hull.push(owner);
  return {
    work: local(0, girth + 0.02, 0),
    face: local(length * 0.5, girth, 0),
    balloon: local(length * 0.15, girth + 2.6, 0.8),
  };
}

/** The points an idle builder rests at: its island's rim, facing out. */
function rest(isle: Isle, random: Random) {
  const theta = random() * TAU;
  const rim = isle.edgeRadius(theta) * 0.86;
  const x = Math.cos(theta) * rim;
  const z = Math.sin(theta) * rim;
  const work = new Vector3(x, isle.topHeight(x, z) + 0.02, z).add(isle.position);
  return {
    work,
    face: work.clone().add(new Vector3(Math.cos(theta), 0, Math.sin(theta))),
    balloon: work.clone(),
  };
}

/** Where a builder lands on another zone it touches: a spot inside the island, seeded by both. */
function visitOf(isle: Isle, agentId: string): Vector3 {
  const random = randomOf(hashOf(agentId) ^ hashOf(isle.zone.path));
  const theta = random() * TAU;
  const d = Math.sqrt(random()) * isle.radius * 0.55;
  const x = Math.cos(theta) * d;
  const z = Math.sin(theta) * d;
  return new Vector3(x, isle.topHeight(x, z), z).add(isle.position);
}

// ---------------------------------------------------------------- the builders

/** The builders as the world drives them. */
export interface Builders {
  readonly update: (input: {
    readonly agents: readonly AgentView[];
    readonly isles: ReadonlyMap<string, Isle>;
    readonly extent: number;
    /** Whether every builder is drawn (the building layer), and whether the failed ones are where it is off (the defects layer). */
    readonly building: boolean;
    readonly failed: boolean;
    readonly selected: string | undefined;
    readonly hovered: string | undefined;
    readonly still: boolean;
    readonly elapsed: number;
  }) => void;
  readonly frame: (delta: number, elapsed: number) => void;
  /** Where the failed builders' sites smoke. */
  readonly smoking: () => readonly Vector3[];
}

/** The builders, every part allocated in `scene` at its bound and registered for picking. */
export function buildersOf(
  scene: Scene,
  picking: WorldPicking,
  palette: WorldPalette,
  uniforms: ZoneUniforms,
  effects: Effects,
): Builders {
  const solid = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  const parts = bodyParts();
  const instanced = (
    geometry: BufferGeometry,
    material: MeshStandardMaterial | MeshBasicMaterial,
    bound: number,
    shadow = true,
  ) => {
    const mesh = new InstancedMesh(geometry, material, bound);
    // Note that every instance carries a colour from the first frame, so no program is compiled without one.
    mesh.setColorAt(0, new Color(1, 1, 1));
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadow;
    scene.add(mesh);
    return mesh;
  };
  const flameMaterial = new MeshBasicMaterial({
    vertexColors: true,
    color: new Color("#ff9a3a").multiplyScalar(2.5),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const body = {
    torso: instanced(parts.torso, solid, MAX_AGENTS),
    head: instanced(parts.head, solid, MAX_AGENTS),
    hat: instanced(parts.hat, solid, MAX_AGENTS),
    armL: instanced(parts.arm, solid, MAX_AGENTS),
    armR: instanced(parts.hammer, solid, MAX_AGENTS),
    legL: instanced(parts.leg, solid, MAX_AGENTS),
    legR: instanced(parts.leg, solid, MAX_AGENTS),
    pack: instanced(parts.pack, solid, MAX_AGENTS),
    flame: instanced(parts.flame, flameMaterial, MAX_AGENTS, false),
  };
  const balloonMaterial = solid.clone();
  balloonMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.22;",
    );
  };
  balloonMaterial.customProgramCacheKey = () => "archipelago-balloon";
  const balloon = {
    envelope: instanced(envelope(), balloonMaterial, MAX_AGENTS),
    basket: instanced(basket(), solid, MAX_AGENTS),
    burner: instanced(
      new SphereGeometry(0.07, 8, 6).translate(0, -0.66, 0),
      new MeshBasicMaterial({ color: new Color("#ffa040").multiplyScalar(2.5) }),
      MAX_AGENTS,
      false,
    ),
  };
  const glowing = glowMaterial(uniforms);
  const signalMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  signalMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.75;",
    );
  };
  signalMaterial.customProgramCacheKey = () => "archipelago-signal";
  const sites = {
    slab: instanced(xf(box(1.3, 0.22, 1.3, PALETTE.STONE_2), 0, 0.11, 0), solid, MAX_AGENTS),
    storey: instanced(storeyBody(), glowing, MAX_STOREYS),
    scaffold: instanced(storeyScaffold(), solid, MAX_STOREYS + MAX_AGENTS),
    cap: instanced(towerCap(), solid, MAX_AGENTS),
    signal: instanced(towerSignal(), signalMaterial, MAX_AGENTS),
    hull: instanced(hull(), glowing, MAX_AGENTS),
    tether: instanced(
      tint(new CylinderGeometry(0.03, 0.03, 1, 3).translate(0, 0.5, 0), PALETTE.ROPE),
      solid,
      MAX_AGENTS,
      false,
    ),
    rock: instanced(
      new DodecahedronGeometry(1, 0),
      new MeshStandardMaterial({ color: "#9c7f6a", roughness: 0.9, flatShading: true }),
      MAX_AGENTS,
    ),
  };
  const markerMaterial = new MeshBasicMaterial({
    color: palette.signal.SELECTION,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const marker = instanced(
    new RingGeometry(0.42, 0.52, 40).rotateX(-Math.PI / 2),
    markerMaterial,
    2,
    false,
  );
  const beacon = instanced(
    new ConeGeometry(0.14, 0.3, 4).rotateX(Math.PI),
    markerMaterial,
    2,
    false,
  );

  let builders: Builder[] = [];
  let targets: PickTarget[] = [];
  let storeyOwners: number[] = [];
  let towerOwners: number[] = [];
  let hullOwners: number[] = [];
  let smoking: Vector3[] = [];
  let chosen: ChosenIds = { selected: undefined, hovered: undefined };
  const targetOf = (owners: () => readonly number[]) => (instanceId: number) => {
    const owner = owners()[instanceId];
    return owner === undefined ? undefined : targets[owner];
  };
  for (const mesh of [body.torso, body.head, body.hat, balloon.envelope, balloon.basket])
    picking.addInstances(mesh, (instanceId) => targets[instanceId]);
  picking.addInstances(
    sites.storey,
    targetOf(() => storeyOwners),
  );
  picking.addInstances(
    sites.signal,
    targetOf(() => towerOwners),
  );
  picking.addInstances(
    sites.hull,
    targetOf(() => hullOwners),
  );

  const rig = {
    root: new Object3D(),
    body: new Object3D(),
    head: new Object3D(),
    armL: new Object3D(),
    armR: new Object3D(),
    legL: new Object3D(),
    legR: new Object3D(),
    pack: new Object3D(),
    flame: new Object3D(),
  };
  rig.root.add(rig.body, rig.legL, rig.legR);
  rig.body.add(rig.head, rig.armL, rig.armR, rig.pack);
  rig.pack.add(rig.flame);
  rig.body.position.y = 0.24;
  rig.legL.position.set(-0.06, 0.24, 0);
  rig.legR.position.set(0.06, 0.24, 0);
  rig.head.position.y = 0.4;
  rig.armL.position.set(-0.155, 0.27, 0);
  rig.armR.position.set(0.155, 0.27, 0);
  rig.pack.position.set(0, 0.17, -0.14);
  rig.flame.position.set(0, -0.1, -0.02);
  const object = new Object3D();
  const shade = new Color();
  const scratch = new Vector3();
  const ahead = new Vector3();
  const control = new Vector3();
  const sparkColor = new Color();
  let lastElapsed = 0;
  let raised:
    | {
        agents: readonly AgentView[];
        isles: ReadonlyMap<string, Isle>;
        building: boolean;
        failed: boolean;
      }
    | undefined;

  const swing = (t: number) => {
    const p = t % 1;
    return p < 0.68
      ? MathUtils.lerp(-0.5, -2.7, easeInOut(p / 0.68))
      : MathUtils.lerp(-2.7, -0.35, ((p - 0.68) / 0.32) ** 1.6);
  };
  const bezier = (a: Vector3, c: Vector3, b: Vector3, t: number, out: Vector3) => {
    const u = 1 - t;
    return out.set(
      u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      u * u * a.y + 2 * u * t * c.y + t * t * b.y,
      u * u * a.z + 2 * u * t * c.z + t * t * b.z,
    );
  };

  /** Poses the rig for one builder at `elapsed`, or at rest where the world is held still; answers whether it is in flight. */
  const pose = (builder: Builder, elapsed: number, still: boolean) => {
    const state = builder.agent.state;
    const position = rig.root.position.copy(builder.work);
    if (builder.site === SITE.AIRBORNE && !still)
      position.y += Math.sin(elapsed * 0.8 + builder.phase) * 0.25;
    let yaw = Math.atan2(builder.face.x - builder.work.x, builder.face.z - builder.work.z);
    let flying = false;
    const working = state === AGENT_STATE.WORKING;
    const visit = builder.visits.length > 0 && working && !still;
    if (visit) {
      const period = builder.period;
      const t = (elapsed + builder.phase) % period;
      const cycle = Math.floor((elapsed + builder.phase) / period);
      const there = builder.visits[cycle % builder.visits.length] ?? builder.work;
      const distance = builder.work.distanceTo(there);
      const flight = 3 + distance * 0.06;
      const stay = period - 2 * flight - 8;
      control.lerpVectors(builder.work, there, 0.5);
      control.y = Math.max(builder.work.y, there.y) + 3 + distance * 0.25;
      const fly = (from: Vector3, to: Vector3, k: number) => {
        bezier(from, control, to, easeInOut(k), position);
        bezier(from, control, to, Math.min(1, easeInOut(k) + 0.02), ahead);
        yaw = Math.atan2(ahead.x - position.x, ahead.z - position.z);
        flying = true;
      };
      if (t > stay && t < stay + flight) fly(builder.work, there, (t - stay) / flight);
      else if (t >= stay + flight && t < stay + flight + 8) {
        position.copy(there);
        yaw = builder.phase + cycle;
      } else if (t >= stay + flight + 8) fly(there, builder.work, (t - stay - flight - 8) / flight);
    }
    const s = BUILDER_SCALE;
    const hovered = chosen.hovered === builder.agent.id;
    rig.root.rotation.set(0, yaw, 0);
    rig.root.scale.setScalar(s * (hovered ? 1.25 : 1));
    rig.body.position.y = 0.24;
    rig.flame.scale.set(1, 0.001, 1);
    const swingAt = still ? 0.62 : elapsed * 1.25 + builder.phase;
    const sway = still ? 0 : Math.sin(swingAt * TAU);
    if (flying) {
      rig.body.rotation.set(0.5, 0, 0);
      rig.head.rotation.set(-0.2, 0, 0);
      rig.armL.rotation.set(-0.3, 0, -1.1);
      rig.armR.rotation.set(-0.3, 0, 1.1);
      rig.legL.rotation.set(0.5 + Math.sin(elapsed * 6) * 0.15, 0, 0);
      rig.legR.rotation.set(0.5 - Math.sin(elapsed * 6) * 0.15, 0, 0);
      position.y += Math.sin(elapsed * 5 + builder.phase) * 0.05;
      rig.flame.scale.set(1, 0.85 + Math.sin(elapsed * 31 + builder.phase) * 0.25, 1);
    } else if (
      state === AGENT_STATE.STUCK ||
      state === AGENT_STATE.FAILED ||
      state === AGENT_STATE.IDLE
    ) {
      // Note that a builder with nothing moving sits: dozing when stuck, head in hands when failed, at ease when idle.
      const failed = state === AGENT_STATE.FAILED;
      const doze = still ? 0 : Math.sin(elapsed * 0.9 + builder.phase) * 0.12;
      position.y -= 0.19 * s;
      rig.body.rotation.set(failed ? 0.35 : -0.12, 0, 0);
      rig.head.rotation.set(
        (failed ? 0.75 : state === AGENT_STATE.IDLE ? -0.15 : 0.45) + doze,
        0,
        still ? 0 : Math.sin(elapsed * 0.45 + builder.phase) * 0.1,
      );
      rig.armL.rotation.set(failed ? -1.9 : -0.35, 0, failed ? 0.35 : -0.25);
      rig.armR.rotation.set(failed ? -1.9 : -0.2, 0, failed ? -0.35 : 0.25);
      const kick = still ? 0 : Math.sin(elapsed * 1.6 + builder.phase) * 0.18;
      rig.legL.rotation.set(-1.35 + kick, 0, -0.05);
      rig.legR.rotation.set(-1.35 - kick, 0, 0.05);
    } else if (state === AGENT_STATE.WAITING || hovered || builder.site === SITE.AIRBORNE) {
      // Note that a builder waiting on the developer stands with its hands on its hips, and turns to wave when hovered.
      const hop =
        hovered && !still ? Math.abs(Math.sin(elapsed * 6 + builder.phase)) * 0.12 * s : 0;
      position.y += hop;
      rig.body.rotation.set(-0.05, 0, 0);
      rig.head.rotation.set(-0.2, still ? 0 : Math.sin(elapsed * 0.7 + builder.phase) * 0.5, 0);
      if (hovered) {
        rig.armL.rotation.set(-2.7, 0, -0.5 + (still ? 0 : Math.sin(elapsed * 11) * 0.45));
        rig.armR.rotation.set(-0.3, 0, 0.15);
      } else {
        rig.armL.rotation.set(0.3, 0, -0.9);
        rig.armR.rotation.set(0.3, 0, 0.9);
      }
      rig.legL.rotation.set(0.05, 0, -0.08);
      rig.legR.rotation.set(-0.05, 0, 0.08);
    } else {
      rig.body.rotation.set(sway * 0.08 + 0.12, 0, 0);
      rig.head.rotation.set(0.25 + sway * 0.08, 0, 0);
      rig.armR.rotation.set(swing(swingAt), 0, 0.12);
      rig.armL.rotation.set(-0.7 + sway * 0.1, 0, -0.35);
      rig.legL.rotation.set(0.05, 0, -0.06);
      rig.legR.rotation.set(-0.12, 0, 0.06);
    }
    rig.root.updateMatrixWorld(true);
    return { flying, hammerAt: swingAt };
  };

  /** Writes every builder's body and balloon at `elapsed`, stepping sparks off the hammers where `delta` passed. */
  const place = (elapsed: number, still: boolean, delta: number) => {
    builders.forEach((builder, i) => {
      const { flying, hammerAt } = pose(builder, elapsed, still);
      body.torso.setMatrixAt(i, rig.body.matrixWorld);
      body.head.setMatrixAt(i, rig.head.matrixWorld);
      body.hat.setMatrixAt(i, rig.head.matrixWorld);
      body.armL.setMatrixAt(i, rig.armL.matrixWorld);
      body.armR.setMatrixAt(i, rig.armR.matrixWorld);
      body.legL.setMatrixAt(i, rig.legL.matrixWorld);
      body.legR.setMatrixAt(i, rig.legR.matrixWorld);
      body.pack.setMatrixAt(i, rig.pack.matrixWorld);
      body.flame.setMatrixAt(i, rig.flame.matrixWorld);
      const state = builder.agent.state;
      if (
        delta > 0 &&
        !flying &&
        state === AGENT_STATE.WORKING &&
        hammerAt % 1 < (hammerAt - delta * 1.25) % 1
      ) {
        const strike = rig.root.localToWorld(scratch.set(0.155, 0.3, 0.38));
        for (let k = 0; k < 6; k += 1) {
          sparkColor.set(k % 2 === 0 ? "#fff2c8" : "#ffb870").multiplyScalar(2.2);
          effects.spark(
            strike,
            Math.sin(k * 2.1 + elapsed) * 1.2,
            1 + (k % 3) * 0.6,
            Math.cos(k * 1.7 + elapsed) * 1.2,
            sparkColor,
            0.3 + (k % 2) * 0.2,
            0.13,
          );
        }
      }
      if (
        delta > 0 &&
        state === AGENT_STATE.STUCK &&
        Math.sin(elapsed * 0.7 + builder.phase) > 0.995
      ) {
        sparkColor.set("#cfe0d8").multiplyScalar(1.4);
        effects.spark(
          scratch.copy(builder.work).add(ahead.set(0, 0.95 * BUILDER_SCALE, 0)),
          0.15,
          0.5,
          0.05,
          sparkColor,
          2.2,
          0.18,
          0.995,
        );
      }
      const lifted = builder.site === SITE.REST ? 0 : 1;
      const slack = state === AGENT_STATE.STUCK ? 1 : state === AGENT_STATE.FAILED ? 1.6 : 0;
      const bob = still ? 0 : Math.sin(elapsed * 0.8 + builder.phase) * 0.25;
      const pop =
        chosen.hovered === builder.agent.id || chosen.selected === builder.agent.id ? 1.22 : 1;
      const size =
        (0.62 + 0.17 * Math.log10(Math.expm1(builder.size * Math.log1p(BUILD_FULL_LINES)) + 10)) *
        pop *
        (slack > 0 ? 0.8 : 1) *
        lifted;
      object.position.copy(builder.balloon);
      object.position.y += bob - slack;
      object.rotation.set(
        still ? 0 : Math.sin(elapsed * 0.6 + builder.phase) * 0.05,
        elapsed * 0.1 + builder.phase,
        still ? 0 : Math.cos(elapsed * 0.5 + builder.phase) * 0.05,
      );
      object.scale.set(size, size * (slack > 1 ? 0.62 : slack > 0 ? 0.86 : 1), size);
      object.updateMatrix();
      balloon.envelope.setMatrixAt(i, object.matrix);
      balloon.basket.setMatrixAt(i, object.matrix);
      balloon.burner.setMatrixAt(i, object.matrix);
    });
    for (const mesh of [...Object.values(body), ...Object.values(balloon)])
      mesh.instanceMatrix.needsUpdate = true;
    placeMarkers(elapsed, still);
  };

  const placeMarkers = (elapsed: number, still: boolean) => {
    let count = 0;
    for (const id of [chosen.selected, chosen.hovered]) {
      const builder = builders.find((candidate) => candidate.agent.id === id);
      if (builder === undefined || count >= 2) continue;
      const index = builders.indexOf(builder);
      body.torso.getMatrixAt(index, frame);
      scratch.setFromMatrixPosition(frame);
      const pulse = still ? 1 : 1 + 0.1 * Math.sin(elapsed * 4);
      object.position.set(scratch.x, scratch.y - 0.33 * BUILDER_SCALE + 0.03, scratch.z);
      object.rotation.set(0, 0, 0);
      object.scale.setScalar(BUILDER_SCALE * pulse * (id === chosen.selected ? 1.2 : 0.9));
      object.updateMatrix();
      marker.setMatrixAt(count, object.matrix);
      object.position.set(
        scratch.x,
        scratch.y + 0.85 * BUILDER_SCALE + (still ? 0 : Math.sin(elapsed * 3) * 0.08),
        scratch.z,
      );
      object.rotation.set(0, still ? 0 : elapsed * 2, 0);
      object.scale.setScalar(BUILDER_SCALE * (id === chosen.selected ? 1.3 : 0.9));
      object.updateMatrix();
      beacon.setMatrixAt(count, object.matrix);
      count += 1;
      if (chosen.hovered === chosen.selected) break;
    }
    marker.count = count;
    beacon.count = count;
    marker.instanceMatrix.needsUpdate = true;
    beacon.instanceMatrix.needsUpdate = true;
  };

  /** Raises every shown builder's site, and places the builders, from the view. */
  const raise = (
    agents: readonly AgentView[],
    isles: ReadonlyMap<string, Isle>,
    extent: number,
  ) => {
    const raising: Raising = {
      towers: [],
      hulls: [],
      rocks: [],
      owners: { tower: [], storey: [], hull: [] },
    };
    const byIsle = new Map<string, AgentView[]>();
    const airborne: AgentView[] = [];
    for (const agent of agents.slice(0, MAX_AGENTS)) {
      const isle = agent.primaryZone === null ? undefined : isles.get(agent.primaryZone);
      if (isle === undefined) airborne.push(agent);
      else byIsle.set(isle.zone.path, [...(byIsle.get(isle.zone.path) ?? []), agent]);
    }
    const placed: Builder[] = [];
    const visitsOf = (agent: AgentView) =>
      agent.touched
        .filter((zone) => zone.path !== agent.primaryZone && zone.weight >= 0.04)
        .slice(0, 3)
        .flatMap((zone) => {
          const isle = isles.get(zone.path);
          return isle === undefined ? [] : [visitOf(isle, agent.id)];
        });
    for (const [path, list] of byIsle) {
      const isle = isles.get(path);
      if (isle === undefined) continue;
      // Note that a builder keeps its plot as the scrubber moves: each asks first for the plot its id hashes to, in id order, and moves on only past one a builder ahead of it holds.
      const ordered = [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
      const held = new Set<number>();
      const dock: SkyDock = { angle: isle.outward + 0.9, level: 0 };
      let overflow = 0;
      for (const agent of ordered) {
        const random = randomOf(hashOf(agent.id));
        const owner = placed.length;
        let points: { work: Vector3; face: Vector3; balloon: Vector3 };
        let site: SiteKind;
        if (agent.state === AGENT_STATE.IDLE) {
          points = rest(isle, random);
          site = SITE.REST;
        } else if (agent.kind === AGENT_KIND.REFACTOR) {
          points = raiseHull(isle, dock, agent.buildSize, raising, owner);
          site = SITE.HULL;
        } else if (held.size < isle.plots.length) {
          let plot = hashOf(agent.id) % isle.plots.length;
          while (held.has(plot)) plot = (plot + 1) % isle.plots.length;
          held.add(plot);
          points = raiseTower(
            isle,
            isle.plots[plot] ?? new Vector3(),
            random() * TAU,
            agent.buildSize,
            raising,
            owner,
            false,
          );
          site = SITE.TOWER;
        } else {
          const theta = isle.outward - 0.9 - overflow * 0.75;
          const out = isle.edgeRadius(theta) + 2.4;
          const at = new Vector3(
            Math.cos(theta) * out,
            isle.topHeight(0, 0) + 0.6 + (overflow % 2) * 1.6,
            Math.sin(theta) * out,
          );
          points = raiseTower(isle, at, random() * TAU, agent.buildSize, raising, owner, true);
          site = SITE.FLOATING;
          overflow += 1;
        }
        placed.push({
          agent,
          site,
          ...points,
          visits: visitsOf(agent),
          period: 34 + random() * 22,
          phase: random() * 60,
          size: agent.buildSize,
        });
      }
    }
    airborne.forEach((agent, order) => {
      const random = randomOf(hashOf(agent.id));
      const theta = (order / Math.max(1, airborne.length)) * TAU + 0.4;
      const reach = Math.min(extent * 0.45, 20 + order * 2);
      const at = new Vector3(
        Math.cos(theta) * reach,
        34 + (order % 3) * 4,
        Math.sin(theta) * reach,
      );
      placed.push({
        agent,
        site: SITE.AIRBORNE,
        work: at.clone().add(new Vector3(0, -0.83 * 1.1, 0)),
        face: at.clone().add(new Vector3(-Math.sin(theta), -0.83, Math.cos(theta))),
        balloon: at,
        visits: [],
        period: 40,
        phase: random() * 60,
        size: agent.buildSize,
      });
    });
    return { placed, raising };
  };

  const writeSites = (raising: Raising) => {
    let storeys = 0;
    let scaffolds = 0;
    storeyOwners = [];
    raising.towers.forEach((tower, index) => {
      const owner = raising.owners.tower[index] ?? 0;
      const builder = builders[owner];
      const kind = builder?.agent.kind;
      const wall =
        kind === AGENT_KIND.FIX ? "#8d8478" : kind === AGENT_KIND.DOCS ? "#e3d9f2" : "#f3e5c4";
      sites.slab.setMatrixAt(index, tower.matrix);
      for (let k = 0; k <= tower.storeys; k += 1) {
        const lift = new Matrix4()
          .makeTranslation(0, 0.2 + k * STOREY, 0)
          .premultiply(tower.matrix);
        if (k < tower.storeys && storeys < MAX_STOREYS) {
          sites.storey.setMatrixAt(storeys, lift);
          sites.storey.setColorAt(storeys, shade.set(wall));
          storeyOwners.push(owner);
          storeys += 1;
        }
        if (scaffolds < MAX_STOREYS + MAX_AGENTS) {
          sites.scaffold.setMatrixAt(scaffolds, lift);
          scaffolds += 1;
        }
      }
      const top = new Matrix4()
        .makeTranslation(0, 0.2 + tower.storeys * STOREY, 0)
        .premultiply(tower.matrix);
      sites.cap.setMatrixAt(index, top);
      sites.signal.setMatrixAt(index, top);
      sites.signal.setColorAt(
        index,
        shade.set(stateColor(builder?.agent.state ?? AGENT_STATE.WORKING, palette.signal)),
      );
    });
    towerOwners = raising.owners.tower;
    for (const mesh of [sites.slab, sites.cap, sites.signal]) mesh.count = raising.towers.length;
    sites.storey.count = storeys;
    sites.scaffold.count = scaffolds;
    raising.hulls.forEach((dock, index) => {
      sites.hull.setMatrixAt(index, dock.matrix);
      const [from, to] = dock.tether;
      const direction = scratch.subVectors(from, to);
      object.position.copy(to);
      object.quaternion.setFromUnitVectors(UP_AXIS, direction.clone().normalize());
      object.scale.set(1, direction.length(), 1);
      object.updateMatrix();
      sites.tether.setMatrixAt(index, object.matrix);
    });
    hullOwners = raising.owners.hull;
    sites.hull.count = raising.hulls.length;
    sites.tether.count = raising.hulls.length;
    raising.rocks.forEach((matrix, index) => {
      sites.rock.setMatrixAt(index, matrix);
    });
    sites.rock.count = raising.rocks.length;
    for (const mesh of Object.values(sites)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  };

  return {
    update: ({ agents, isles, extent, building, failed, selected, hovered, still, elapsed }) => {
      chosen = { selected, hovered };
      lastElapsed = still ? 0 : elapsed;
      // Note that a hover changes only who is chosen, so the sites are raised again only when the agents, the islands, or the layers change.
      const same =
        raised !== undefined &&
        raised.agents === agents &&
        raised.isles === isles &&
        raised.building === building &&
        raised.failed === failed;
      raised = { agents, isles, building, failed };
      if (same) {
        place(lastElapsed, still, 0);
        return;
      }
      const shown = agents.filter(
        (agent) => building || (failed && agent.state === AGENT_STATE.FAILED),
      );
      const { placed, raising } = raise(shown, isles, extent);
      builders = placed;
      targets = builders.map((builder) => ({ kind: PICK_KIND.AGENT, id: builder.agent.id }));
      writeSites(raising);
      builders.forEach((builder, i) => {
        const color = stateColor(builder.agent.state, palette.signal);
        body.torso.setColorAt(
          i,
          shade.set(pickOf(randomOf(hashOf(builder.agent.id) ^ 0x0e), PALETTE.OVERALL)),
        );
        body.head.setColorAt(
          i,
          shade.set(pickOf(randomOf(hashOf(builder.agent.id) ^ 0x5c), PALETTE.SKIN)),
        );
        body.hat.setColorAt(i, shade.set(color));
        balloon.envelope.setColorAt(i, shade.set(color));
      });
      for (const mesh of [...Object.values(body), ...Object.values(balloon)]) {
        mesh.count = builders.length;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
      smoking = builders
        .filter(
          (builder) => builder.agent.state === AGENT_STATE.FAILED && builder.site !== SITE.REST,
        )
        .map((builder) => builder.face.clone().add(new Vector3(0, 0.4, 0)));
      place(lastElapsed, still, 0);
    },
    frame: (delta, elapsed) => {
      lastElapsed = elapsed;
      place(elapsed, false, delta);
    },
    smoking: () => smoking,
  };
}
