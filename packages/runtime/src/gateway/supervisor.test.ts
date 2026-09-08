import assert from "node:assert/strict";
import test from "node:test";
import {
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayBuildIdentity,
  type GatewayEvent,
  type GatewayRequest,
  type GatewayResponse,
} from "@sidecar/runtime-contracts";
import { GATEWAY_LOOPBACK_HOST, type GatewayDiscoveryRecord } from "./discovery.js";
import {
  GATEWAY_ATTACH_FAILURE,
  GATEWAY_ATTACH_OUTCOME,
  GATEWAY_ATTACHMENT,
  GATEWAY_CONNECT_FAILURE,
  type GatewayConnection,
  type GatewayConnectResult,
  type GatewaySpawnedProcess,
  GatewaySupervisor,
} from "./supervisor.js";
import type { GatewayEventSink } from "./transport.js";

const BUILD: GatewayBuildIdentity = {
  protocolVersion: GATEWAY_PROTOCOL_VERSION,
  buildVersion: "1.0.0",
};

class FakeConnection implements GatewayConnection {
  readonly hostBuild: GatewayBuildIdentity;
  readonly calls: GatewayRequest[] = [];
  readonly #sinks = new Set<GatewayEventSink>();
  readonly #closed = new Set<() => void>();
  #open = true;
  constructor(hostBuild: GatewayBuildIdentity = BUILD) {
    this.hostBuild = hostBuild;
  }
  request(request: GatewayRequest): Promise<GatewayResponse> {
    this.calls.push(request);
    return Promise.resolve({
      id: request.id,
      ok: true,
      result: { answered: true },
      revision: { configuration: 1, sequence: 0 },
    });
  }
  events(sink: GatewayEventSink): () => void {
    this.#sinks.add(sink);
    return () => {
      this.#sinks.delete(sink);
    };
  }
  connected(): boolean {
    return this.#open;
  }
  onClosed(listener: () => void): () => void {
    this.#closed.add(listener);
    return () => {
      this.#closed.delete(listener);
    };
  }
  close(): void {
    this.#open = false;
  }
  /** The host went away under the client: the socket closed by the other end. */
  drop(): void {
    this.#open = false;
    for (const listener of [...this.#closed]) listener();
  }
  emit(event: GatewayEvent): void {
    for (const sink of [...this.#sinks]) sink(event);
  }
}

interface World {
  record: GatewayDiscoveryRecord | undefined;
  alive: Set<number>;
  connections: FakeConnection[];
  spawns: number;
  nextPid: number;
  connectAnswer?: (record: GatewayDiscoveryRecord) => GatewayConnectResult | undefined;
  /** The record a spawn publishes, or nothing to leave the spawned process silent. */
  publishOnSpawn: boolean;
  clock: { now: number };
  reports: string[];
}

function record(pid: number, build = BUILD): GatewayDiscoveryRecord {
  return {
    ...build,
    host: GATEWAY_LOOPBACK_HOST,
    port: 40_000 + pid,
    token: `token-${pid}`,
    pid,
    startedAt: 0,
  };
}

function world(overrides: Partial<World> = {}): World {
  return {
    record: undefined,
    alive: new Set(),
    connections: [],
    spawns: 0,
    nextPid: 100,
    publishOnSpawn: true,
    clock: { now: 0 },
    reports: [],
    ...overrides,
  };
}

function supervisor(w: World, options: { restartLimit?: number } = {}): GatewaySupervisor {
  let id = 0;
  return new GatewaySupervisor({
    build: BUILD,
    createId: () => {
      id += 1;
      return `id-${id}`;
    },
    discover: async () => w.record,
    isAlive: (pid) => w.alive.has(pid),
    connect: async (found) => {
      const custom = w.connectAnswer?.(found);
      if (custom) return custom;
      if (!w.alive.has(found.pid))
        return { ok: false, failure: GATEWAY_CONNECT_FAILURE.UNREACHABLE };
      const connection = new FakeConnection({
        protocolVersion: found.protocolVersion,
        buildVersion: found.buildVersion,
      });
      w.connections.push(connection);
      return { ok: true, connection };
    },
    spawn: async (): Promise<GatewaySpawnedProcess> => {
      w.spawns += 1;
      w.nextPid += 1;
      const pid = w.nextPid;
      w.alive.add(pid);
      if (w.publishOnSpawn) w.record = record(pid);
      return {
        pid,
        exited: new Promise(() => undefined),
        kill: () => {
          w.alive.delete(pid);
        },
      };
    },
    now: () => w.clock.now,
    setTimeout: (work, delay) => {
      w.clock.now += delay;
      queueMicrotask(work);
      return undefined;
    },
    report: (message) => w.reports.push(message),
    ...options,
    discoveryWaitMs: 1_000,
    drainWaitMs: 500,
    stopWaitMs: 500,
  });
}

test("a healthy Gateway of this build is reattached to, and nothing is spawned", async () => {
  const w = world({ record: record(7), alive: new Set([7]) });
  const s = supervisor(w);
  const result = await s.attach();
  assert.deepEqual(result, { outcome: GATEWAY_ATTACH_OUTCOME.REATTACHED, pid: 7 });
  assert.equal(w.spawns, 0);
  assert.equal(s.state(), GATEWAY_ATTACHMENT.ATTACHED);
  assert.equal(s.transport.connected(), true);
});

test("no Gateway standing: one is started and attached once its discovery appears", async () => {
  const w = world();
  const s = supervisor(w);
  const result = await s.attach();
  assert.equal(result.outcome, GATEWAY_ATTACH_OUTCOME.STARTED);
  assert.equal(w.spawns, 1);
  assert.equal(s.state(), GATEWAY_ATTACHMENT.ATTACHED);
});

test("a stale record whose process is dead is not reattached; a Gateway is started", async () => {
  const w = world({ record: record(7) });
  const s = supervisor(w);
  const result = await s.attach();
  assert.equal(result.outcome, GATEWAY_ATTACH_OUTCOME.STARTED);
  assert.equal(w.spawns, 1);
});

test("a spawned Gateway that never publishes is killed and the failure is typed", async () => {
  const w = world({ publishOnSpawn: false });
  const s = supervisor(w);
  const result = await s.attach();
  assert.deepEqual(result, {
    outcome: GATEWAY_ATTACH_OUTCOME.FAILED,
    failure: GATEWAY_ATTACH_FAILURE.NOT_READY,
  });
  assert.equal(w.alive.size, 0);
  assert.equal(s.state(), GATEWAY_ATTACHMENT.FAILED);
});

test("a Gateway of another build is asked to shut down and drained before this build starts its own", async () => {
  const old = record(7, { protocolVersion: GATEWAY_PROTOCOL_VERSION, buildVersion: "0.9.0" });
  const w = world({ record: old, alive: new Set([7]) });
  w.connectAnswer = (found) => {
    if (found.pid !== 7) return undefined;
    const connection = new FakeConnection(old);
    w.connections.push(connection);
    const original = connection.request.bind(connection);
    connection.request = (request) => {
      if (request.method === GATEWAY_METHOD.SHUTDOWN) {
        // The old Gateway leaves and its record goes with it.
        w.alive.delete(7);
        w.record = undefined;
      }
      return original(request);
    };
    return { ok: true, connection };
  };
  const s = supervisor(w);
  const result = await s.attach();
  assert.equal(result.outcome, GATEWAY_ATTACH_OUTCOME.STARTED);
  assert.equal(w.connections[0]?.calls[0]?.method, GATEWAY_METHOD.SHUTDOWN);
  assert.equal(w.spawns, 1);
  assert.match(w.reports[0] ?? "", /draining/);
});

test("a standing Gateway that refuses the token is a typed failure, not a second Gateway", async () => {
  const w = world({ record: record(7), alive: new Set([7]) });
  w.connectAnswer = () => ({ ok: false, failure: GATEWAY_CONNECT_FAILURE.UNAUTHORIZED });
  const s = supervisor(w);
  const result = await s.attach();
  assert.deepEqual(result, {
    outcome: GATEWAY_ATTACH_OUTCOME.FAILED,
    failure: GATEWAY_ATTACH_FAILURE.UNAUTHORIZED,
  });
  assert.equal(w.spawns, 0);
});

test("the transport answers disconnected while nothing is attached, and delivers events once it is", async () => {
  const w = world({ record: record(7), alive: new Set([7]) });
  const s = supervisor(w);
  const before = await s.transport.request({
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: "r1",
    method: GATEWAY_METHOD.RUN_LIST,
    params: {},
  });
  assert.equal(before.ok, false);
  if (!before.ok) assert.equal(before.error.code, GATEWAY_ERROR.DISCONNECTED);
  const seen: GatewayEvent[] = [];
  s.transport.events((event) => seen.push(event));
  await s.attach();
  w.connections[0]?.emit({
    eventId: "e1",
    sequence: 1,
    kind: "runs.changed",
    at: 0,
    payload: {},
  });
  assert.equal(seen.length, 1);
  const after = await s.transport.request({
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: "r2",
    method: GATEWAY_METHOD.RUN_LIST,
    params: {},
  });
  assert.equal(after.ok, true);
});

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

test("a Gateway that goes away is restarted, but only three times a minute; then the failure stands typed", async () => {
  const w = world();
  const s = supervisor(w);
  await s.attach();
  assert.equal(w.spawns, 1);
  for (let crash = 1; crash <= 3; crash += 1) {
    const connection = w.connections.at(-1);
    assert.ok(connection);
    w.alive.delete(s.pid() ?? 0);
    w.record = undefined;
    connection.drop();
    await settle();
    assert.equal(s.state(), GATEWAY_ATTACHMENT.ATTACHED, `restart ${crash}`);
    assert.equal(w.spawns, 1 + crash);
  }
  w.alive.delete(s.pid() ?? 0);
  w.record = undefined;
  w.connections.at(-1)?.drop();
  await settle();
  assert.equal(s.state(), GATEWAY_ATTACHMENT.FAILED);
  assert.equal(w.spawns, 4);
  const answer = await s.transport.request({
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: "r",
    method: GATEWAY_METHOD.RUN_LIST,
    params: {},
  });
  assert.equal(answer.ok, false);
  if (!answer.ok) assert.equal(answer.error.code, GATEWAY_ERROR.DISCONNECTED);
  assert.match(w.reports.at(-1) ?? "", /not restarting/);
  // An explicit attach begins again.
  const again = await s.attach();
  assert.equal(again.outcome, GATEWAY_ATTACH_OUTCOME.STARTED);
});

test("the restart budget is a sliding window: a crash a minute later is restarted again", async () => {
  const w = world();
  const s = supervisor(w);
  await s.attach();
  for (let crash = 1; crash <= 3; crash += 1) {
    w.alive.delete(s.pid() ?? 0);
    w.record = undefined;
    w.connections.at(-1)?.drop();
    await settle();
  }
  w.clock.now += 61_000;
  w.alive.delete(s.pid() ?? 0);
  w.record = undefined;
  w.connections.at(-1)?.drop();
  await settle();
  assert.equal(s.state(), GATEWAY_ATTACHMENT.ATTACHED);
  assert.equal(w.spawns, 5);
});

test("an explicit stop asks the Gateway to shut down, waits for it to leave, and restarts nothing", async () => {
  const w = world();
  const s = supervisor(w);
  await s.attach();
  const pid = s.pid();
  const connection = w.connections[0];
  assert.ok(connection && pid !== undefined);
  const original = connection.request.bind(connection);
  connection.request = (request) => {
    if (request.method === GATEWAY_METHOD.SHUTDOWN) w.alive.delete(pid);
    return original(request);
  };
  await s.stop();
  assert.equal(connection.calls.at(-1)?.method, GATEWAY_METHOD.SHUTDOWN);
  assert.ok(connection.calls.at(-1)?.idempotencyKey);
  assert.equal(s.state(), GATEWAY_ATTACHMENT.STOPPED);
  assert.equal(w.spawns, 1);
  const after = await s.attach();
  assert.equal(after.outcome, GATEWAY_ATTACH_OUTCOME.FAILED);
});
