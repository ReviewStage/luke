import type { FactoryPlanned } from "@luke/features/factory-world-wire";
import { LINEAR_PRIORITY } from "@luke/features/factory-world-wire";
import type { SIGNAL_COLOR } from "@luke/ui/factory-world";
import {
  BoxGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Shape,
} from "three";
import { hashOf, placing, seeded, TAU } from "./kit";
import type { Layout } from "./layout";

/**
 * planned.ts -- the Linear issues planned: a blueprint for each, cut in the outline of what it will become and stood on its easel at the edge of the district it is planned in, as tall as it is pressing.
 *
 * A blueprint is planned's colour, ruled with the white grid and window
 * marks of a drawing; the ruling is drawn in its shader from its own
 * coordinates, so it needs no texture. There are four outlines, each an
 * instanced mesh allocated at the contract's bound. An issue placed on no zone
 * stands with the others on the drawing board along the front of the layout.
 */

/** The most issues a snapshot holds (`FACTORY_WORLD_BOUNDS.MAX_PLANNED`). */
const CAPACITY = 50;

/** A blueprint's height by its issue's priority: urgent tallest. */
const HEIGHT_OF_PRIORITY = {
  [LINEAR_PRIORITY.NONE]: 3.4,
  [LINEAR_PRIORITY.URGENT]: 7.5,
  [LINEAR_PRIORITY.HIGH]: 6.4,
  [LINEAR_PRIORITY.MEDIUM]: 4.6,
  [LINEAR_PRIORITY.LOW]: 3.4,
} as const;

/** The four outlines a blueprint is cut in, each one unit wide and tall: a house, a tower, a works, a hall. */
function outlines(): Shape[] {
  const house = new Shape();
  house.moveTo(-0.5, 0);
  house.lineTo(0.5, 0);
  house.lineTo(0.5, 0.62);
  house.lineTo(0, 1);
  house.lineTo(-0.5, 0.62);
  const tower = new Shape();
  for (const [x, y] of [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 0.55],
    [0.175, 0.55],
    [0.175, 0.9],
    [0.06, 1],
    [-0.06, 1],
    [-0.175, 0.9],
    [-0.175, 0.55],
    [-0.5, 0.55],
  ] as const) {
    if (x === -0.5 && y === 0) tower.moveTo(x, y);
    else tower.lineTo(x, y);
  }
  const works = new Shape();
  for (const [x, y] of [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 0.7],
    [0.165, 1],
    [0.165, 0.7],
    [-0.165, 1],
    [-0.165, 0.7],
    [-0.5, 1],
  ] as const) {
    if (x === -0.5 && y === 0) works.moveTo(x, y);
    else works.lineTo(x, y);
  }
  const hall = new Shape();
  hall.moveTo(-0.5, 0);
  hall.lineTo(0.5, 0);
  hall.lineTo(0.5, 0.6);
  hall.absarc(0, 0.6, 0.5, 0, Math.PI, false);
  return [house, tower, works, hall].map((shape) => {
    shape.closePath();
    return shape;
  });
}

/** Rules a blueprint's face: a fine white grid, and window marks on its lower storeys, from its own scaled coordinates. */
function ruled(material: MeshStandardMaterial): MeshStandardMaterial {
  material.customProgramCacheKey = () => "railway-blueprint";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec2 vDrawing;\nvarying float vFace;\n${shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vec2 drawn = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
      vDrawing = position.xy * drawn;
      vFace = abs(normal.z);`,
    )}`;
    shader.fragmentShader = `varying vec2 vDrawing;\nvarying float vFace;\n${shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec2 grid = abs(fract(vDrawing * 2.4) - 0.5);
      float rule = step(0.44, max(grid.x, grid.y)) * 0.22;
      vec2 cell = fract(vec2(vDrawing.x + 0.5, vDrawing.y) / vec2(0.6, 0.7));
      vec2 inside = step(vec2(0.25, 0.3), cell) * step(cell, vec2(0.75, 0.8));
      vec2 rim = step(vec2(0.31, 0.36), cell) * step(cell, vec2(0.69, 0.74));
      float window = (inside.x * inside.y - rim.x * rim.y) * 0.9;
      float face = step(0.5, vFace);
      diffuseColor.rgb = mix(vec3(0.88, 0.84, 0.75), diffuseColor.rgb, face);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), max(rule, window) * face);`,
    )}`;
  };
  return material;
}

/** The blueprints' meshes, one per outline, and their easels', made once. */
export function plannedMeshes(signal: typeof SIGNAL_COLOR) {
  const face = ruled(
    new MeshStandardMaterial({
      roughness: 0.85,
      side: DoubleSide,
      emissive: new Color(signal.PLANNED),
      emissiveIntensity: 0.12,
    }),
  );
  const edge = new MeshStandardMaterial({ color: "#f1ece0", roughness: 0.9 });
  const sheets = outlines().map((outline) => {
    const mesh = new InstancedMesh(
      new ExtrudeGeometry(outline, { depth: 0.06, bevelEnabled: false }),
      face,
      CAPACITY,
    );
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  });
  const easels = new InstancedMesh(
    new BoxGeometry(0.05, 1, 0.6).translate(0, 0.5, -0.32),
    edge,
    CAPACITY,
  );
  easels.count = 0;
  return { sheets, easels, face };
}

export type PlannedMeshes = ReturnType<typeof plannedMeshes>;

/** One issue's blueprint as stood: its outline, its slot in that outline's mesh, and where and how big. */
export interface Blueprint {
  readonly issue: FactoryPlanned;
  readonly outline: number;
  readonly slot: number;
  readonly x: number;
  readonly z: number;
  readonly ry: number;
  readonly width: number;
  readonly height: number;
  readonly phase: number;
}

/** Where each issue's blueprint stands: just outside its zone's curb, toward the front, clear of the others and of the country's fields and track. */
export function standBlueprints(
  issues: readonly FactoryPlanned[],
  layout: Layout,
  free: (x: number, z: number, pad: number) => boolean,
): Blueprint[] {
  const stood: Blueprint[] = [];
  const slots = [0, 0, 0, 0];
  let unplaced = 0;
  for (const issue of issues.slice(0, CAPACITY)) {
    const rnd = seeded(hashOf(issue.identifier));
    const height = HEIGHT_OF_PRIORITY[issue.priority ?? LINEAR_PRIORITY.NONE];
    const width = height * (0.55 + rnd() * 0.35);
    const zonePath = issue.zonePaths.find((path) => layout.byPath.has(path));
    const district = zonePath === undefined ? undefined : layout.byPath.get(zonePath);
    let at: { x: number; z: number } | undefined;
    for (let tries = 0; district !== undefined && tries < 80 && at === undefined; tries += 1) {
      const angle =
        Math.PI / 2 + (tries % 2 ? 1 : -1) * Math.floor(tries / 2) * 0.32 + (rnd() - 0.5) * 0.2;
      const r = district.radius + 1.6 + width * 0.35 + (tries > 40 ? 1.5 : 0);
      const x = district.x + Math.cos(angle) * r;
      const z = district.z + Math.sin(angle) * r;
      if (
        !free(x, z, 1) ||
        stood.some((other) => Math.hypot(other.x - x, other.z - z) < (other.width + width) * 0.55)
      )
        continue;
      at = { x, z };
    }
    if (at === undefined) {
      // Note that an issue with nowhere of its own stands in the row along the front of the board.
      const { x0, x1, z1 } = layout.bounds;
      at = {
        x: x0 + 30 + ((unplaced * 5.5) % Math.max(10, x1 - x0 - 50)),
        z: z1 - 5 - Math.floor((unplaced * 5.5) / Math.max(10, x1 - x0 - 50)) * 4,
      };
      unplaced += 1;
    }
    const outline = hashOf(issue.identifier) % 4;
    const slot = slots[outline] ?? 0;
    slots[outline] = slot + 1;
    stood.push({
      issue,
      outline,
      slot,
      x: at.x,
      z: at.z,
      ry: (rnd() - 0.5) * 0.5,
      width,
      height,
      phase: rnd() * TAU,
    });
  }
  return stood;
}

/** Paints every blueprint in planned's colour, or selection's where it is chosen. */
export function paintBlueprints(
  blueprints: readonly Blueprint[],
  meshes: PlannedMeshes,
  signal: typeof SIGNAL_COLOR,
  chosen: (identifier: string) => boolean,
  night: number,
): void {
  const tint = new Color();
  for (const print of blueprints) {
    meshes.sheets[print.outline]?.setColorAt(
      print.slot,
      tint.set(chosen(print.issue.identifier) ? signal.SELECTION : signal.PLANNED),
    );
  }
  meshes.sheets.forEach((mesh, outline) => {
    mesh.count = blueprints.filter((print) => print.outline === outline).length;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  });
  meshes.easels.count = blueprints.length;
  meshes.face.emissiveIntensity = 0.12 + night * 0.45;
}

const MOVING = new Matrix4();

/** Stands every blueprint on its easel, swaying a little in the draught while motion runs. */
export function swayBlueprints(
  blueprints: readonly Blueprint[],
  meshes: PlannedMeshes,
  time: number,
): void {
  blueprints.forEach((print, index) => {
    placing(
      print.x,
      0,
      print.z,
      print.ry,
      print.width,
      print.height,
      1,
      Math.sin(time * 0.9 + print.phase) * 0.025,
      0,
      MOVING,
    );
    meshes.sheets[print.outline]?.setMatrixAt(print.slot, MOVING);
    meshes.easels.setMatrixAt(
      index,
      placing(print.x, 0, print.z, print.ry, 1, print.height * 0.45, 1, 0.5, 0, MOVING),
    );
  });
  for (const mesh of [...meshes.sheets, meshes.easels]) mesh.instanceMatrix.needsUpdate = true;
}
