import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  type Material,
  type Matrix4,
  SphereGeometry,
} from "three";
import type { CitadelMaterials } from "./materials";

/**
 * kit.ts -- the Citadel's masonry as a kit of instanced parts: every wall block, tower drum, roof, and finial in the world is one instance of a dozen shapes, so the whole town draws in a dozen calls.
 *
 * A build walks the town and `put`s each part with its matrix and colour;
 * `end` sets each mesh's count to what was put. Every mesh is allocated once,
 * in `create`, at a capacity that holds the largest town the snapshot's
 * bounds allow, so a rebuild changes instance matrices and colours and never
 * a mesh. A part past its capacity is left out rather than written past the
 * end of its buffer.
 */

/** The shapes the kit builds with, by what they are made of. */
export const PART = {
  STONE_BOX: "stone-box",
  STONE_DRUM: "stone-drum",
  STONE_FOOT: "stone-foot",
  STONE_OCTAGON: "stone-octagon",
  FRESH_BOX: "fresh-box",
  ROOF_CONE: "roof-cone",
  ROOF_PYRAMID: "roof-pyramid",
  ROOF_GABLE: "roof-gable",
  PLASTER_BOX: "plaster-box",
  TRIM_BOX: "trim-box",
  TRIM_POLE: "trim-pole",
  TRIM_BALL: "trim-ball",
  TENT: "tent",
  RUBBLE: "rubble",
  EMBER_BOX: "ember-box",
  EMBER_DRUM: "ember-drum",
} as const;

export type Part = (typeof PART)[keyof typeof PART];

/** A gable prism: its ridge along x, its triangle in the z-y plane, its base at y = 0. */
function gableGeometry(): BufferGeometry {
  const a = [-0.5, 0, -0.5];
  const b = [-0.5, 0, 0.5];
  const c = [-0.5, 1, 0];
  const d = [0.5, 0, -0.5];
  const e = [0.5, 0, 0.5];
  const f = [0.5, 1, 0];
  const faces = [
    [a, b, c],
    [d, f, e],
    [a, c, f],
    [a, f, d],
    [b, e, f],
    [b, f, c],
    [a, d, e],
    [a, e, b],
  ];
  const positions = faces.flat(2);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    "uv",
    new Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** A part's shape, what it is made of, how many the largest town holds, and whether it casts a shadow. */
interface PartShape {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly capacity: number;
  readonly shadow: boolean;
}

/** Each part's shape, what it is made of, how many the largest town holds, and whether it casts a shadow. */
function partShapes(materials: CitadelMaterials, ember: Material) {
  const box = new BoxGeometry(1, 1, 1);
  return {
    [PART.STONE_BOX]: { geometry: box, material: materials.stone, capacity: 24000, shadow: true },
    [PART.STONE_DRUM]: {
      geometry: new CylinderGeometry(1, 1, 1, 20, 1),
      material: materials.stone,
      capacity: 2400,
      shadow: true,
    },
    [PART.STONE_FOOT]: {
      geometry: new CylinderGeometry(0.8, 1, 1, 18, 1),
      material: materials.stone,
      capacity: 1600,
      shadow: true,
    },
    [PART.STONE_OCTAGON]: {
      geometry: new CylinderGeometry(1, 1, 1, 8, 1),
      material: materials.stone,
      capacity: 600,
      shadow: true,
    },
    [PART.FRESH_BOX]: { geometry: box, material: materials.fresh, capacity: 600, shadow: true },
    [PART.ROOF_CONE]: {
      geometry: new ConeGeometry(1, 1, 16, 1),
      material: materials.roof,
      capacity: 1800,
      shadow: true,
    },
    [PART.ROOF_PYRAMID]: {
      geometry: new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4),
      material: materials.roof,
      capacity: 1200,
      shadow: true,
    },
    [PART.ROOF_GABLE]: {
      geometry: gableGeometry(),
      material: materials.roof,
      capacity: 2400,
      shadow: true,
    },
    [PART.PLASTER_BOX]: {
      geometry: box,
      material: materials.plaster,
      capacity: 2400,
      shadow: true,
    },
    [PART.TRIM_BOX]: { geometry: box, material: materials.plain, capacity: 3000, shadow: true },
    [PART.TRIM_POLE]: {
      geometry: new CylinderGeometry(1, 1, 1, 8, 1),
      material: materials.plain,
      capacity: 1600,
      shadow: true,
    },
    [PART.TRIM_BALL]: {
      geometry: new SphereGeometry(1, 12, 8),
      material: materials.plain,
      capacity: 1600,
      shadow: false,
    },
    [PART.TENT]: {
      geometry: new ConeGeometry(1, 1, 8, 1),
      material: materials.cloth,
      capacity: 60,
      shadow: true,
    },
    [PART.RUBBLE]: {
      geometry: new DodecahedronGeometry(1, 0),
      material: materials.rock,
      capacity: 900,
      shadow: true,
    },
    [PART.EMBER_BOX]: { geometry: box, material: ember, capacity: 800, shadow: false },
    [PART.EMBER_DRUM]: {
      geometry: new CylinderGeometry(1, 1, 1, 8, 1),
      material: ember,
      capacity: 200,
      shadow: false,
    },
  } as const satisfies Record<Part, PartShape>;
}

/** The kit as a build drives it. */
export interface Kit {
  /** Every mesh, to add to the scene once. */
  readonly meshes: readonly InstancedMesh[];
  /** Starts a build: every part's count back to none. */
  readonly begin: () => void;
  /** Puts one part, placed by `matrix`, in `color`. */
  readonly put: (part: Part, matrix: Matrix4, color: string) => void;
  /** Ends a build: each mesh draws what was put. */
  readonly end: () => void;
}

/** The kit, every mesh allocated at its capacity. */
export function buildKit(materials: CitadelMaterials, ember: Material): Kit {
  const shapes = partShapes(materials, ember);
  const meshes = new Map<Part, InstancedMesh>();
  const counts = new Map<Part, number>();
  const white = new Color("#ffffff");
  for (const part of Object.values(PART)) {
    const shape = shapes[part];
    const mesh = new InstancedMesh(shape.geometry, shape.material, shape.capacity);
    mesh.castShadow = shape.shadow;
    mesh.receiveShadow = true;
    // Note that each mesh has its colours from the start, so its shader is compiled with them once.
    mesh.setColorAt(0, white);
    mesh.count = 0;
    meshes.set(part, mesh);
  }
  const colors = new Map<string, Color>();
  const colorOf = (hex: string) => {
    const known = colors.get(hex);
    if (known !== undefined) return known;
    const made = new Color(hex);
    colors.set(hex, made);
    return made;
  };
  return {
    meshes: [...meshes.values()],
    begin: () => {
      for (const part of Object.values(PART)) counts.set(part, 0);
    },
    put: (part, matrix, color) => {
      const mesh = meshes.get(part);
      const count = counts.get(part) ?? 0;
      if (mesh === undefined || count >= shapes[part].capacity) return;
      mesh.setMatrixAt(count, matrix);
      mesh.setColorAt(count, colorOf(color));
      counts.set(part, count + 1);
    },
    end: () => {
      for (const [part, mesh] of meshes) {
        mesh.count = counts.get(part) ?? 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
  };
}
