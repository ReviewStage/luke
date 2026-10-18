import { AGENT_STATE, type AgentView, type SIGNAL_COLOR } from "@luke/ui/factory-world";
import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial } from "three";
import { Builder, clamp, hashOf, hidden, placing, put, seeded, shade, UNIT } from "./kit";
import { BOARD, type District, type Layout, type Route, routeOf, vehicleAt } from "./layout";
import type { Particles } from "./particles";

/**
 * trains.ts -- a train for each agent, running a loop over the districts its pull request touches, a wagon for each file it changed in the colours of the zones it changed them in; and the shipped express that pulls into a district when work lands there.
 *
 * A working agent's train runs; one waiting on the developer, stuck, or
 * failed stands still where its route begins, which is where a still frame
 * shows every train. Its locomotive is in building's amber, defect's red when
 * failed, a dull brown when stuck, and selection's colour when chosen. Every
 * vehicle of a kind is an instance of one mesh, allocated at the contract's
 * bound, so a hundred trains are four draw calls.
 */

/** The vehicles' lengths, and the gap between them. */
const LENGTH = { LOCO: 1.7, CAR: 1.22, GAP: 0.16 } as const;

/** The most wagons one train pulls. */
const MOST_CARS = 14;

/** How many shipped expresses may run at once, and how many wagons each pulls. */
const EXPRESS = { COUNT: 6, CARS: 3 } as const;

/** The three wagons a train is made up of. */
const CAR = { BOX: "box", TANK: "tank", FLAT: "flat" } as const;

type CarKind = (typeof CAR)[keyof typeof CAR];

export const CAR_KINDS = [CAR.BOX, CAR.TANK, CAR.FLAT] as const;

const CAPACITY = {
  LOCOS: 100 + EXPRESS.COUNT,
  CARS: 100 * MOST_CARS + EXPRESS.COUNT * EXPRESS.CARS,
} as const;

/** A vehicle's body, built along +x: its white parts take the instance's tint, its dark ones stay dark. */
function vehicleGeometry(kind: CarKind | "loco") {
  const builder = new Builder();
  const pen = { builder, frame: new Matrix4(), extra: [] };
  const paint = new Color("#f6f3ec");
  const dark = new Color("#1c1a18");
  const wheels = (xs: readonly number[], spread: number, size: number) => {
    for (const x of xs)
      for (const z of [-spread, spread])
        put(pen, UNIT.disc, dark, x, size / 2, z, 0, size, size, 0.05);
  };
  if (kind === "loco") {
    put(pen, UNIT.cbox, dark, 0, 0.12, 0, 0, 1.62, 0.14, 0.5);
    put(pen, UNIT.cyl, paint, 0.18, 0.44, 0, 0, 0.5, 1.05, 0.5, 0, -Math.PI / 2);
    put(pen, UNIT.cbox, paint, -0.5, 0.5, 0, 0, 0.55, 0.62, 0.62);
    put(pen, UNIT.cbox, dark, -0.5, 0.84, 0, 0, 0.66, 0.06, 0.7);
    put(pen, UNIT.cyl8, dark, 0.56, 0.62, 0, 0, 0.14, 0.32, 0.14);
    put(pen, UNIT.hemi, new Color("#b8893a"), 0.15, 0.66, 0, 0, 0.2, 0.18, 0.2);
    put(pen, UNIT.cbox, new Color("#7a2a22"), 0.84, 0.16, 0, 0, 0.06, 0.16, 0.56);
    put(pen, UNIT.cbox, new Color("#f4e3a0"), 0.72, 0.5, 0, 0, 0.04, 0.1, 0.1);
    wheels([-0.45, 0, 0.45], 0.27, 0.26);
  } else {
    put(pen, UNIT.cbox, dark, 0, 0.12, 0, 0, 1.15, 0.12, 0.48);
    if (kind === CAR.BOX) {
      put(pen, UNIT.cbox, paint, 0, 0.45, 0, 0, 1.12, 0.52, 0.6);
      put(pen, UNIT.cbox, new Color("#d8d4cc"), 0, 0.74, 0, 0, 1.16, 0.06, 0.64);
      put(pen, UNIT.cbox, shade(paint, -0.25), 0, 0.42, 0.305, 0, 0.36, 0.42, 0.01);
    } else if (kind === CAR.TANK) {
      put(pen, UNIT.cyl, paint, 0, 0.44, 0, 0, 0.52, 1.08, 0.52, 0, Math.PI / 2);
      put(pen, UNIT.cyl8, dark, 0, 0.66, 0, 0, 0.2, 0.12, 0.2);
    } else {
      put(pen, UNIT.cbox, new Color("#8a5a35"), 0, 0.22, 0, 0, 1.15, 0.06, 0.6);
      put(pen, UNIT.cbox, paint, -0.25, 0.4, 0, 0, 0.5, 0.32, 0.46);
      put(pen, UNIT.cbox, paint, 0.3, 0.37, 0, 0, 0.42, 0.26, 0.4);
    }
    wheels([-0.38, 0.38], 0.25, 0.2);
  }
  return builder.build();
}

/** The locomotives' mesh and each kind of wagon's, made once at their bounds. */
export function trainMeshes() {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.15,
  });
  const meshes = {
    locos: new InstancedMesh(vehicleGeometry("loco"), material, CAPACITY.LOCOS),
    cars: {
      [CAR.BOX]: new InstancedMesh(vehicleGeometry(CAR.BOX), material, CAPACITY.CARS),
      [CAR.TANK]: new InstancedMesh(vehicleGeometry(CAR.TANK), material, CAPACITY.CARS),
      [CAR.FLAT]: new InstancedMesh(vehicleGeometry(CAR.FLAT), material, CAPACITY.CARS),
    },
  };
  for (const mesh of [meshes.locos, ...Object.values(meshes.cars)]) {
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  }
  return meshes;
}

export type TrainMeshes = ReturnType<typeof trainMeshes>;

/** One wagon: its kind, its slot in that kind's mesh, and its paint. */
interface Car {
  readonly kind: CarKind;
  readonly slot: number;
  readonly color: Color;
}

/** One agent's train. */
export interface Train {
  readonly agent: AgentView;
  readonly route: Route;
  /** Units a second; zero for a train standing still. */
  readonly speed: number;
  /** Where along its route it stands at time zero. */
  readonly start: number;
  readonly cars: readonly Car[];
}

/** A wagon for each file the pull request changed, shared between the zones it touched by their lines. */
function wagonZones(agent: AgentView, count: number): string[] {
  const quotas = agent.touched.map((zone) => ({ path: zone.path, share: zone.weight * count }));
  const zones: string[] = [];
  for (const quota of quotas)
    for (let k = 0; k < Math.floor(quota.share); k += 1) zones.push(quota.path);
  const leftovers = [...quotas].sort((a, b) => (b.share % 1) - (a.share % 1));
  for (let k = 0; zones.length < count; k += 1) {
    zones.push(leftovers[k % Math.max(1, leftovers.length)]?.path ?? agent.primaryZone ?? "");
  }
  return zones;
}

/** Makes up every agent's train over the board: its route, its speed, and its wagons. */
export function makeUpTrains(agents: readonly AgentView[], layout: Layout): Train[] {
  const slots = { [CAR.BOX]: 0, [CAR.TANK]: 0, [CAR.FLAT]: 0 };
  const trains: Train[] = [];
  for (const agent of agents.slice(0, CAPACITY.LOCOS - EXPRESS.COUNT)) {
    const touched = agent.touched
      .map((zone) => zone.path)
      .filter((path) => layout.byPath.has(path));
    const paths =
      touched.length > 0 ? touched : agent.primaryZone === null ? [] : [agent.primaryZone];
    const route = routeOf(layout, paths);
    if (route === undefined) continue;
    const rnd = seeded(hashOf(agent.id));
    const running = agent.state === AGENT_STATE.WORKING;
    const idle = agent.state === AGENT_STATE.IDLE;
    const files = agent.agent.pullRequest?.changedFiles ?? 1;
    const count = idle ? 0 : clamp(files, 1, MOST_CARS);
    const cars = wagonZones(agent, count).flatMap((path, index) => {
      const kind = CAR_KINDS[hashOf(`${agent.id}:${index}`) % CAR_KINDS.length] ?? CAR.BOX;
      const slot = slots[kind];
      if (slot >= CAPACITY.CARS - EXPRESS.COUNT * EXPRESS.CARS) return [];
      slots[kind] += 1;
      const zone: District | undefined = layout.byPath.get(path);
      const color = (zone?.color ?? new Color("#a3a08f"))
        .clone()
        .lerp(new Color("#e9e2d4"), 0.55)
        .lerp(new Color("#f6f3ec"), 0.08);
      return [{ kind, slot, color }];
    });
    trains.push({
      agent,
      route,
      speed: running ? 2.6 + rnd() * 1.2 : 0,
      start: running ? rnd() * route.length : 0,
      cars,
    });
  }
  return trains;
}

/** A locomotive's paint for its agent's state, or selection's colour when chosen. */
function locoPaint(agent: AgentView, signal: typeof SIGNAL_COLOR, chosen: boolean): string {
  if (chosen) return signal.SELECTION;
  if (agent.state === AGENT_STATE.FAILED) return signal.DEFECT;
  if (agent.state === AGENT_STATE.STUCK) return "#8a7a68";
  if (agent.state === AGENT_STATE.IDLE) return "#9a948a";
  return signal.BUILDING;
}

/** Paints every train: its locomotive by state, its wagons by zone. */
export function paintTrains(
  trains: readonly Train[],
  meshes: TrainMeshes,
  signal: typeof SIGNAL_COLOR,
  chosen: (agentId: string) => boolean,
): void {
  const tint = new Color();
  trains.forEach((train, index) => {
    meshes.locos.setColorAt(
      index,
      tint.set(locoPaint(train.agent, signal, chosen(train.agent.id))),
    );
    for (const car of train.cars) meshes.cars[car.kind].setColorAt(car.slot, car.color);
  });
  for (let express = 0; express < EXPRESS.COUNT; express += 1) {
    meshes.locos.setColorAt(CAPACITY.LOCOS - EXPRESS.COUNT + express, tint.set(signal.SHIPPED));
    for (let car = 0; car < EXPRESS.CARS; car += 1) {
      meshes.cars[CAR.BOX].setColorAt(
        CAPACITY.CARS - EXPRESS.COUNT * EXPRESS.CARS + express * EXPRESS.CARS + car,
        tint.set("#f6eedb"),
      );
    }
  }
  for (const mesh of [meshes.locos, ...Object.values(meshes.cars)]) {
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }
}

/** The agent each wagon of each kind belongs to, by its slot. */
type CarOwners = { readonly [Kind in CarKind]: (string | undefined)[] };

/** Which agent each vehicle of each mesh belongs to, for picking. */
export function ownersOf(trains: readonly Train[]) {
  const cars: CarOwners = { [CAR.BOX]: [], [CAR.TANK]: [], [CAR.FLAT]: [] };
  for (const train of trains)
    for (const car of train.cars) cars[car.kind][car.slot] = train.agent.id;
  return { locos: trains.map((train) => train.agent.id), cars };
}

const VEHICLE = new Matrix4();

/** Runs every train to where it stands at `time`, puffing smoke from each moving engine above ground. */
export function runTrains(
  trains: readonly Train[],
  meshes: TrainMeshes,
  time: number,
  smoke: Particles | undefined,
  delta: number,
): void {
  trains.forEach((train, index) => {
    const along = train.start + train.speed * time;
    const head = vehicleAt(train.route, along, 0.6);
    meshes.locos.setMatrixAt(
      index,
      head.underground
        ? hidden(head.x, 0, head.z, VEHICLE)
        : placing(head.x, BOARD.RAIL_Y, head.z, head.yaw, 1, 1, 1, 0, 0, VEHICLE),
    );
    train.cars.forEach((car, position) => {
      const back =
        along -
        (LENGTH.LOCO / 2 + LENGTH.GAP + LENGTH.CAR / 2) -
        position * (LENGTH.CAR + LENGTH.GAP);
      const at = vehicleAt(train.route, back, 0.42);
      meshes.cars[car.kind].setMatrixAt(
        car.slot,
        at.underground
          ? hidden(at.x, 0, at.z, VEHICLE)
          : placing(at.x, BOARD.RAIL_Y, at.z, at.yaw, 1, 1, 1, 0, 0, VEHICLE),
      );
    });
    if (smoke !== undefined && train.speed > 0 && !head.underground && Math.random() < delta * 5) {
      const fx = Math.cos(head.yaw) * 0.56;
      const fz = -Math.sin(head.yaw) * 0.56;
      smoke.emit(
        head.x + fx,
        1.05,
        head.z + fz,
        (Math.random() - 0.5) * 0.2,
        0.9,
        (Math.random() - 0.5) * 0.2,
        1.8,
        0.25,
        1.1,
        0.95,
        0.95,
        0.95,
        0.55,
        0.8,
        -0.15,
      );
    }
  });
  for (const mesh of [meshes.locos, ...Object.values(meshes.cars)])
    mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Sets each mesh's count to what is drawn: the trains made up now, or every
 * slot while an express runs in the slots at the end, with the slots between
 * hidden so nothing of an earlier make-up shows.
 */
export function settleCounts(
  trains: readonly Train[],
  meshes: TrainMeshes,
  expressRunning: boolean,
): void {
  const used = { [CAR.BOX]: 0, [CAR.TANK]: 0, [CAR.FLAT]: 0 };
  for (const train of trains)
    for (const car of train.cars) used[car.kind] = Math.max(used[car.kind], car.slot + 1);
  if (!expressRunning) {
    meshes.locos.count = trains.length;
    for (const kind of CAR_KINDS) meshes.cars[kind].count = used[kind];
    return;
  }
  for (let slot = trains.length; slot < CAPACITY.LOCOS - EXPRESS.COUNT; slot += 1)
    meshes.locos.setMatrixAt(slot, hidden(0, -10, 0, VEHICLE));
  for (let slot = used[CAR.BOX]; slot < CAPACITY.CARS - EXPRESS.COUNT * EXPRESS.CARS; slot += 1) {
    meshes.cars[CAR.BOX].setMatrixAt(slot, hidden(0, -10, 0, VEHICLE));
  }
  meshes.locos.count = CAPACITY.LOCOS;
  meshes.cars[CAR.BOX].count = CAPACITY.CARS;
  meshes.cars[CAR.TANK].count = used[CAR.TANK];
  meshes.cars[CAR.FLAT].count = used[CAR.FLAT];
}

/** A shipped express pulling into a district's loop: where it is bound, where it comes in, and how long it has run. */
export interface Express {
  readonly district: District;
  readonly from: number;
  readonly sweep: number;
  age: number;
  /** Whether it has pulled in and the crowd has cheered. */
  arrived: boolean;
}

/** Sends an express into `district`, replacing the oldest when all are out. */
export function sendExpress(expresses: Express[], district: District): void {
  if (expresses.length >= EXPRESS.COUNT) expresses.shift();
  expresses.push({
    district,
    from: Math.PI / 2 + (Math.random() - 0.5) * 1.6,
    sweep: 2.6 + Math.random(),
    age: 0,
    arrived: false,
  });
}

/**
 * Runs each express: it glides round the loop over three seconds and stops,
 * waits, and sinks out of sight; answers where each one pulled in this
 * frame, for the confetti.
 */
export function runExpress(
  expresses: Express[],
  meshes: TrainMeshes,
  delta: number,
): { x: number; z: number }[] {
  const arrivals: { x: number; z: number }[] = [];
  const first = CAPACITY.LOCOS - EXPRESS.COUNT;
  const firstCar = CAPACITY.CARS - EXPRESS.COUNT * EXPRESS.CARS;
  for (let slot = 0; slot < EXPRESS.COUNT; slot += 1) {
    const express = expresses[slot];
    if (express === undefined) {
      meshes.locos.setMatrixAt(first + slot, hidden(0, -10, 0, VEHICLE));
      for (let car = 0; car < EXPRESS.CARS; car += 1)
        meshes.cars[CAR.BOX].setMatrixAt(
          firstCar + slot * EXPRESS.CARS + car,
          hidden(0, -10, 0, VEHICLE),
        );
      continue;
    }
    express.age += delta;
    const glide = Math.min(1, express.age / 3.2);
    const eased = 1 - (1 - glide) ** 3;
    const sink = express.age > 7 ? Math.min(1, (express.age - 7) / 1.2) : 0;
    const { district } = express;
    const radius = district.ringRadius;
    const place = (arc: number, mesh: InstancedMesh, index: number) => {
      const angle = express.from + arc / radius;
      const x = district.x + Math.cos(angle) * radius;
      const z = district.z + Math.sin(angle) * radius;
      mesh.setMatrixAt(
        index,
        placing(
          x,
          BOARD.RAIL_Y - sink * 0.9,
          z,
          Math.atan2(-Math.cos(angle), -Math.sin(angle)),
          1,
          1 - sink * 0.6,
          1,
          0,
          0,
          VEHICLE,
        ),
      );
      return { x, z };
    };
    const headArc = -express.sweep * radius * 0.5 + express.sweep * radius * eased;
    const head = place(headArc, meshes.locos, first + slot);
    for (let car = 0; car < EXPRESS.CARS; car += 1) {
      place(
        headArc - (LENGTH.LOCO / 2 + LENGTH.GAP + LENGTH.CAR / 2) - car * (LENGTH.CAR + LENGTH.GAP),
        meshes.cars[CAR.BOX],
        firstCar + slot * EXPRESS.CARS + car,
      );
    }
    if (glide >= 1 && !express.arrived) {
      express.arrived = true;
      arrivals.push(head);
    }
  }
  for (let index = expresses.length - 1; index >= 0; index -= 1) {
    if ((expresses[index]?.age ?? 0) > 8.2) expresses.splice(index, 1);
  }
  return arrivals;
}
