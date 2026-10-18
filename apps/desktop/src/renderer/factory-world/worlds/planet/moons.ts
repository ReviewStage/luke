import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import { MAX_MOONS, type MoonZone, moonMatrix, type PlanetLayout } from "./globe";
import {
  clamp,
  flush,
  GLSL_OUTPUT,
  hash,
  noise3,
  rng,
  rotateToward,
  type SharedUniforms,
  seedOf,
  withInstanceGlow,
} from "./kit";

/**
 * moons.ts -- the tooling zones as moons: cratered rocks in orbit, each with a small outpost of domes and lamps so it reads as inhabited.
 *
 * A repository's tooling stands apart from the product's graph, as a moon
 * stands apart from its planet: each tooling zone is one moon, as large as
 * its footprint, on an orbit its layout seeds. All the moons are one
 * instanced mesh, their domes another, and their lamps one set of points,
 * so a repository with many tools costs no more draw calls than one with
 * two. A moon glows in the blast radius's colour, or the selection's, as
 * its zone does.
 */

/** How many domes each moon's outpost has. */
const DOMES = 4;

const DOME_TONE = new Color(0xe8ecf4);

/** One rock, cratered: every moon is this rock, turned and sized its own way. */
function rockGeometry(): BufferGeometry {
  const base = new IcosahedronGeometry(1, 10);
  base.deleteAttribute("normal");
  base.deleteAttribute("uv");
  const geometry = mergeVertices(base);
  base.dispose();
  const positions = geometry.getAttribute("position");
  const shade = new Float32Array(positions.count * 3);
  const direction = new Vector3();
  const craters = Array.from({ length: 7 }, (_, crater) =>
    new Vector3(
      hash(crater + 13) - 0.5,
      hash(crater * 3.1 + 1) - 0.5,
      hash(crater * 7.3 + 2) - 0.5,
    ).normalize(),
  );
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    direction.fromBufferAttribute(positions, vertex).normalize();
    let height = noise3(direction.x * 3 + 20, direction.y * 3, direction.z * 3) * 0.08;
    craters.forEach((centre, crater) => {
      const angle = Math.acos(clamp(direction.dot(centre), -1, 1));
      const reach = 0.18 + hash(crater * 2.2) * 0.25;
      if (angle < reach) height -= 0.07 * (1 - (angle / reach) ** 2);
      else if (angle < reach * 1.3) height += 0.03;
    });
    positions.setXYZ(
      vertex,
      direction.x * (1 + height),
      direction.y * (1 + height),
      direction.z * (1 + height),
    );
    const tone =
      0.75 + height * 3 + noise3(direction.x * 9, direction.y * 9, direction.z * 9) * 0.25;
    shade.set([tone, tone, tone], vertex * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(shade, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function lampsOf(shared: SharedUniforms): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(MAX_MOONS * DOMES * 3), 3),
  );
  const points = new Points(
    geometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: shared,
      vertexShader: /* glsl */ `
        uniform float uProjection; uniform float uPixelRatio;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(0.18 * uProjection / -mv.z, 2.0, 18.0) * uPixelRatio; }`,
      fragmentShader: /* glsl */ `
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(2.5, 1.8, 0.9) * a * a, 1.0); ${GLSL_OUTPUT} }`,
    }),
  );
  points.frustumCulled = false;
  return points;
}

/** The moons, placed with the layout and moved along their orbits. */
export interface Moons {
  readonly objects: readonly Object3D[];
  readonly rebuild: (layout: PlanetLayout) => void;
  /** Lights each moon as its zone is: in the blast radius by `blastOf`, chosen by `chosen`. */
  readonly light: (
    blastOf: (moon: MoonZone) => number,
    chosen: (moon: MoonZone) => boolean,
  ) => void;
  readonly place: (t: number) => void;
}

export function createMoons(
  shared: SharedUniforms,
  picking: WorldPicking,
  signal: { blast: Color; chosen: Color },
): Moons {
  const rocks = new InstancedMesh(
    rockGeometry(),
    withInstanceGlow(
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
    ),
    MAX_MOONS,
  );
  const glow = new InstancedBufferAttribute(new Float32Array(MAX_MOONS * 3), 3);
  rocks.geometry.setAttribute("aGlow", glow);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.frustumCulled = false;
  const domes = new InstancedMesh(
    new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshStandardMaterial({
      color: DOME_TONE,
      roughness: 0.35,
      metalness: 0.2,
      emissive: 0x223355,
      emissiveIntensity: 0.25,
    }),
    MAX_MOONS * DOMES,
  );
  domes.castShadow = true;
  domes.frustumCulled = false;
  const lamps = lampsOf(shared);
  let moons: readonly MoonZone[] = [];
  let outposts: { up: Vector3; size: number }[][] = [];
  let targets: PickTarget[] = [];
  picking.addInstances(rocks, (instance) => targets[instance]);

  const frame = new Matrix4();
  const part = new Matrix4();
  const at = new Vector3();
  const tint = new Color();
  const lift = new Color();
  const dome = new Object3D();
  const UP = new Vector3(0, 1, 0);
  return {
    objects: [rocks, domes, lamps],
    rebuild: (layout) => {
      moons = layout.moons;
      targets = moons.map((moon) => ({ kind: PICK_KIND.ZONE, id: moon.view.path }));
      outposts = moons.map((moon) => {
        const draw = rng(seedOf(moon.view.path));
        return Array.from({ length: DOMES }, () => ({
          up: rotateToward(new Vector3(0, 1, 0), 0.25 + draw() * 0.5, draw() * Math.PI * 2),
          size: 0.07 + draw() * 0.1,
        }));
      });
      moons.forEach((moon, index) => {
        rocks.setColorAt(index, tint.copy(moon.tone));
      });
      rocks.count = moons.length;
      domes.count = moons.length * DOMES;
      lamps.geometry.setDrawRange(0, moons.length * DOMES);
      flush(rocks);
    },
    light: (blastOf, chosen) => {
      moons.forEach((moon, index) => {
        tint.copy(signal.blast).multiplyScalar(blastOf(moon) * 0.35);
        if (chosen(moon)) tint.add(lift.copy(signal.chosen).multiplyScalar(0.3));
        glow.setXYZ(index, tint.r, tint.g, tint.b);
      });
      glow.needsUpdate = true;
    },
    place: (t) => {
      const lampPositions = lamps.geometry.getAttribute("position");
      moons.forEach((moon, index) => {
        moonMatrix(moon, t, frame);
        rocks.setMatrixAt(index, part.copy(frame).scale(at.setScalar(moon.radius)));
        (outposts[index] ?? []).forEach(({ up, size }, slot) => {
          dome.position.copy(up).multiplyScalar(moon.radius - 0.03);
          dome.quaternion.setFromUnitVectors(UP, up);
          dome.scale.setScalar(size);
          dome.updateMatrix();
          domes.setMatrixAt(index * DOMES + slot, part.copy(frame).multiply(dome.matrix));
          at.copy(up)
            .multiplyScalar(moon.radius + 0.12)
            .applyMatrix4(frame);
          lampPositions.setXYZ(index * DOMES + slot, at.x, at.y, at.z);
        });
      });
      lampPositions.needsUpdate = true;
      flush(rocks);
      flush(domes);
    },
  };
}
