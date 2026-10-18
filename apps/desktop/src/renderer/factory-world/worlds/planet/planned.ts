import {
  FACTORY_WORLD_BOUNDS,
  type FactoryPlanned,
  LINEAR_PRIORITY,
  type LinearPriority,
} from "@luke/features/factory-world-wire";
import { PICK_KIND, type PickTarget, type WorldPicking } from "@luke/panel/factory-world/world";
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  anchorOf,
  PLANET_RADIUS,
  type PlanetLayout,
  type PlanetZone,
  type Site,
  sampleSite,
  siteInScene,
} from "./globe";
import { flush, rng, type SharedUniforms, seedOf } from "./kit";
import type { Particles } from "./particles";

/**
 * planned.ts -- the planned issues as the planet shows them: a satellite for each, in orbit over the zone its work will land in, beaming a blueprint down to a hologram of it standing there.
 *
 * Each issue's satellite circles over the first zone it is placed on, lower
 * and larger the more pressing the issue, a wireframe blueprint turning
 * beneath it in the planned colour. Where the issue is placed on a zone, a
 * hologram of the blueprint stands on the ground there, a scan sweeping up
 * it, and while motion runs the satellite beams packets down to it. An
 * issue placed on no zone has its satellite in a high parking orbit and no
 * hologram. Every satellite and hologram is picked as its issue.
 */

const MAX = FACTORY_WORLD_BOUNDS.MAX_PLANNED;

/** An issue's size and orbit by its priority: the most pressing largest and lowest. */
const BY_PRIORITY = {
  [LINEAR_PRIORITY.NONE]: { scale: 1, orbit: 3.3 },
  [LINEAR_PRIORITY.URGENT]: { scale: 1.6, orbit: 2 },
  [LINEAR_PRIORITY.HIGH]: { scale: 1.35, orbit: 2.3 },
  [LINEAR_PRIORITY.MEDIUM]: { scale: 1, orbit: 3 },
  [LINEAR_PRIORITY.LOW]: { scale: 0.75, orbit: 3.7 },
} as const satisfies Record<LinearPriority, { scale: number; orbit: number }>;

/** How high an issue placed on no zone parks, above sea level. */
const PARKING_ORBIT = 6.5;

/** A blueprint: three stacked boxes, drawn as their edges in thin bars. */
function blueprintGeometry(): BufferGeometry {
  const boxes = [
    { size: new Vector3(0.34, 0.2, 0.34), centre: new Vector3(0, 0.1, 0) },
    { size: new Vector3(0.24, 0.24, 0.24), centre: new Vector3(0, 0.32, 0) },
    { size: new Vector3(0.12, 0.2, 0.12), centre: new Vector3(0, 0.54, 0) },
  ];
  const bar = 0.012;
  const edges: BufferGeometry[] = [];
  for (const { size, centre } of boxes) {
    const half = size.clone().multiplyScalar(0.5);
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        edges.push(
          new BoxGeometry(size.x, bar, bar).translate(
            centre.x,
            centre.y + a * half.y,
            centre.z + b * half.z,
          ),
          new BoxGeometry(bar, size.y, bar).translate(
            centre.x + a * half.x,
            centre.y,
            centre.z + b * half.z,
          ),
          new BoxGeometry(bar, bar, size.z).translate(
            centre.x + a * half.x,
            centre.y + b * half.y,
            centre.z,
          ),
        );
      }
    }
  }
  return mergeGeometries(edges);
}

function glowing(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

function instanced(geometry: BufferGeometry, material: Material, count: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

/** One issue as drawn: where its satellite circles, and where its hologram stands. */
interface Survey {
  readonly issue: FactoryPlanned;
  readonly over: Vector3;
  readonly axis: Vector3;
  readonly orbit: number;
  readonly speed: number;
  readonly phase: number;
  readonly scale: number;
  readonly site: Site | undefined;
  pop: number;
  beamIn: number;
}

export interface Planned {
  readonly group: Group;
  readonly show: (
    layout: PlanetLayout,
    planned: readonly FactoryPlanned[],
    taken: Map<PlanetZone, Vector3[]>,
  ) => void;
  readonly choose: (chosen: (identifier: string) => boolean) => void;
  /** Moves every satellite and hologram to `t`; while `beaming`, sends packets down. */
  readonly place: (t: number, delta: number, beaming: boolean) => void;
}

export function createPlanned(
  shared: SharedUniforms,
  picking: WorldPicking,
  particles: Particles,
): Planned {
  const planned = shared.uPlanned.value;
  const group = new Group();
  const body = instanced(
    new BoxGeometry(0.2, 0.22, 0.2),
    new MeshStandardMaterial({ color: 0xe4e9f2, metalness: 0.7, roughness: 0.3 }),
    MAX,
  );
  const panels = instanced(
    new BoxGeometry(0.42, 0.012, 0.17),
    new MeshStandardMaterial({
      color: planned.clone().multiplyScalar(0.35),
      metalness: 0.6,
      roughness: 0.3,
      emissive: planned,
      emissiveIntensity: 0.35,
    }),
    MAX * 2,
  );
  body.castShadow = true;
  panels.castShadow = true;
  const blueprints = instanced(blueprintGeometry(), glowing(), MAX * 2);
  const beams = instanced(
    new ConeGeometry(0.26, 0.75, 20, 1, true).translate(0, -0.42, 0),
    glowing(),
    MAX,
  );
  const rings = instanced(new RingGeometry(0.3, 0.33, 40).rotateX(-Math.PI / 2), glowing(), MAX);
  const scans = instanced(new PlaneGeometry(0.46, 0.46).rotateX(-Math.PI / 2), glowing(), MAX);
  const lamps = instanced(
    new SphereGeometry(0.05, 10, 8),
    new MeshBasicMaterial({ color: 0xffffff }),
    MAX,
  );
  const proxies = instanced(
    new SphereGeometry(1, 8, 6),
    new MeshBasicMaterial({ visible: false }),
    MAX * 2,
  );
  group.add(body, panels, blueprints, beams, rings, scans, lamps, proxies);

  let surveys: Survey[] = [];
  let grounded: Survey[] = [];
  let targets: PickTarget[] = [];
  let chosen: (identifier: string) => boolean = () => false;
  picking.addInstances(proxies, (instance) => targets[instance]);

  const paint = () => {
    const tint = new Color();
    const tone = (survey: Survey, strength: number) =>
      tint
        .copy(chosen(survey.issue.identifier) ? shared.uChosen.value : planned)
        .multiplyScalar(strength);
    surveys.forEach((survey, at) => {
      blueprints.setColorAt(at, tone(survey, 2.2));
      beams.setColorAt(at, tone(survey, 0.25));
      lamps.setColorAt(at, tone(survey, 3));
    });
    grounded.forEach((survey, at) => {
      blueprints.setColorAt(surveys.length + at, tone(survey, 1.8));
      rings.setColorAt(at, tone(survey, chosen(survey.issue.identifier) ? 3 : 1.6));
      scans.setColorAt(at, tone(survey, 0.35));
    });
    for (const mesh of [blueprints, beams, lamps, rings, scans]) flush(mesh);
  };

  const show: Planned["show"] = (layout, issues, taken) => {
    surveys = issues.slice(0, MAX).map((issue) => {
      const draw = rng(seedOf(issue.identifier));
      const zone = issue.zonePaths
        .map((path) => layout.byPath.get(path))
        .find((each) => each !== undefined);
      const by = BY_PRIORITY[issue.priority ?? LINEAR_PRIORITY.NONE];
      const over =
        zone === undefined
          ? new Vector3(draw() - 0.5, draw() * 0.6 - 0.1, draw() - 0.5).normalize()
          : anchorOf(layout, zone, 0).normalize();
      const orbit = PLANET_RADIUS + (zone === undefined ? PARKING_ORBIT : by.orbit) + draw() * 0.3;
      const axis = new Vector3()
        .crossVectors(over, new Vector3(draw() - 0.5, draw() - 0.5, draw() - 0.5))
        .normalize();
      const site =
        zone === undefined
          ? undefined
          : sampleSite(layout, zone, draw, taken, { apart: 0.3, spread: 0.55 });
      const speed = (0.9 / (orbit / PLANET_RADIUS) ** 1.5) * (draw() < 0.5 ? 1 : -1) * 0.12;
      return {
        issue,
        over,
        axis,
        orbit,
        speed,
        phase: draw() * Math.PI * 2,
        scale: by.scale,
        site,
        pop: -100,
        beamIn: draw() * 8,
      };
    });
    grounded = surveys.filter((survey) => survey.site !== undefined);
    targets = [...surveys, ...grounded].map((survey) => ({
      kind: PICK_KIND.PLANNED,
      id: survey.issue.identifier,
    }));
    body.count = surveys.length;
    panels.count = surveys.length * 2;
    beams.count = surveys.length;
    lamps.count = surveys.length;
    blueprints.count = surveys.length + grounded.length;
    rings.count = grounded.length;
    scans.count = grounded.length;
    proxies.count = surveys.length + grounded.length;
    paint();
  };

  const frame = new Matrix4();
  const piece = new Matrix4();
  const placing = new Object3D();
  const position = new Vector3();
  const up = new Vector3();
  const down = new Vector3();
  const DOWN = new Vector3(0, -1, 0);
  const UP = new Vector3(0, 1, 0);
  const local = (x: number, y: number, z: number, spin: number, size: number) => {
    placing.position.set(x, y, z);
    placing.rotation.set(0, spin, 0);
    placing.scale.setScalar(size);
    placing.updateMatrix();
    return piece.copy(frame).multiply(placing.matrix);
  };

  const placeSatellite = (survey: Survey, at: number, t: number) => {
    position
      .copy(survey.over)
      .applyAxisAngle(survey.axis, survey.phase + t * survey.speed)
      .multiplyScalar(survey.orbit);
    down.copy(position).normalize().negate();
    placing.position.copy(position);
    placing.quaternion.setFromUnitVectors(DOWN, down);
    placing.rotateY(t * 0.3);
    placing.scale.setScalar(survey.scale);
    placing.updateMatrix();
    frame.copy(placing.matrix);
    body.setMatrixAt(at, frame);
    panels.setMatrixAt(at * 2, local(0.33, 0, 0, 0, 1));
    panels.setMatrixAt(at * 2 + 1, local(-0.33, 0, 0, 0, 1));
    blueprints.setMatrixAt(at, local(0, -0.95, 0, t * 0.8, 0.9));
    beams.setMatrixAt(at, local(0, 0, 0, 0, 1));
    lamps.setMatrixAt(at, local(0, 0.2, 0, 0, 1));
    proxies.setMatrixAt(at, local(0, -0.3, 0, 0, 0.75));
  };

  const placeHologram = (survey: Survey, at: number, t: number, still: boolean) => {
    if (survey.site === undefined) return;
    siteInScene(survey.site, t, position, up);
    placing.position.copy(position);
    placing.quaternion.setFromUnitVectors(UP, up);
    placing.scale.setScalar(1);
    placing.updateMatrix();
    frame.copy(placing.matrix);
    const size = survey.scale * 1.25;
    const pop = Math.exp(-Math.max(t - survey.pop, 0) * 3);
    blueprints.setMatrixAt(surveys.length + at, local(0, 0, 0, 0, size));
    rings.setMatrixAt(at, local(0, 0.01, 0, 0, survey.scale * 1.2 * (1 + pop * 0.8)));
    scans.setMatrixAt(
      at,
      local(0, (still ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.6 + at)) * 0.7 * size, 0, 0, size),
    );
    proxies.setMatrixAt(surveys.length + at, local(0, 0.35, 0, 0, 0.45));
  };

  const beam = (survey: Survey, t: number, delta: number) => {
    if (survey.site === undefined) return;
    survey.beamIn -= delta;
    if (survey.beamIn > 0) return;
    survey.beamIn = 6 + particles.draw() * 6;
    position
      .copy(survey.over)
      .applyAxisAngle(survey.axis, survey.phase + t * survey.speed)
      .multiplyScalar(survey.orbit);
    siteInScene(survey.site, t, down, up);
    const end = down.clone().addScaledVector(up, 0.3);
    const tone = planned;
    for (let packet = 0; packet < 12; packet += 1) {
      const k = packet / 11;
      const along = position.clone().lerp(end, k);
      particles.emit(along, new Vector3(), 0.3 + k * 0.6, 0.07, [
        tone.r * 2,
        tone.g * 2,
        tone.b * 3,
      ]);
    }
    particles.emit(end, new Vector3(), 0.5, 0.5, [tone.r, tone.g * 1.4, tone.b * 3]);
    survey.pop = t;
  };

  return {
    group,
    show,
    choose: (next) => {
      chosen = next;
      paint();
    },
    place: (t, delta, beaming) => {
      surveys.forEach((survey, at) => {
        placeSatellite(survey, at, t);
        if (beaming) beam(survey, t, delta);
      });
      grounded.forEach((survey, at) => {
        placeHologram(survey, at, t, !beaming);
      });
      for (const mesh of [body, panels, blueprints, beams, rings, scans, lamps, proxies])
        mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
