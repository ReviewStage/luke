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
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  Builder,
  hashOf,
  hidden,
  lerp,
  placing,
  put,
  seeded,
  shapeOf,
  smooth,
  TAU,
  turned,
  UNIT,
} from "./kit";
import { BOARD, type Bounds, DISTRICT_STYLE, type District, type Layout } from "./layout";
import type { RailwayTextures } from "./textures";
import type { Town, Tree } from "./town";

/**
 * scenery.ts -- the model railway's world beyond the streets: the baseboard on its walnut table, the turf and the farmland, the trees, the river with its harbour and lighthouse, the airfield and its little plane, the street lamps, the clocks and beacons, and the coffee mug, pencil and paint pots that sell the scale.
 *
 * The parts there can be many of (trees, lamps, plots, hands, beacons) are
 * instanced meshes allocated once at their bound as the world is created
 * (`sceneryMeshes`); each board only rewrites their instances. The rest is
 * one board's own geometry (`dressBoard`), built when the board is planned
 * and let go when the next one replaces it. Everything that moves here is
 * idle motion (`animate`); a still frame shows the same board at rest.
 */

/** How many of each instanced part the scenery holds. */
const CAPACITY = {
  TREES: 2400,
  LAMPS: 1400,
  HAY: 64,
  CLOCK_HANDS: 480,
  BEACONS: 240,
  WINDMILLS: 64,
  BOATS: 6,
} as const;

/** The hedgerows' green and the curbs' stone, painted into the welded works. */
const HEDGE = new Color("#3f6332");
const CURB = new Color("#e3dccb");

/** The kinds of ground a district's plot is laid in, each one instanced mesh of its own. */
const PLOT_GROUND = {
  COBBLE: "cobble",
  GRAVEL: "gravel",
  CONCRETE: "concrete",
  LAWN: "lawn",
  DIRT: "dirt",
} as const;

export type PlotGround = (typeof PLOT_GROUND)[keyof typeof PLOT_GROUND];

const GROUND_OF = {
  [DISTRICT_STYLE.STATION]: PLOT_GROUND.COBBLE,
  [DISTRICT_STYLE.YARD]: PLOT_GROUND.GRAVEL,
  [DISTRICT_STYLE.SIGNAL]: PLOT_GROUND.GRAVEL,
  [DISTRICT_STYLE.WATER_TOWER]: PLOT_GROUND.GRAVEL,
  [DISTRICT_STYLE.MAST]: PLOT_GROUND.LAWN,
  [DISTRICT_STYLE.CONTROL]: PLOT_GROUND.COBBLE,
  [DISTRICT_STYLE.CLOCK_TOWER]: PLOT_GROUND.COBBLE,
  [DISTRICT_STYLE.FACTORY]: PLOT_GROUND.GRAVEL,
  [DISTRICT_STYLE.WORKSHOP]: PLOT_GROUND.GRAVEL,
  [DISTRICT_STYLE.OFFICE]: PLOT_GROUND.CONCRETE,
  [DISTRICT_STYLE.WAREHOUSE]: PLOT_GROUND.CONCRETE,
  [DISTRICT_STYLE.BANK]: PLOT_GROUND.COBBLE,
  [DISTRICT_STYLE.RADIO]: PLOT_GROUND.LAWN,
  [DISTRICT_STYLE.WINDMILL]: PLOT_GROUND.LAWN,
  [DISTRICT_STYLE.GATE]: PLOT_GROUND.LAWN,
  [DISTRICT_STYLE.SHOPS]: PLOT_GROUND.COBBLE,
  [DISTRICT_STYLE.TOWN]: PLOT_GROUND.LAWN,
  [DISTRICT_STYLE.PAINT]: PLOT_GROUND.COBBLE,
  [DISTRICT_STYLE.BILLBOARD]: PLOT_GROUND.COBBLE,
  [DISTRICT_STYLE.MUSEUM]: PLOT_GROUND.COBBLE,
  [DISTRICT_STYLE.POWER]: PLOT_GROUND.CONCRETE,
  [DISTRICT_STYLE.HARBOR]: PLOT_GROUND.CONCRETE,
  [DISTRICT_STYLE.LUMBER]: PLOT_GROUND.DIRT,
  [DISTRICT_STYLE.UTILITY]: PLOT_GROUND.GRAVEL,
  [DISTRICT_STYLE.AIRPORT]: PLOT_GROUND.CONCRETE,
} as const satisfies { readonly [Style in District["style"]]: PlotGround };

/** Which ground a district's plot is laid in. */
export function groundOf(district: District): PlotGround {
  return GROUND_OF[district.style];
}

/** A plot's radius: inside the gravel band its loop runs on. */
export function plotRadiusOf(district: District): number {
  return district.radius - 1.45;
}

function treeGeometries() {
  const rnd = seeded(5);
  const puffs = [0, 1, 2].map((tier) => {
    const puff = new IcosahedronGeometry(0.62 - tier * 0.1, 0);
    const positions = puff.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      const wobble = 1 + (rnd() - 0.5) * 0.18;
      positions.setXYZ(
        index,
        positions.getX(index) * wobble,
        positions.getY(index) * wobble,
        positions.getZ(index) * wobble,
      );
    }
    return puff
      .translate((rnd() - 0.5) * 0.4, 1.0 + tier * 0.38, (rnd() - 0.5) * 0.4)
      .toNonIndexed();
  });
  const crown = mergeGeometries(puffs);
  crown.computeVertexNormals();
  const pine = mergeGeometries(
    [0, 1, 2].map((tier) =>
      new ConeGeometry(0.62 - tier * 0.15, 0.95, 9)
        .translate(0, 0.85 + tier * 0.5, 0)
        .toNonIndexed(),
    ),
  );
  pine.computeVertexNormals();
  return { crown, pine, trunk: new CylinderGeometry(0.07, 0.1, 0.8, 6).translate(0, 0.4, 0) };
}

/** A windmill's four arms and sails, turning about its local z. */
function rotorGeometry(): BufferGeometry {
  const builder = new Builder();
  const pen = { builder, frame: new Matrix4(), extra: [] };
  for (let arm = 0; arm < 4; arm += 1) {
    pen.frame = placing(0, 0, 0, 0, 1, 1, 1, 0, (arm * Math.PI) / 2);
    put(pen, UNIT.cbox, new Color("#6b4a30"), 0, 1.7, 0, 0, 0.12, 3.2, 0.06);
    put(pen, UNIT.cbox, new Color("#f3ece0"), 0.42, 1.9, 0.03, 0, 0.75, 2.6, 0.03);
  }
  return builder.build();
}

/** The parts of the scenery made once as the world is created, each instanced mesh at its bound. */
export function sceneryMeshes(textures: RailwayTextures) {
  const trees = treeGeometries();
  const leaves = new MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const plotMaterial = (ground: PlotGround) => {
    const map = textures[ground].clone();
    map.repeat.set(2.2, 2.2);
    map.needsUpdate = true;
    return new MeshStandardMaterial({ map, roughness: 0.92 });
  };
  const plotOf = (ground: PlotGround) =>
    new InstancedMesh(new CylinderGeometry(1, 1, 0.06, 48), plotMaterial(ground), 200);
  const plots = {
    [PLOT_GROUND.COBBLE]: plotOf(PLOT_GROUND.COBBLE),
    [PLOT_GROUND.GRAVEL]: plotOf(PLOT_GROUND.GRAVEL),
    [PLOT_GROUND.CONCRETE]: plotOf(PLOT_GROUND.CONCRETE),
    [PLOT_GROUND.LAWN]: plotOf(PLOT_GROUND.LAWN),
    [PLOT_GROUND.DIRT]: plotOf(PLOT_GROUND.DIRT),
  };
  const meshes = {
    crowns: new InstancedMesh(trees.crown, leaves, CAPACITY.TREES),
    pines: new InstancedMesh(trees.pine, leaves, CAPACITY.TREES),
    trunks: new InstancedMesh(
      trees.trunk,
      new MeshStandardMaterial({ color: "#5a4030", roughness: 1 }),
      CAPACITY.TREES,
    ),
    hay: new InstancedMesh(
      new CylinderGeometry(0.32, 0.32, 0.5, 12).rotateZ(Math.PI / 2).translate(0, 0.32, 0),
      new MeshStandardMaterial({ color: "#d9b860", roughness: 1 }),
      CAPACITY.HAY,
    ),
    lampPosts: new InstancedMesh(
      new CylinderGeometry(0.035, 0.05, 1, 6).translate(0, 0.5, 0),
      new MeshStandardMaterial({ color: "#2f3a33", roughness: 0.5, metalness: 0.4 }),
      CAPACITY.LAMPS,
    ),
    lampBulbs: new InstancedMesh(
      new CylinderGeometry(0.1, 0.1, 0.16, 8),
      new MeshBasicMaterial({ color: "#fff3d0" }),
      CAPACITY.LAMPS,
    ),
    hands: new InstancedMesh(
      new BoxGeometry(1, 1, 0.03).translate(0, 0.5, 0),
      new MeshStandardMaterial({ color: "#1e1b18" }),
      CAPACITY.CLOCK_HANDS,
    ),
    beacons: new InstancedMesh(
      new CylinderGeometry(0.16, 0.16, 0.24, 8),
      new MeshBasicMaterial({ color: "#ffffff" }),
      CAPACITY.BEACONS,
    ),
    rotors: new InstancedMesh(
      rotorGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
      CAPACITY.WINDMILLS,
    ),
    hulls: new InstancedMesh(
      hullGeometry(),
      new MeshStandardMaterial({ roughness: 0.5 }),
      CAPACITY.BOATS,
    ),
    cabins: new InstancedMesh(
      new BoxGeometry(0.7, 0.45, 0.6).translate(-0.3, 0.55, 0),
      new MeshStandardMaterial({ color: "#f4efe4" }),
      CAPACITY.BOATS,
    ),
    plots,
  };
  for (const mesh of [meshes.crowns, meshes.pines, meshes.trunks]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  for (const mesh of Object.values(plots)) mesh.receiveShadow = true;
  return meshes;
}

export type SceneryMeshes = ReturnType<typeof sceneryMeshes>;

/** A rowing boat's hull, its bow rounded. */
function hullGeometry(): BufferGeometry {
  const outline = new Shape();
  outline.moveTo(-1, -0.45);
  outline.lineTo(0.7, -0.45);
  outline.quadraticCurveTo(1.3, 0, 0.7, 0.45);
  outline.lineTo(-1, 0.45);
  outline.closePath();
  return new ExtrudeGeometry(outline, { depth: 0.5, bevelEnabled: false })
    .rotateX(-Math.PI / 2)
    .translate(0, -0.15, 0);
}

/** The materials the board's own geometry is drawn in, made once. */
export function sceneryMaterials(textures: RailwayTextures) {
  const grass = textures.grass.clone();
  grass.repeat.set(0.07, 0.07);
  grass.needsUpdate = true;
  const wood = textures.wood.clone();
  wood.repeat.set(2, 1.4);
  wood.needsUpdate = true;
  const crops = textures.crops.clone();
  crops.needsUpdate = true;
  const ripples = textures.ripples.clone();
  ripples.repeat.set(0.08, 0.08);
  ripples.needsUpdate = true;
  const gravel = textures.gravel.clone();
  gravel.repeat.set(0.25, 0.25);
  gravel.needsUpdate = true;
  return {
    turf: new MeshStandardMaterial({ map: grass, color: "#e4e9d8", roughness: 0.95 }),
    patches: new MeshStandardMaterial({
      map: textures.patches,
      transparent: true,
      roughness: 1,
      depthWrite: false,
    }),
    fascia: new MeshStandardMaterial({ color: "#2b211b", roughness: 0.55, metalness: 0.05 }),
    trim: new MeshStandardMaterial({ color: "#b8893a", metalness: 0.9, roughness: 0.3 }),
    table: new MeshStandardMaterial({ map: wood, roughness: 0.5 }),
    floor: new MeshStandardMaterial({ color: "#1c1714", roughness: 1 }),
    props: new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.15 }),
    works: new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }),
    sand: new MeshStandardMaterial({ color: "#d9c08e", roughness: 1, side: DoubleSide }),
    water: new MeshPhysicalMaterial({
      color: "#1f6a80",
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      normalMap: ripples,
      normalScale: new Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.94,
      side: DoubleSide,
    }),
    lighthouse: new MeshBasicMaterial({ color: new Color(1, 0.9, 0.6) }),
    beam: new MeshBasicMaterial({
      color: "#ffe7a8",
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
    plane: new MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }),
    fields: new MeshStandardMaterial({ map: crops, vertexColors: true, roughness: 1 }),
    band: new MeshStandardMaterial({ map: gravel, color: "#c8bfa9", roughness: 1 }),
  };
}

export type SceneryMaterials = ReturnType<typeof sceneryMaterials>;

/** The baseboard's outline: the board's bounds with rounded corners. */
function boardShape({ x0, x1, z0, z1 }: Bounds): Shape {
  const shape = new Shape();
  const r = 9;
  shape.moveTo(x0 + r, z0);
  shape.lineTo(x1 - r, z0);
  shape.quadraticCurveTo(x1, z0, x1, z0 + r);
  shape.lineTo(x1, z1 - r);
  shape.quadraticCurveTo(x1, z1, x1 - r, z1);
  shape.lineTo(x0 + r, z1);
  shape.quadraticCurveTo(x0, z1, x0, z1 - r);
  shape.lineTo(x0, z0 + r);
  shape.quadraticCurveTo(x0, z0, x0 + r, z0);
  return shape;
}

/** The baseboard, its brass trim, and the table and floor beneath it. */
function baseboard(bounds: Bounds, materials: SceneryMaterials): Mesh[] {
  const outline = boardShape(bounds);
  const slab = new ExtrudeGeometry(outline, {
    depth: BOARD.THICKNESS,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.25,
    bevelSegments: 2,
    curveSegments: 10,
  }).rotateX(Math.PI / 2);
  const board = new Mesh(slab, [materials.turf, materials.fascia]);
  board.position.y = -0.25;
  board.receiveShadow = true;
  board.castShadow = true;
  const rim = outline.getSpacedPoints(400).map((point) => new Vector3(point.x, -0.15, point.y));
  const trim = new Mesh(
    new TubeGeometry(new CatmullRomCurve3(rim, true), 400, 0.12, 6, true),
    materials.trim,
  );
  const width = bounds.x1 - bounds.x0 + 150;
  const depth = bounds.z1 - bounds.z0 + 76;
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2 + 4;
  const top = new BoxGeometry(width, 6, depth).translate(cx, -BOARD.THICKNESS - 3, cz);
  const legs = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) =>
      new BoxGeometry(8, 120, 8).translate(
        cx + sx * (width / 2 - 8),
        -BOARD.THICKNESS - 66,
        cz + sz * (depth / 2 - 8),
      ),
    ),
  );
  const table = new Mesh(mergeGeometries([top, ...legs]), materials.table);
  table.receiveShadow = true;
  const turf = new Mesh(
    new PlaneGeometry(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0).rotateX(-Math.PI / 2),
    materials.patches,
  );
  turf.position.set((bounds.x0 + bounds.x1) / 2, 0.012, (bounds.z0 + bounds.z1) / 2);
  turf.receiveShadow = true;
  const floor = new Mesh(new PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), materials.floor);
  floor.position.y = -BOARD.THICKNESS - 126;
  return [board, turf, trim, table, floor];
}

/** A coffee mug, a pencil, paint pots, a brush, and the train controller with its cable, welded into one mesh. */
function props(bounds: Bounds, materials: SceneryMaterials, works: Builder) {
  const pen = { builder: works, frame: new Matrix4(), extra: [] };
  const table = -BOARD.THICKNESS;
  const width = bounds.x1 - bounds.x0;
  const cx = (bounds.x0 + bounds.x1) / 2;
  const mug = { x: cx - width * 0.36, z: bounds.z1 + 16 };
  const mugProfile = [
    [0, 0],
    [6.2, 0],
    [6.6, 0.6],
    [6.6, 13],
    [6.1, 13],
    [6.0, 1.2],
    [0, 1.2],
  ].map(([x = 0, y = 0]) => new Vector2(x, y));
  put(pen, shapeOf(new LatheGeometry(mugProfile, 40)), new Color("#e9e2d4"), mug.x, table, mug.z);
  put(
    pen,
    shapeOf(new CylinderGeometry(6.65, 6.65, 2.2, 40, 1, true)),
    new Color("#c8553d"),
    mug.x,
    table + 9.5,
    mug.z,
  );
  put(
    pen,
    shapeOf(new TorusGeometry(3.2, 0.8, 12, 24, Math.PI * 1.2)),
    new Color("#e9e2d4"),
    mug.x - 6.6,
    table + 6.5,
    mug.z,
    Math.PI,
    1,
    1,
    1,
    0,
    -Math.PI * 0.6,
  );
  put(
    pen,
    shapeOf(new CylinderGeometry(6.05, 6.05, 0.1, 32)),
    new Color("#3a2214"),
    mug.x,
    table + 11.6,
    mug.z,
  );
  pen.frame = placing(cx + width * 0.18, table + 0.9, bounds.z1 + 16, 0.5, 1, 1, 1, 0, Math.PI / 2);
  put(pen, shapeOf(new CylinderGeometry(0.9, 0.9, 30, 6)), new Color("#f2b632"), 0, -15, 0);
  put(pen, shapeOf(new ConeGeometry(0.9, 3, 6)), new Color("#e8c79a"), 0, 16.5, 0);
  put(pen, shapeOf(new ConeGeometry(0.3, 1, 6)), new Color("#333333"), 0, 17.5, 0);
  put(pen, UNIT.cyl, new Color("#c0c4c8"), 0, -17, 0, 0, 1.9, 2, 1.9);
  put(pen, UNIT.cyl, new Color("#e98aa0"), 0, -19, 0, 0, 1.8, 2, 1.8);
  pen.frame = new Matrix4();
  ["#e98aab", "#4cb3b0", "#f4c95d", "#7fa3d9"].forEach((paint, index) => {
    const px = bounds.x1 + 8 + (index % 2) * 5.2;
    const pz = bounds.z0 + 14 + Math.floor(index / 2) * 5.2;
    put(pen, UNIT.cyl, new Color("#ececec"), px, table, pz, 0, 4.4, 2.6, 4.4);
    put(pen, UNIT.cyl, new Color(paint), px, table + 2.45, pz, 0, 4.0, 0.06, 4.0);
  });
  pen.frame = placing(bounds.x1 + 12, table + 0.45, bounds.z0 + 30, -0.8, 1, 1, 1, 0, Math.PI / 2);
  put(pen, shapeOf(new CylinderGeometry(0.35, 0.25, 16, 10)), new Color("#b03a3f"), 0, 0, 0);
  put(pen, shapeOf(new CylinderGeometry(0.45, 0.2, 2.6, 10)), new Color("#4cb3b0"), 0, 9.2, 0);
  const controller = { x: bounds.x1 - 16, z: bounds.z1 + 17 };
  pen.frame = placing(controller.x, table, controller.z, -0.15);
  put(pen, UNIT.box, new Color("#7a1f1b"), 0, 0, 0, 0, 14, 5, 10);
  put(pen, UNIT.box, new Color("#1f1c1a"), 0, 5, 0, 0, 12, 0.3, 8);
  put(pen, UNIT.box, new Color("#d8d8d8"), 3.5, 5.2, 1.5, 0, 0.5, 2.0, 0.5, 0.4);
  put(pen, UNIT.cyl, new Color("#ff5a3a"), 3.5, 5.1, -2, 0, 0.7, 0.3, 0.7);
  pen.frame = new Matrix4();
  const cable = new CatmullRomCurve3([
    new Vector3(bounds.x1 - 16, table + 1, bounds.z1 + 12),
    new Vector3(bounds.x1 - 12, table + 0.4, bounds.z1 + 6),
    new Vector3(bounds.x1 - 4, table + 0.4, bounds.z1 + 4),
    new Vector3(bounds.x1 - 2, table + 1.6, bounds.z1 + 0.6),
  ]);
  put(pen, shapeOf(new TubeGeometry(cable, 40, 0.35, 8)), new Color("#1a1a1a"), 0, 0, 0);
  const knobBuilder = new Builder();
  const knobPen = { builder: knobBuilder, frame: new Matrix4(), extra: [] };
  put(knobPen, shapeOf(new CylinderGeometry(2.2, 2.4, 1.6, 28)), new Color("#d8d8d8"), 0, 0, 0);
  put(knobPen, UNIT.cbox, new Color("#c8553d"), 0, 0.85, -1.2, 0, 0.4, 0.4, 1.6);
  const knob = new Mesh(knobBuilder.build(), materials.props);
  const [kx, kz] = turned(controller.x, controller.z, -0.15, -2, 0);
  knob.position.set(kx, table + 6, kz);
  return knob;
}

/** The river along the left of the board, and its sandy shore. */
function river(layout: Layout, materials: SceneryMaterials): Mesh[] {
  const { x0, z0, z1 } = layout.bounds;
  const outline = new Shape();
  const r = 8;
  outline.moveTo(x0 + 1.4 + r, z0 + 1.4);
  for (let z = z0 + 1.4; z <= z1 - 1.4; z += 1.5) outline.lineTo(layout.shoreAt(z), z);
  outline.lineTo(x0 + 1.4 + r, z1 - 1.4);
  outline.quadraticCurveTo(x0 + 1.4, z1 - 1.4, x0 + 1.4, z1 - 1.4 - r);
  outline.lineTo(x0 + 1.4, z0 + 1.4 + r);
  outline.quadraticCurveTo(x0 + 1.4, z0 + 1.4, x0 + 1.4 + r, z0 + 1.4);
  const sand = new Mesh(new ShapeGeometry(outline, 12).rotateX(Math.PI / 2), materials.sand);
  sand.position.set(1.2, 0.02, 0);
  sand.receiveShadow = true;
  const water = new Mesh(new ShapeGeometry(outline, 12).rotateX(Math.PI / 2), materials.water);
  water.position.y = 0.09;
  water.receiveShadow = true;
  return [sand, water];
}

/** One boat on the river: where it moors, how big, and its bob's phase. */
interface Boat {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly phase: number;
  /** Whether it is the barge that plies up and down the river. */
  readonly barge: boolean;
}

/** A board's harbour: what it built, its lighthouse's beam, and its boats. */
interface Port {
  readonly meshes: readonly Mesh[];
  readonly beam: Mesh;
  readonly boats: readonly Boat[];
}

/** What a board with no district to moor by has for a harbour: nothing, and a beam that never shows. */
const NO_HARBOR: Port = { meshes: [], beam: new Mesh(), boats: [] };

/** The harbour by the district nearest the water: piers, a breakwater with its lighthouse, and the boats. */
function harbor(layout: Layout, materials: SceneryMaterials, works: Builder) {
  const near =
    layout.districts.find((district) => district.style === DISTRICT_STYLE.HARBOR) ??
    layout.districts[0];
  if (near === undefined) return NO_HARBOR;
  const shore = layout.shoreAt(near.z);
  const pen = { builder: works, frame: new Matrix4(), extra: [] };
  const rnd = seeded(hashOf(near.path));
  for (let pier = -1; pier <= 1; pier += 1) {
    const z = near.z + pier * 5.2;
    put(pen, UNIT.box, new Color("#8a6a4a"), shore - 3.5, 0.35, z, 0, 9, 0.12, 1.4);
    for (let pile = 0; pile < 5; pile += 1) {
      for (const side of [-0.6, 0.6])
        put(
          pen,
          UNIT.cyl8,
          new Color("#5a4632"),
          shore - pile * 2 + 0.5,
          -0.2,
          z + side,
          0,
          0.18,
          0.6,
          0.18,
        );
    }
  }
  const tip = { x: shore - 14, z: near.z - near.radius - 3 };
  const rock = shapeOf(new DodecahedronGeometry(0.8));
  for (let stone = 0; stone < 14; stone += 1) {
    const t = stone / 13;
    put(
      pen,
      rock,
      new Color("#8d8a84").offsetHSL(0, 0, (rnd() - 0.5) * 0.08),
      lerp(shore - 1, tip.x, t),
      0.1,
      lerp(tip.z + 4, tip.z, t),
      stone,
      1,
      0.7,
      1,
    );
  }
  for (let band = 0; band < 7; band += 1) {
    const r = 1.3 - band * 0.07;
    put(
      pen,
      UNIT.cyl,
      band % 2 ? new Color("#f6f3ec") : new Color("#c8392f"),
      tip.x,
      0.4 + band * 0.75,
      tip.z,
      0,
      r,
      0.75,
      r,
    );
  }
  put(pen, UNIT.cyl, new Color("#2a2724"), tip.x, 5.65, tip.z, 0, 1.3, 0.2, 1.3);
  put(pen, UNIT.cone, new Color("#c8392f"), tip.x, 6.8, tip.z, 0, 1.2, 0.8, 1.2);
  const lamp = new Mesh(new CylinderGeometry(0.42, 0.42, 0.95, 12), materials.lighthouse);
  lamp.position.set(tip.x, 6.3, tip.z);
  const beam = new Mesh(
    new ConeGeometry(2.2, 18, 24, 1, true).translate(0, -9, 0).rotateZ(Math.PI / 2),
    materials.beam,
  );
  beam.position.copy(lamp.position);
  const boats = Array.from({ length: CAPACITY.BOATS }, (_, index) => ({
    x: shore - 4 - (index % 3) * 3 - (index === 0 ? 8 : 0),
    z: near.z + (index - 2.5) * 5.4,
    scale: index === 0 ? 2.2 : 0.9 + rnd() * 0.4,
    phase: rnd() * TAU,
    barge: index === 0,
  }));
  return { meshes: [lamp, beam], beam, boats };
}

/** The airfield: its runway with its markings, and its edge lights. */
function airfield(layout: Layout, works: Builder, lamps: Lamp[]): void {
  const { runway } = layout;
  const pen = { builder: works, frame: placing(runway.x, 0.05, runway.z, runway.rot), extra: [] };
  put(pen, UNIT.cbox, new Color("#3d3f42"), 0, 0, 0, 0, runway.length, 0.08, runway.width);
  for (let dash = 0; dash < 12; dash += 1) {
    put(
      pen,
      UNIT.cbox,
      new Color("#efe9d8"),
      -runway.length / 2 + 2 + (dash * (runway.length - 4)) / 11,
      0.02,
      0,
      0,
      1.4,
      0.1,
      0.18,
    );
  }
  for (const end of [-1, 1]) {
    for (let bar = 0; bar < 6; bar += 1) {
      put(
        pen,
        UNIT.cbox,
        new Color("#efe9d8"),
        end * (runway.length / 2 - 0.8),
        0.02,
        -1.5 + bar * 0.6,
        0,
        0.2,
        0.1,
        0.25,
      );
    }
  }
  for (const side of [-1, 1]) {
    for (let light = 0; light <= 10; light += 1) {
      const [x, z] = turned(
        runway.x,
        runway.z,
        runway.rot,
        -runway.length / 2 + (light * runway.length) / 10,
        side * (runway.width / 2 + 0.2),
      );
      lamps.push({ x, z, h: 0.12 });
    }
  }
}

/** The little plane that taxis, takes off, circles the room, and lands. */
function plane(materials: SceneryMaterials): Mesh {
  const builder = new Builder();
  const pen = { builder, frame: new Matrix4(), extra: [] };
  const white = new Color("#f2f0ea");
  const red = new Color("#c8553d");
  put(pen, shapeOf(new CapsuleGeometry(0.32, 2.2, 4, 10).rotateZ(Math.PI / 2)), white, 0, 0, 0);
  put(pen, UNIT.cbox, red, 0.2, 0, 0, 0, 0.7, 0.07, 3.6);
  put(pen, UNIT.cbox, red, -1.3, 0.38, 0, 0, 0.5, 0.7, 0.07);
  put(pen, UNIT.cbox, white, -1.3, 0.1, 0, 0, 0.4, 0.06, 1.3);
  put(pen, UNIT.cbox, new Color("#333333"), 1.48, 0, 0, 0, 0.05, 1.0, 0.12);
  const mesh = new Mesh(builder.build(), materials.plane);
  mesh.castShadow = true;
  mesh.scale.setScalar(0.9);
  return mesh;
}

/** A street lamp: where, and how tall. */
interface Lamp {
  readonly x: number;
  readonly z: number;
  readonly h: number;
}

/** A field in the open country: centre, size, and turn. */
interface Field {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly ry: number;
}

/** Answers whether open country at a point is free: on the board, off the water, clear of districts, the runway, the fields, and the track. */
function openCountry(
  layout: Layout,
  fields: readonly Field[],
): (x: number, z: number, pad: number) => boolean {
  const { bounds, runway } = layout;
  const CELL = 3;
  const near = new Map<number, Map<number, [number, number][]>>();
  for (const track of layout.tracks) {
    const count = track.closed ? track.points.length : track.points.length - 1;
    for (let index = 0; index < count; index += 1) {
      const a = track.points[index];
      const b = track.points[(index + 1) % track.points.length];
      if (a === undefined || b === undefined) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.8));
      for (let step = 0; step <= steps; step += 1) {
        const x = lerp(a.x, b.x, step / steps);
        const z = lerp(a.z, b.z, step / steps);
        const column = near.get(Math.floor(x / CELL)) ?? new Map<number, [number, number][]>();
        near.set(Math.floor(x / CELL), column);
        const cell = column.get(Math.floor(z / CELL)) ?? [];
        column.set(Math.floor(z / CELL), cell);
        cell.push([x, z]);
      }
    }
  }
  const nearTrack = (x: number, z: number, r: number) => {
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        const points = near.get(Math.floor(x / CELL) + i)?.get(Math.floor(z / CELL) + j) ?? [];
        if (points.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < r * r)) return true;
      }
    }
    return false;
  };
  return (x, z, pad) => {
    if (x < bounds.x0 + 2 || x > bounds.x1 - 2 || z < bounds.z0 + 2 || z > bounds.z1 - 2)
      return false;
    if (x < layout.shoreAt(z) + 1.5) return false;
    if (layout.districts.some((d) => Math.hypot(x - d.x, z - d.z) < d.radius + pad)) return false;
    const [lx, lz] = turned(0, 0, -runway.rot, x - runway.x, z - runway.z);
    if (Math.abs(lx) < runway.length / 2 + 3 && Math.abs(lz) < runway.width / 2 + 2.5) return false;
    for (const field of fields) {
      const [fx, fz] = turned(0, 0, -field.ry, x - field.x, z - field.z);
      if (Math.abs(fx) < field.w / 2 + pad * 0.6 && Math.abs(fz) < field.d / 2 + pad * 0.6)
        return false;
    }
    return !nearTrack(x, z, 1.3);
  };
}

/** The crop each field grows: its colour, multiplied over the furrows. */
const CROPS = ["#a99258", "#6f8a3c", "#7a5c40", "#8f9a5a", "#b0a066", "#8aa052"] as const;

/** Patchwork fields hedged round in the open country, with hay bales in some, and the trees of the woods and the board's edge. */
function country(layout: Layout, materials: SceneryMaterials, works: Builder) {
  const rnd = seeded(1234);
  const fields: Field[] = [];
  const hay: [number, number][] = [];
  // Note that the open country reads the fields as they are laid, so the track's grid is built once.
  const free = openCountry(layout, fields);
  const { bounds } = layout;
  const plots: BufferGeometry[] = [];
  const hedgePen = { builder: works, frame: new Matrix4(), extra: [] };
  const probes = [
    [0, 0],
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const;
  for (let tries = 0; tries < 900 && fields.length < 16; tries += 1) {
    const w = 8 + rnd() * 10;
    const d = 6 + rnd() * 7;
    const x = lerp(bounds.x0, bounds.x1, rnd());
    const z = lerp(bounds.z0, bounds.z1, rnd());
    const ry = (rnd() - 0.5) * 0.7;
    const fits = probes.every(([a, b]) => {
      const [px, pz] = turned(x, z, ry, (a * w) / 2, (b * d) / 2);
      return free(px, pz, 1.2);
    });
    if (!fits) continue;
    fields.push({ x, z, w, d, ry });
    const crop = new Color(CROPS[Math.floor(rnd() * CROPS.length)] ?? CROPS[0]);
    const plot = new PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    plot.applyMatrix4(placing(x, 0.03, z, ry));
    const uv = plot.getAttribute("uv");
    for (let index = 0; index < uv.count; index += 1)
      uv.setXY(index, uv.getX(index) * (w / 8), uv.getY(index) * (d / 8));
    plot.setAttribute(
      "color",
      new BufferAttribute(
        new Float32Array(plot.getAttribute("position").count * 3).map(
          (_, at) => [crop.r, crop.g, crop.b][at % 3] ?? 1,
        ),
        3,
      ),
    );
    plots.push(plot);
    hedgePen.frame = placing(x, 0, z, ry);
    for (const [hw, hd, ox, oz] of [
      [w, 0.35, 0, d / 2],
      [w, 0.35, 0, -d / 2],
      [0.35, d, w / 2, 0],
      [0.35, d, -w / 2, 0],
    ] as const) {
      put(hedgePen, UNIT.box, HEDGE, ox, 0, oz, 0, hw, 0.45, hd);
    }
    if (rnd() < 0.5) {
      for (let bale = 0; bale < 4; bale += 1)
        hay.push(turned(x, z, ry, (rnd() - 0.5) * w * 0.8, (rnd() - 0.5) * d * 0.8));
    }
  }
  const trees: Tree[] = [];
  for (let tries = 0; tries < 12000 && trees.length < CAPACITY.TREES - 400; tries += 1) {
    const x = lerp(bounds.x0, bounds.x1, rnd());
    const z = lerp(bounds.z0, bounds.z1, rnd());
    const edge = Math.min(x - layout.shoreAt(z), bounds.x1 - x, z - bounds.z0, bounds.z1 - z);
    const grove = 0.5 + 0.5 * Math.sin(x * 0.09 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.08 - 1);
    const chance = edge < 10 ? 0.9 : grove ** 2.2 * 0.6;
    if (rnd() > chance || !free(x, z, 0.9)) continue;
    trees.push({
      x,
      z,
      y: 0,
      scale: 0.55 + rnd() * 0.6 + (edge < 10 ? 0.35 : 0),
      pine: rnd() < 0.3,
      turn: rnd() * TAU,
    });
  }
  const meshes: Mesh[] = [];
  if (plots.length > 0) {
    const farmland = new Mesh(mergeGeometries(plots), materials.fields);
    farmland.receiveShadow = true;
    meshes.push(farmland);
  }
  return { meshes, trees, hay, free };
}

/** The gravel band each loop runs on, and the low curb round each plot, for every district. */
function districtRims(layout: Layout, materials: SceneryMaterials, works: Builder): Mesh[] {
  const bands: BufferGeometry[] = [];
  const pen = { builder: works, frame: new Matrix4(), extra: [] };
  for (const district of layout.districts) {
    const band = new RingGeometry(plotRadiusOf(district), district.radius + 0.15, 56).rotateX(
      -Math.PI / 2,
    );
    band.translate(district.x, 0.015, district.z);
    const positions = band.getAttribute("position");
    const uv = band.getAttribute("uv");
    for (let index = 0; index < positions.count; index += 1)
      uv.setXY(index, positions.getX(index), positions.getZ(index));
    bands.push(band);
    const r = district.radius - 1.55;
    const profile = [
      [r - 0.18, 0],
      [r + 0.18, 0],
      [r + 0.18, 0.14],
      [r - 0.18, 0.14],
      [r - 0.18, 0],
    ].map(([a = 0, b = 0]) => new Vector2(a, b));
    put(pen, shapeOf(new LatheGeometry(profile, 48)), CURB, district.x, 0, district.z);
  }
  if (bands.length === 0) return [];
  const bandMesh = new Mesh(
    mergeGeometries(bands.map((band) => band.toNonIndexed())),
    materials.band,
  );
  bandMesh.receiveShadow = true;
  return [bandMesh];
}

/** One board's scenery, as built: its own meshes, and what moves on it. */
export interface Dressing {
  readonly group: Group;
  readonly knob: Mesh;
  readonly beam: Mesh;
  readonly plane: Mesh;
  readonly boats: readonly Boat[];
  readonly hands: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly ry: number;
    readonly r: number;
  }[];
  readonly beacons: Town["beacons"];
  readonly windmills: Town["windmills"];
  /** Every street and runway lamp, for the night's halos. */
  readonly lamps: readonly Lamp[];
  /** Whether a point in the open country is free, for what is placed there later: a blueprint, a fire truck. */
  readonly free: (x: number, z: number, pad: number) => boolean;
}

/** Sets every instance of the board's instanced scenery: trees, hay, lamps, plots, rotors, and boats. */
function placeInstances(
  layout: Layout,
  town: Town,
  trees: readonly Tree[],
  hay: readonly [number, number][],
  lamps: readonly Lamp[],
  meshes: SceneryMeshes,
): void {
  const matrix = new Matrix4();
  const all = [...town.trees, ...trees].slice(0, CAPACITY.TREES);
  const greens = ["#5f8f3e", "#6e9c45", "#4f7f38", "#7ea64e", "#3f6f34"] as const;
  const autumn = ["#7b8f48", "#5d7a3c", "#87945a", "#6a7f45"] as const;
  let crowns = 0;
  let pines = 0;
  all.forEach((tree, index) => {
    placing(
      tree.x,
      tree.y,
      tree.z,
      tree.turn,
      tree.scale,
      tree.scale * (0.9 + (tree.turn / TAU) * 0.3),
      tree.scale,
      0,
      0,
      matrix,
    );
    meshes.trunks.setMatrixAt(index, matrix);
    const shade = (tree.turn / TAU - 0.5) * 0.08;
    if (tree.pine) {
      meshes.pines.setMatrixAt(pines, matrix);
      meshes.pines.setColorAt(pines, new Color("#35603a").offsetHSL(0, 0, shade));
      pines += 1;
    } else {
      const r = ((tree.turn / TAU) * 997) % 1;
      const leaf =
        r < 0.3
          ? autumn[Math.floor(r * 13) % autumn.length]
          : greens[Math.floor(r * 17) % greens.length];
      meshes.crowns.setMatrixAt(crowns, matrix);
      meshes.crowns.setColorAt(crowns, new Color(leaf ?? greens[0]).offsetHSL(0, 0, shade));
      crowns += 1;
    }
  });
  meshes.trunks.count = all.length;
  meshes.crowns.count = crowns;
  meshes.pines.count = pines;
  const bales = hay.slice(0, CAPACITY.HAY);
  bales.forEach(([x, z], index) => {
    meshes.hay.setMatrixAt(index, placing(x, 0, z, index * 1.7, 1, 1, 1, 0, 0, matrix));
  });
  meshes.hay.count = bales.length;
  const shown = lamps.slice(0, CAPACITY.LAMPS);
  shown.forEach((lamp, index) => {
    meshes.lampPosts.setMatrixAt(index, placing(lamp.x, 0, lamp.z, 0, 1, lamp.h, 1, 0, 0, matrix));
    meshes.lampBulbs.setMatrixAt(
      index,
      placing(lamp.x, lamp.h + 0.06, lamp.z, 0, 1, 1, 1, 0, 0, matrix),
    );
  });
  meshes.lampPosts.count = shown.length;
  meshes.lampBulbs.count = shown.length;
  const counts = new Map<InstancedMesh, number>();
  for (const district of layout.districts) {
    const mesh = meshes.plots[groundOf(district)];
    const index = counts.get(mesh) ?? 0;
    const r = plotRadiusOf(district);
    mesh.setMatrixAt(index, placing(district.x, 0.03, district.z, 0, r, 1, r, 0, 0, matrix));
    counts.set(mesh, index + 1);
  }
  for (const mesh of Object.values(meshes.plots)) mesh.count = counts.get(mesh) ?? 0;
  const mills = town.windmills.slice(0, CAPACITY.WINDMILLS);
  meshes.rotors.count = mills.length;
  meshes.hands.count = Math.min(CAPACITY.CLOCK_HANDS, town.clocks.length * 2);
  meshes.beacons.count = Math.min(CAPACITY.BEACONS, town.beacons.length);
  for (const mesh of [
    meshes.trunks,
    meshes.crowns,
    meshes.pines,
    meshes.hay,
    meshes.lampPosts,
    meshes.lampBulbs,
    ...Object.values(meshes.plots),
  ]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
}

/** Builds one board's scenery, and sets the instanced scenery to match it. */
export function dressBoard(
  layout: Layout,
  town: Town,
  materials: SceneryMaterials,
  meshes: SceneryMeshes,
): Dressing {
  const group = new Group();
  const lamps: Lamp[] = [...town.lamps];
  // Note that every static part painted per vertex (the table's props, the harbour, the runway, the hedges, the curbs) is welded into one mesh, one draw call.
  const works = new Builder();
  const knob = props(layout.bounds, materials, works);
  const port = harbor(layout, materials, works);
  const land = country(layout, materials, works);
  airfield(layout, works, lamps);
  const rims = districtRims(layout, materials, works);
  const welded = new Mesh(works.build(), materials.works);
  welded.castShadow = true;
  welded.receiveShadow = true;
  const flyer = plane(materials);
  group.add(
    ...baseboard(layout.bounds, materials),
    welded,
    knob,
    ...river(layout, materials),
    ...port.meshes,
    flyer,
    ...land.meshes,
    ...rims,
  );
  placeInstances(layout, town, land.trees, land.hay, lamps, meshes);
  meshes.hulls.count = port.boats.length;
  meshes.cabins.count = port.boats.length;
  ["#c8392f", "#2e6fb0", "#f2f0ea", "#2a8a6a", "#e0a43a", "#f2f0ea"].forEach((paint, index) => {
    meshes.hulls.setColorAt(index, new Color(paint));
  });
  if (meshes.hulls.instanceColor !== null) meshes.hulls.instanceColor.needsUpdate = true;
  return {
    group,
    knob,
    beam: port.beam,
    plane: flyer,
    boats: port.boats,
    hands: town.clocks,
    beacons: town.beacons,
    windmills: town.windmills,
    lamps,
    free: land.free,
  };
}

const MOVING = new Matrix4();

/** The plane's lap: taxi along the runway, lift off, circle the room, and come back in, every fifty seconds. */
function fly(layout: Layout, dressing: Dressing, elapsed: number): void {
  const { runway, bounds } = layout;
  const lap = (elapsed % 50) / 50;
  const heading = new Vector3(Math.cos(-runway.rot), 0, Math.sin(-runway.rot));
  const start = new Vector3(runway.x, 0.55, runway.z).addScaledVector(
    heading,
    -runway.length / 2 + 1.5,
  );
  const craft = dressing.plane;
  if (lap < 0.12) {
    const roll = lap / 0.12;
    craft.position.copy(start).addScaledVector(heading, runway.length * 0.9 * roll * roll);
    craft.position.y = 0.55 + Math.max(0, roll - 0.75) * 6;
    craft.rotation.set(0, runway.rot, Math.max(0, roll - 0.75) * 0.8, "YXZ");
    return;
  }
  const k = (lap - 0.12) / 0.88;
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const reach = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) * 0.48;
  const angle = k * TAU;
  const r = reach * (0.9 + 0.1 * Math.sin(angle * 2));
  const y = 14 + 10 * Math.sin((Math.min(1, k * 6) * Math.PI) / 2) * (k < 0.9 ? 1 : (1 - k) / 0.1);
  const lift = start.clone().addScaledVector(heading, runway.length * 0.9);
  const a0 = Math.atan2(lift.z - cz, lift.x - cx);
  const blend = smooth(k * 8);
  const landing = smooth((k - 0.88) / 0.12);
  const next = new Vector3(
    lerp(lift.x, cx + Math.cos(a0 + angle) * r, blend),
    lerp(1.4, y, blend),
    lerp(lift.z, cz + Math.sin(a0 + angle) * r, blend),
  );
  if (landing > 0) next.lerp(start, landing);
  const velocity = next.clone().sub(craft.position);
  craft.position.copy(next);
  if (velocity.lengthSq() > 1e-6)
    craft.rotation.set(
      0,
      Math.atan2(-velocity.z, velocity.x),
      -0.35 * blend * (1 - landing),
      "YXZ",
    );
}

/** Steps the scenery's idle motion: the river, the lighthouse, the boats, the plane, the sails, the beacons, and the controller's knob. */
export function animate(
  layout: Layout,
  dressing: Dressing,
  meshes: SceneryMeshes,
  materials: SceneryMaterials,
  elapsed: number,
  night: number,
): void {
  materials.water.normalMap?.offset.set(elapsed * 0.004, elapsed * 0.0025);
  dressing.beam.rotation.y = elapsed * 0.7;
  dressing.knob.rotation.y = Math.sin(elapsed * 0.2) * 0.4;
  fly(layout, dressing, elapsed);
  const depth = layout.bounds.z1 - layout.bounds.z0;
  const middle = (layout.bounds.z0 + layout.bounds.z1) / 2;
  dressing.boats.forEach((boat, index) => {
    let x = boat.x;
    let z = boat.z;
    let ry = Math.PI / 2;
    if (boat.barge) {
      const span = depth * 0.7;
      const run = (elapsed * 1.2) % (2 * span);
      z = middle - span / 2 + (run < span ? run : 2 * span - run);
      x = layout.bounds.x0 + 9;
      ry = run < span ? -Math.PI / 2 : Math.PI / 2;
    }
    placing(
      x,
      0.15 + Math.sin(elapsed * 1.6 + boat.phase) * 0.06,
      z,
      ry,
      boat.scale,
      boat.scale,
      boat.scale,
      Math.sin(elapsed * 1.3 + boat.phase) * 0.05,
      Math.cos(elapsed * 1.1 + boat.phase) * 0.04,
      MOVING,
    );
    meshes.hulls.setMatrixAt(index, MOVING);
    meshes.cabins.setMatrixAt(index, MOVING);
  });
  dressing.windmills.slice(0, meshes.rotors.count).forEach((mill, index) => {
    placing(mill.x, mill.y, mill.z, mill.face, 1, 1, 1, 0, elapsed * 0.9 + index, MOVING);
    meshes.rotors.setMatrixAt(index, MOVING);
  });
  const tint = new Color();
  dressing.beacons.slice(0, meshes.beacons.count).forEach((beacon, index) => {
    const on = Math.sin(elapsed * 2.2 + beacon.phase) > 0.6;
    meshes.beacons.setMatrixAt(
      index,
      placing(beacon.x, beacon.y, beacon.z, 0, 1, 1, 1, 0, 0, MOVING),
    );
    const glow = on ? 2 + 3 * night : 0.3;
    if (beacon.white) tint.setRGB(glow, glow, glow);
    else tint.setRGB(on ? 3 + 3 * night : 0.4, 0.15, 0.1);
    meshes.beacons.setColorAt(index, tint);
  });
  for (const mesh of [meshes.hulls, meshes.cabins, meshes.rotors, meshes.beacons]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }
}

/** Sets the clocks' hands to the instant the board shows: the scrubber's, never the wall's. */
export function setClocks(dressing: Dressing, meshes: SceneryMeshes, instant: number): void {
  const at = new Date(instant);
  const hours = (at.getHours() % 12) + at.getMinutes() / 60;
  const minutes = at.getMinutes() + at.getSeconds() / 60;
  dressing.hands.slice(0, CAPACITY.CLOCK_HANDS / 2).forEach((face, index) => {
    for (const [hand, share, length, width] of [
      [0, hours / 12, face.r * 0.55, 0.07],
      [1, minutes / 60, face.r * 0.85, 0.045],
    ] as const) {
      placing(face.x, face.y, face.z, face.ry, width, length, 1, 0, -share * TAU, MOVING);
      meshes.hands.setMatrixAt(index * 2 + hand, MOVING);
    }
  });
  meshes.hands.instanceMatrix.needsUpdate = true;
}

/** Hides every instance of the board's moving scenery, so a fresh board starts from nothing stale. */
export function clearMoving(meshes: SceneryMeshes): void {
  for (const mesh of [meshes.hulls, meshes.cabins, meshes.rotors, meshes.beacons]) {
    for (let index = 0; index < mesh.count; index += 1)
      mesh.setMatrixAt(index, hidden(0, 0, 0, MOVING));
  }
}
