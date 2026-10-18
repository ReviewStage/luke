import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import {
  AGENT_KIND,
  type AgentKind,
  type AgentView,
  BUILD_FULL_LINES,
} from "@luke/ui/factory-world";
import {
  type BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  type Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import {
  type Burrows,
  type Chamber,
  COLONY,
  Path,
  Poly,
  type WorkPoint,
  workPointIn,
} from "./layout";
import {
  antGeometry,
  bugMaterial,
  clamp,
  hashUnit,
  leafGeometry,
  lumpGeometry,
  seeded,
  UP,
} from "./shapes";

/**
 * colony.ts -- the ants: each agent's team carrying its load between the zones it builds in, the colony's own traffic along every tunnel and shaft, the queens, and the crumbs and sparks they throw up.
 *
 * A team is one agent. Its ants wear the agent's state (`building`'s colour
 * at work, `defect`'s where it failed), its load is the kind of work it
 * builds (a leaf for a feature, a clod for a refactor, a pebble for a fix,
 * a petal for docs, a crumb for the rest), sized by its pull request's
 * lines, and a ring on the floor under it marks the work site in the same
 * colour, readable from across the room. A team at work walks between the
 * zones its pull request touches; one waiting on the developer stands by
 * its load; a stuck one sleeps beside it, bubbles rising; a failed one lies
 * still. Held still, every team stands at its first work site in its pose,
 * which says all of that without a step taken.
 *
 * Every ant in the scene is one instanced mesh, its legs walked by the
 * shader, so a hundred teams and the traffic are a single draw.
 */

const MAX_AGENTS = FACTORY_WORLD_BOUNDS.MAX_AGENTS;
const MAX_TEAM = 10;
/** The colony's own traffic, at most. */
const MAX_TRAFFIC = 600;
const MAX_ANTS = MAX_AGENTS * MAX_TEAM + MAX_TRAFFIC;
const MAX_SPECKS = 360;

/** What a team carries. */
const LOAD = {
  LEAF: "leaf",
  CLOD: "clod",
  PEBBLE: "pebble",
  PETAL: "petal",
  CRUMB: "crumb",
} as const;

type Load = (typeof LOAD)[keyof typeof LOAD];

/** How a team stands, read from its agent's state. */
export const TEAM_POSE = {
  /** Working: walks between its zones and works in a turning ring. */
  WORK: "work",
  /** Waiting on the developer: stands by its load, facing it. */
  WAIT: "wait",
  /** Stuck: asleep beside its load, facing out, bubbles rising. */
  SLEEP: "sleep",
  /** Failed: lies still, its load dropped. */
  DOWN: "down",
  /** Idle: one ant resting, nothing carried. */
  REST: "rest",
} as const;

export type TeamPose = (typeof TEAM_POSE)[keyof typeof TEAM_POSE];

const LOAD_OF_KIND = {
  [AGENT_KIND.FEAT]: LOAD.LEAF,
  [AGENT_KIND.REFACTOR]: LOAD.CLOD,
  [AGENT_KIND.PERF]: LOAD.CLOD,
  [AGENT_KIND.FIX]: LOAD.PEBBLE,
  [AGENT_KIND.REVERT]: LOAD.PEBBLE,
  [AGENT_KIND.DOCS]: LOAD.PETAL,
  [AGENT_KIND.STYLE]: LOAD.PETAL,
  [AGENT_KIND.TEST]: LOAD.CRUMB,
  [AGENT_KIND.BUILD]: LOAD.CRUMB,
  [AGENT_KIND.CI]: LOAD.CRUMB,
  [AGENT_KIND.CHORE]: LOAD.CRUMB,
  [AGENT_KIND.UNKNOWN]: LOAD.CRUMB,
} as const satisfies { readonly [K in AgentKind]: Load };

/** How each load is drawn: how thick it rides, and its own colour. */
const LOAD_LOOK = {
  [LOAD.LEAF]: { thick: 0.08, color: "#9ccf58" },
  [LOAD.CLOD]: { thick: 0.38, color: "#8a5634" },
  [LOAD.PEBBLE]: { thick: 0.31, color: "#e2cfb2" },
  [LOAD.PETAL]: { thick: 0.08, color: "#ffd6e2" },
  [LOAD.CRUMB]: { thick: 0.4, color: "#e9bf6e" },
} as const satisfies { readonly [L in Load]: { thick: number; color: string } };

/** One agent as its team is cast: what it is, how it stands, and the colours it wears. */
export interface Casting {
  readonly agent: AgentView;
  readonly pose: TeamPose;
  /** Its ants' colour. */
  readonly ink: Color;
  /** Its work site's ring, none for a resting team. */
  readonly site: Color | undefined;
}

/** Where one ant stands, eased toward where it is sent. */
interface Ant {
  readonly position: Vector3;
  readonly turn: Quaternion;
  placed: boolean;
  phase: number;
}

interface Team {
  readonly id: string;
  readonly random: () => number;
  casting: Casting;
  zones: readonly (Chamber | undefined)[];
  ants: Ant[];
  size: number;
  load: Load | undefined;
  walking: boolean;
  timer: number;
  next: number;
  here: WorkPoint;
  there: WorkPoint | undefined;
  path: Path | undefined;
  along: number;
  hopUntil: number;
  /** Where its load rides, which the camera and the cone aim at. */
  readonly center: Vector3;
  readonly up: Vector3;
}

interface Traffic {
  readonly path: Path;
  readonly speed: number;
  readonly offset: number;
  readonly carries: boolean;
  readonly ant: Ant;
}

function antOf(): Ant {
  return { position: new Vector3(0, -999, 0), turn: new Quaternion(), placed: false, phase: 0 };
}

/** The lines a build size stands for, the inverse of the view model's log scale. */
function linesOf(buildSize: number): number {
  return (BUILD_FULL_LINES + 1) ** buildSize - 1;
}

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/* ----- Public ----- */

export interface Colony {
  /** The teams' stand-ins, an instance per drawn agent, and the agent each stands for. */
  readonly standIns: InstancedMesh;
  readonly agentAt: (instance: number) => string | undefined;
  /** Throws a burst of `color` sparks from `at`. */
  readonly spark: (at: Vector3) => void;
  readonly layout: (burrows: Burrows) => void;
  readonly cast: (castings: readonly Casting[], burrows: Burrows) => void;
  /** Places every ant `dt` seconds on, at `elapsed`; moving is false while motion is held still. */
  readonly pose: (
    dt: number,
    elapsed: number,
    moving: boolean,
    chosen: ReadonlySet<string>,
  ) => void;
}

export function colonyOf(scene: Scene, palette: { selection: string; shipped: string }): Colony {
  const antGeometryShared = antGeometry();
  const phases = new InstancedBufferAttribute(new Float32Array(MAX_ANTS), 1);
  phases.setUsage(DynamicDrawUsage);
  antGeometryShared.setAttribute("aPhase", phases);
  const antMaterial = bugMaterial(
    { color: 0xffffff, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.25, sheen: 0.3 },
    "ant",
  );
  const ants = new InstancedMesh(antGeometryShared, antMaterial, MAX_ANTS);
  ants.instanceMatrix.setUsage(DynamicDrawUsage);
  ants.castShadow = true;
  ants.frustumCulled = false;
  ants.count = 0;

  const loadGeometry = {
    [LOAD.LEAF]: leafGeometry(),
    [LOAD.CLOD]: lumpGeometry(3),
    [LOAD.PEBBLE]: lumpGeometry(9, 0.62, 0.05, 3),
    [LOAD.PETAL]: leafGeometry(1, 0.8),
    [LOAD.CRUMB]: lumpGeometry(5, 0.8, 0.1, 1),
  } satisfies { readonly [L in Load]: BufferGeometry };
  const loadMaterial = {
    [LOAD.LEAF]: new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      side: DoubleSide,
    }),
    [LOAD.CLOD]: new MeshStandardMaterial({ roughness: 0.95 }),
    [LOAD.PEBBLE]: new MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.5 }),
    [LOAD.PETAL]: new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      side: DoubleSide,
    }),
    [LOAD.CRUMB]: new MeshStandardMaterial({ roughness: 0.8 }),
  } satisfies { readonly [L in Load]: Material };
  const loadMesh = (load: Load) => {
    const mesh = new InstancedMesh(loadGeometry[load], loadMaterial[load], MAX_AGENTS);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  };
  const loads = {
    [LOAD.LEAF]: loadMesh(LOAD.LEAF),
    [LOAD.CLOD]: loadMesh(LOAD.CLOD),
    [LOAD.PEBBLE]: loadMesh(LOAD.PEBBLE),
    [LOAD.PETAL]: loadMesh(LOAD.PETAL),
    [LOAD.CRUMB]: loadMesh(LOAD.CRUMB),
  } satisfies { readonly [L in Load]: InstancedMesh };
  const crumbs = new InstancedMesh(
    lumpGeometry(2, 0.8, 0.2, 0),
    new MeshStandardMaterial({ color: "#e8c178", roughness: 0.8 }),
    MAX_TRAFFIC,
  );
  crumbs.frustumCulled = false;
  crumbs.count = 0;
  const standIns = new InstancedMesh(
    new SphereGeometry(1, 8, 6),
    new MeshBasicMaterial({ visible: false }),
    MAX_AGENTS,
  );
  standIns.count = 0;
  const sites = new InstancedMesh(
    new TorusGeometry(1, 0.07, 6, 40).rotateX(Math.PI / 2),
    new MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 }),
    MAX_AGENTS,
  );
  sites.count = 0;
  const bubbles = new InstancedMesh(
    new SphereGeometry(1, 10, 8),
    new MeshStandardMaterial({
      color: "#f4fbff",
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
    }),
    MAX_AGENTS * 3,
  );
  bubbles.count = 0;
  const cones = new InstancedMesh(
    new ConeGeometry(0.5, 1, 4).rotateX(Math.PI),
    new MeshBasicMaterial({ color: palette.selection, toneMapped: false }),
    2,
  );
  cones.count = 0;
  const crumbFly = new InstancedMesh(
    new IcosahedronGeometry(0.07, 0),
    new MeshStandardMaterial({ color: "#7b4d30", roughness: 1 }),
    MAX_SPECKS,
  );
  const sparkFly = new InstancedMesh(
    new IcosahedronGeometry(0.06, 0),
    new MeshBasicMaterial({
      color: new Color(palette.shipped).multiplyScalar(2.4),
      toneMapped: false,
    }),
    MAX_SPECKS,
  );
  for (const mesh of [crumbFly, sparkFly]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
  }
  const queenGeometry = antGeometry();
  const queenPhase = new InstancedBufferAttribute(new Float32Array(2), 1);
  queenGeometry.setAttribute("aPhase", queenPhase);
  const queens = new InstancedMesh(queenGeometry, antMaterial, 2);
  queens.castShadow = true;
  queens.count = 0;
  const wings = new InstancedMesh(
    new CircleGeometry(0.5, 20).scale(0.32, 1, 1).translate(0, -0.48, 0),
    new MeshStandardMaterial({
      color: "#f7f3ff",
      transparent: true,
      opacity: 0.45,
      roughness: 0.15,
      side: DoubleSide,
      depthWrite: false,
    }),
    4,
  );
  wings.count = 0;
  scene.add(
    ants,
    ...Object.values(loads),
    crumbs,
    standIns,
    sites,
    bubbles,
    cones,
    crumbFly,
    sparkFly,
    queens,
    wings,
  );

  const teams = new Map<string, Team>();
  let drawn: Team[] = [];
  let traffic: Traffic[] = [];
  let court: { chamber: Chamber; at: Vector3; yaw: number }[] = [];
  const specks = Array.from({ length: MAX_SPECKS * 2 }, () => ({
    life: 0,
    at: new Vector3(),
    velocity: new Vector3(),
    size: 0,
    gold: false,
  }));
  let speckHead = 0;
  const specksRandom = seeded(97);
  const emit = (at: Vector3, velocity: Vector3, gold: boolean) => {
    const speck = specks[speckHead];
    speckHead = (speckHead + 1) % specks.length;
    if (speck === undefined) return;
    speck.life = gold ? 0.8 + specksRandom() * 0.8 : 0.5 + specksRandom() * 0.5;
    speck.at.copy(at);
    speck.velocity.copy(velocity);
    speck.gold = gold;
    speck.size = 0.6 + specksRandom() * 0.9;
  };

  const matrix = new Matrix4();
  const turn = new Quaternion();
  const scale = new Vector3();
  const along = new Vector3();
  const up = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const lift = new Vector3();
  const basis = new Matrix4();
  const tilt = new Quaternion();
  const spot = new Vector3();
  const spotUp = new Vector3();
  const ahead = new Vector3();
  const riding = new Vector3();
  const kick = new Vector3();
  const wingTurn = new Quaternion();
  const wingAt = new Matrix4();
  const wingScale = new Vector3(1, 1, 1);
  const tilted = new Euler();

  /** The turn that faces `ahead` with `upward` up. */
  const facing = (ahead: Vector3, upward: Vector3, out: Quaternion) => {
    right.crossVectors(upward, ahead);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    lift.crossVectors(ahead, right).normalize();
    basis.makeBasis(right, lift, ahead);
    return out.setFromRotationMatrix(basis);
  };
  /** Eases ant `ant` toward `position`, facing `ahead`, and writes it as instance `index`. */
  const step = (
    index: number,
    ant: Ant,
    position: Vector3,
    ahead: Vector3,
    upward: Vector3,
    size: number,
    dt: number,
    pace: number,
  ) => {
    facing(ahead, upward, turn);
    const ease = dt === 0 || !ant.placed ? 1 : 1 - Math.exp(-dt * 12);
    ant.position.lerp(position, ease);
    ant.turn.slerp(turn, ease);
    ant.placed = true;
    ant.phase += dt * (2 + pace * 7.5);
    phases.setX(index, ant.phase);
    ants.setMatrixAt(index, matrix.compose(ant.position, ant.turn, scale.setScalar(size)));
  };
  const tangent = (path: Path, s: number, out: Vector3) => {
    path.at(s + 0.35, along, up);
    path.at(s - 0.35, out, up);
    out.subVectors(along, out);
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
    return out.normalize();
  };

  /** Sends a working team on to its next zone, or keeps it at work. */
  const advance = (team: Team, dt: number) => {
    if (!team.walking) {
      team.timer -= dt;
      if (team.timer > 0 || team.casting.pose !== TEAM_POSE.WORK) return;
      team.next = team.zones.length > 1 ? (team.next + 1) % team.zones.length : 0;
      team.there = workPointIn(team.zones[team.next], team.random, team.here.p.x);
      team.path = burrowsNow?.route(team.here, team.there);
      team.along = 0;
      team.walking = team.path !== undefined;
      return;
    }
    team.along += dt * (2.5 - 0.06 * team.ants.length);
    const length = team.path?.length ?? 0;
    if (
      team.along >= length + Math.floor((team.ants.length - 1) / 2) * 0.65 &&
      team.there !== undefined
    ) {
      team.here = team.there;
      team.walking = false;
      team.timer = 5 + team.random() * 8;
    }
  };

  /** Places a walking team in its column, two abreast; answers how narrow the passage is. */
  const walk = (team: Team, first: number, dt: number, hop: (k: number) => number) => {
    const path = team.path;
    if (path === undefined) return 0;
    let narrow = 0;
    team.center.set(0, 0, 0);
    team.up.set(0, 0, 0);
    team.ants.forEach((ant, k) => {
      const column = team.ants.length === 1 ? 0 : Math.floor(k / 2);
      const row = team.ants.length === 1 ? 0 : k % 2 ? 1 : -1;
      const s = clamp(team.along - column * 0.65, 0, path.length);
      narrow = Math.max(narrow, path.at(s, spot, spotUp));
      tangent(path, s, forward);
      right.crossVectors(spotUp, forward).normalize();
      spot.addScaledVector(right, row * 0.3 * (1 - narrow * 0.35)).addScaledVector(spotUp, hop(k));
      step(first + k, ant, spot, forward, spotUp, 1.5, dt, 2.4);
      team.center.add(ant.position);
      team.up.add(spotUp);
    });
    team.center.divideScalar(team.ants.length);
    team.up.normalize();
    tangent(
      path,
      clamp(team.along - (Math.ceil(team.ants.length / 2) - 1) * 0.33, 0, path.length),
      forward,
    );
    return narrow;
  };

  /** Places a team at its work site, in a ring about its load, as its pose stands. */
  const work = (
    team: Team,
    first: number,
    dt: number,
    elapsed: number,
    hop: (k: number) => number,
  ) => {
    const pose = team.casting.pose;
    const site = team.here;
    const chamber = site.chamber;
    const ring = 0.5 + team.size * 0.42;
    const turning = pose === TEAM_POSE.WORK ? elapsed * 0.32 : 0;
    const spin = hashUnit(team.id, 2) * 6;
    team.ants.forEach((ant, k) => {
      const a = (k / team.ants.length) * Math.PI * 2 + turning + spin;
      const flat = chamber === undefined || chamber.surface ? 1 : 0.55;
      const z = site.p.z + Math.sin(a) * ring * flat;
      spot.set(
        site.p.x + (team.ants.length === 1 ? 0 : Math.cos(a) * ring),
        site.p.y + hop(k),
        chamber === undefined || chamber.surface ? z : clamp(z, -chamber.fz * 0.95, -0.3),
      );
      if (pose === TEAM_POSE.SLEEP || pose === TEAM_POSE.DOWN)
        ahead.set(Math.cos(a), 0, Math.sin(a));
      else if (pose === TEAM_POSE.WAIT) ahead.set(-Math.cos(a), 0, -Math.sin(a));
      else ahead.set(-Math.sin(a), 0, Math.cos(a));
      const still = pose === TEAM_POSE.WORK ? dt : dt * 0.04;
      step(first + k, ant, spot, ahead, UP, 1.5, still, pose === TEAM_POSE.WORK ? 0.9 : 0);
    });
    team.center.copy(site.p);
    team.up.copy(UP);
    forward.set(Math.cos(elapsed * 0.2 + spin), 0, Math.sin(elapsed * 0.2 + spin));
    if (pose === TEAM_POSE.WORK && dt > 0 && team.random() < dt * (1.5 + team.size)) {
      emit(
        spot.set(
          site.p.x + (team.random() * 2 - 1) * ring,
          site.p.y + 0.3,
          site.p.z + (team.random() - 0.5) * ring,
        ),
        kick.set(team.random() * 3 - 1.5, 2 + team.random() * 2, team.random() * 1.2 - 0.6),
        false,
      );
    }
  };

  let burrowsNow: Burrows | undefined;

  return {
    standIns,
    agentAt: (instance) => drawn[instance]?.id,
    spark: (at) => {
      for (let k = 0; k < 20; k += 1) {
        emit(
          at,
          kick.set(specksRandom() * 5 - 2.5, 2 + specksRandom() * 3, specksRandom() * 3 - 1.5),
          true,
        );
      }
    },
    layout: (burrows) => {
      burrowsNow = burrows;
      teams.clear();
      const random = seeded(71);
      const rand = (low: number, high: number) => low + (high - low) * random();
      const routes: Path[] = [];
      for (const tunnel of burrows.tunnels) {
        const path = new Path(tunnel.line);
        for (let k = 0; k < 2 + (random() < 0.4 ? 1 : 0); k += 1) routes.push(path);
      }
      for (const climb of burrows.climbs) {
        const path = new Path(climb);
        routes.push(path, path);
      }
      for (let k = 0; k < 46; k += 1) {
        const x0 = rand(-COLONY.HALF + 2, COLONY.HALF - 2);
        const x1 = clamp(x0 + rand(-30, 30), -COLONY.HALF + 2, COLONY.HALF - 2);
        const poly = new Poly()
          .add(new Vector3(x0, 0.02, COLONY.TRAIL_Z))
          .add(new Vector3(x1, 0.02, COLONY.TRAIL_Z));
        if (random() < 0.4) poly.add(new Vector3(x1 + rand(-3, 3), 0.02, rand(-14, -3)));
        routes.push(new Path(poly));
      }
      traffic = routes.slice(0, MAX_TRAFFIC).map((path) => ({
        path,
        speed: rand(1.4, 2.4),
        offset: rand(0, 200),
        carries: random() < 0.4,
        ant: antOf(),
      }));
      const tones = ["#6a3f26", "#5b3420", "#734628"].map((tone) => new Color(tone));
      traffic.forEach((_, index) => {
        ants.setColorAt(index, tones[index % tones.length] ?? new Color());
      });
      court = burrows.heart.map((chamber, index) => ({
        chamber,
        at: new Vector3(
          chamber.cx + chamber.fx * (index ? -0.35 : 0.25),
          chamber.floorY,
          -chamber.fz * 0.5,
        ),
        yaw: index ? 0.9 : -0.9,
      }));
      queens.count = court.length;
      wings.count = court.length * 2;
      court.forEach((_, index) => {
        queens.setColorAt(index, new Color("#7d3b22"));
      });
      crumbs.count = traffic.length;
    },
    cast: (castings, burrows) => {
      burrowsNow = burrows;
      const seen = new Set<string>();
      drawn = castings.slice(0, MAX_AGENTS).map((casting) => {
        const agent = casting.agent;
        seen.add(agent.id);
        const touched = agent.touched
          .flatMap((zone) => burrows.byPath.get(zone.path) ?? [])
          .slice(0, 3);
        const primary =
          agent.primaryZone === null ? undefined : burrows.byPath.get(agent.primaryZone);
        const zones: (Chamber | undefined)[] = touched.length > 0 ? touched : [primary];
        const resting = casting.pose === TEAM_POSE.REST;
        const lines = linesOf(agent.buildSize);
        const count =
          resting || agent.buildSize === 0
            ? 1
            : clamp(Math.round(1 + Math.log2(Math.max(1, lines) / 40)), 1, MAX_TEAM);
        const known = teams.get(agent.id);
        const sameZones =
          known !== undefined &&
          known.zones.length === zones.length &&
          known.zones.every((zone, index) => zone === zones[index]);
        const random = known?.random ?? seeded(Math.floor(hashUnit(agent.id) * 1e9));
        const team: Team =
          sameZones && known !== undefined
            ? known
            : {
                id: agent.id,
                random,
                casting,
                zones,
                ants: [],
                size: 0,
                load: undefined,
                walking: false,
                timer: 0.5 + random() * 8.5,
                next: 0,
                here: workPointIn(
                  zones[0],
                  random,
                  (hashUnit(agent.id, 9) * 2 - 1) * (COLONY.HALF - 6),
                ),
                there: undefined,
                path: undefined,
                along: 0,
                hopUntil: 0,
                center: new Vector3(),
                up: new Vector3(0, 1, 0),
              };
        if (team.casting.pose !== casting.pose && casting.pose !== TEAM_POSE.WORK)
          team.walking = false;
        team.casting = casting;
        team.size = resting
          ? 0
          : agent.buildSize === 0
            ? 0.35
            : 0.22 * (BUILD_FULL_LINES + 1) ** (0.32 * agent.buildSize);
        team.load = resting ? undefined : LOAD_OF_KIND[agent.kind];
        while (team.ants.length < count) team.ants.push(antOf());
        team.ants.length = count;
        teams.set(agent.id, team);
        return team;
      });
      for (const id of [...teams.keys()]) if (!seen.has(id)) teams.delete(id);
      let first = traffic.length;
      const perLoad = new Map<Load, number>();
      const site = new Color();
      drawn.forEach((team, index) => {
        for (let k = 0; k < team.ants.length; k += 1) ants.setColorAt(first + k, team.casting.ink);
        first += team.ants.length;
        if (team.load !== undefined) {
          const at = perLoad.get(team.load) ?? 0;
          perLoad.set(team.load, at + 1);
          const tint = new Color(LOAD_LOOK[team.load].color).offsetHSL(
            (team.random() - 0.5) * 0.04,
            0,
            (team.random() - 0.5) * 0.1,
          );
          loads[team.load].setColorAt(at, tint);
        }
        sites.setColorAt(index, team.casting.site ?? site.setRGB(0, 0, 0));
      });
      ants.count = first;
      for (const load of Object.values(LOAD)) {
        loads[load].count = perLoad.get(load) ?? 0;
        const tints = loads[load].instanceColor;
        if (tints !== null) tints.needsUpdate = true;
      }
      standIns.count = drawn.length;
      sites.count = drawn.length;
      if (ants.instanceColor !== null) ants.instanceColor.needsUpdate = true;
      if (sites.instanceColor !== null) sites.instanceColor.needsUpdate = true;
    },
    pose: (dt, elapsed, moving, chosen) => {
      const t = moving ? elapsed : 0;
      traffic.forEach((car, index) => {
        const length = car.path.length;
        const raw = (t * car.speed + car.offset) % (2 * Math.max(length, 1e-3));
        const outward = raw < length;
        const s = outward ? raw : 2 * length - raw;
        car.path.at(s, spot, spotUp);
        tangent(car.path, s, forward);
        if (!outward) forward.negate();
        step(index, car.ant, spot, forward, spotUp, 0.92, dt, car.speed);
        if (car.carries && outward) {
          riding
            .copy(forward)
            .multiplyScalar(0.55)
            .add(car.ant.position)
            .addScaledVector(spotUp, 0.33);
          crumbs.setMatrixAt(index, matrix.compose(riding, car.ant.turn, scale.setScalar(0.5)));
        } else crumbs.setMatrixAt(index, HIDDEN);
      });

      let first = traffic.length;
      const perLoad = new Map<Load, number>();
      let bubble = 0;
      let cone = 0;
      drawn.forEach((team, index) => {
        const hot = chosen.has(team.id);
        const hop = (k: number) =>
          moving && (hot || t < team.hopUntil) ? Math.abs(Math.sin(t * 11 + k * 1.3)) * 0.42 : 0;
        if (moving) advance(team, dt);
        else team.walking = false;
        let narrow = 0;
        if (team.walking) narrow = walk(team, first, dt, hop);
        else work(team, first, dt, t, hop);
        first += team.ants.length;
        const look = team.load === undefined ? undefined : LOAD_LOOK[team.load];
        const squeeze = 1 - narrow * (1 - Math.min(1, 1.5 / Math.max(team.size, 1e-3)));
        const pose = team.casting.pose;
        const rise =
          (team.walking
            ? 0.48
            : pose === TEAM_POSE.SLEEP || pose === TEAM_POSE.DOWN
              ? 0.02
              : 0.3 + (moving && pose === TEAM_POSE.WORK ? 0.05 * Math.sin(t * 3 + index) : 0)) +
          (look?.thick ?? 0) * team.size * squeeze;
        const at = riding.copy(team.center).addScaledVector(team.up, rise);
        if (team.load !== undefined) {
          facing(forward.normalize(), team.up, turn);
          if (team.load === LOAD.LEAF || team.load === LOAD.PETAL) {
            tilt.setFromAxisAngle(
              right.set(1, 0, 0),
              -0.25 + (moving ? 0.06 * Math.sin(t * 4 + index) : 0),
            );
            turn.multiply(tilt);
          }
          const slot = perLoad.get(team.load) ?? 0;
          perLoad.set(team.load, slot + 1);
          const s = team.size * squeeze;
          loads[team.load].setMatrixAt(
            slot,
            matrix.compose(at, turn, scale.set(s, s, s * (team.load === LOAD.LEAF ? 1.25 : 1))),
          );
        }
        team.center.copy(at);
        standIns.setMatrixAt(
          index,
          matrix.compose(at, turn.identity(), scale.setScalar(Math.max(1.1, team.size * 0.7))),
        );
        const ground = team.here.p;
        const ring = (0.5 + team.size * 0.42) * 1.35 + 0.25;
        sites.setMatrixAt(
          index,
          team.walking || team.casting.site === undefined
            ? HIDDEN
            : matrix.compose(
                spot.set(ground.x, ground.y + 0.04, ground.z),
                turn.identity(),
                scale.set(ring, 1, ring),
              ),
        );
        if (pose === TEAM_POSE.SLEEP) {
          for (let k = 0; k < 3; k += 1) {
            const phase = ((moving ? t * 0.35 : 0.2) + k / 3) % 1;
            const r = (0.12 + phase * 0.16) * (moving ? Math.sin(phase * Math.PI) + 0.2 : 1);
            bubbles.setMatrixAt(
              bubble,
              matrix.compose(
                spot.set(
                  at.x + 0.3 + phase * 0.8,
                  at.y + 0.8 + phase * 2.2 + team.size * 0.3,
                  at.z + 0.2,
                ),
                turn.identity(),
                scale.setScalar(r),
              ),
            );
            bubble += 1;
          }
        }
        if (hot && cone < 2) {
          const bob = moving ? 0.25 * Math.sin(t * 4) : 0;
          turn.setFromAxisAngle(UP, moving ? t * 1.5 : 0.4);
          cones.setMatrixAt(
            cone,
            matrix.compose(
              spot.set(at.x, at.y + (look?.thick ?? 0) * team.size + 1.6 + bob, at.z),
              turn,
              scale.setScalar(Math.max(1.4, team.size * 0.6)),
            ),
          );
          cone += 1;
        }
      });
      for (const load of Object.values(LOAD)) loads[load].instanceMatrix.needsUpdate = true;
      bubbles.count = bubble;
      cones.count = cone;

      court.forEach((queen, index) => {
        queenPhase.setX(index, (queenPhase.getX(index) ?? 0) + dt * 1.4);
        turn.setFromAxisAngle(UP, queen.yaw);
        queens.setMatrixAt(index, matrix.compose(queen.at, turn, scale.setScalar(2.6)));
        for (const side of [-1, 1]) {
          const flutter = 0.35 + (moving ? 0.08 * Math.sin(t * 2.4 + index) : 0);
          wingTurn.setFromEuler(tilted.set(-Math.PI / 2 + 0.25, 0, side * flutter));
          wingAt.compose(spot.set(side * 0.06, 0.42, 0.02), wingTurn, wingScale);
          wings.setMatrixAt(
            index * 2 + (side < 0 ? 0 : 1),
            matrix.compose(queen.at, turn, scale.setScalar(2.6)).multiply(wingAt),
          );
        }
      });
      queenPhase.needsUpdate = true;

      let crumbsFlying = 0;
      let sparksFlying = 0;
      for (const speck of specks) {
        if (speck.life <= 0) continue;
        if (!moving) {
          speck.life = 0;
          continue;
        }
        speck.life -= dt;
        speck.velocity.y -= (speck.gold ? 2.5 : 9) * dt;
        speck.at.addScaledVector(speck.velocity, dt);
        const s = Math.max(0, Math.min(1, speck.life * 2)) * speck.size;
        matrix.compose(speck.at, turn.identity(), scale.setScalar(s));
        if (speck.gold && sparksFlying < MAX_SPECKS) sparkFly.setMatrixAt(sparksFlying++, matrix);
        if (!speck.gold && crumbsFlying < MAX_SPECKS) crumbFly.setMatrixAt(crumbsFlying++, matrix);
      }
      crumbFly.count = crumbsFlying;
      sparkFly.count = sparksFlying;

      for (const mesh of [
        ants,
        crumbs,
        standIns,
        sites,
        bubbles,
        cones,
        queens,
        wings,
        crumbFly,
        sparkFly,
      ]) {
        mesh.instanceMatrix.needsUpdate = true;
      }
      phases.needsUpdate = true;
    },
  };
}
