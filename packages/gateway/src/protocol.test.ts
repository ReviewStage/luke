import assert from "node:assert/strict";
import { isRecord, type WireRecord, type WireValue } from "@sidecar/wire";
import { test } from "vitest";
import { GatewayClient } from "./client.js";
import { gatewayError, gatewayOk } from "./methods.js";
import { NodeRegistry } from "./nodes.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_RECONNECT_KIND,
  type GatewayClientIdentity,
  type GatewayEvent,
  gatewayReconnectAnswerFromWire,
  gatewayRequestFromWire,
  gatewayRequestToWire,
  NODE_CAPABILITY_STATUS,
} from "./protocol.js";
import { type GatewayTestHost, gatewayTestHost, TextLoopbackTransport } from "./testing.js";
import { type GatewayTransport, InProcessTransport } from "./transport.js";

const OPERATOR: GatewayClientIdentity = {
  clientId: "operator",
  role: GATEWAY_CLIENT_ROLE.OPERATOR,
};
const NODE: GatewayClientIdentity = { clientId: "node", role: GATEWAY_CLIENT_ROLE.NODE };

/** A wire value the test expects to be a record; anything else fails the test where it stands. */
function recordOf(value: WireValue | undefined): WireRecord {
  assert.ok(isRecord(value));
  return value;
}

interface Harness {
  host: GatewayTestHost;
  nodes: NodeRegistry;
  effects: string[];
  configurationRevision: { value: number };
  sessionRevision: Map<string, string>;
  snapshots: number;
}

async function harness(replayWindow = 500): Promise<Harness> {
  const effects: string[] = [];
  const configurationRevision = { value: 1 };
  const sessionRevision = new Map<string, string>([["agent:main:main", "gen-1"]]);
  const nodes = new NodeRegistry();
  let ids = 0;
  const counters = { snapshots: 0 };
  const host = await gatewayTestHost({
    methods: {
      [GATEWAY_METHOD.RUN_SUBMIT]: (params) => {
        effects.push(`submit ${String(params.submissionId)}`);
        return gatewayOk({ outcome: "accepted", runId: `run-${effects.length}` });
      },
      [GATEWAY_METHOD.RUN_LIST]: () => gatewayOk({ runs: [] }),
      [GATEWAY_METHOD.CONVERSATION_DELETE]: () => {
        effects.push("delete");
        return gatewayOk({ outcome: "complete" });
      },
      [GATEWAY_METHOD.NODE_INVOKE]: async (params) => {
        const result = await nodes.invoke(String(params.capability), {});
        if (result.status === NODE_CAPABILITY_STATUS.OK) {
          effects.push(`invoked ${String(params.capability)}`);
          return gatewayOk({ status: result.status });
        }
        return gatewayOk({ status: result.status, reason: result.reason });
      },
      [GATEWAY_METHOD.MEMORY_STATUS]: () => {
        throw new Error("the index fell over");
      },
      [GATEWAY_METHOD.CONFIGURATION_UPDATE]: () =>
        gatewayError(GATEWAY_ERROR.REFUSED, "nothing settable"),
    },
    configurationRevision: () => configurationRevision.value,
    sessionRevision: (key) => sessionRevision.get(key),
    snapshot: () => {
      counters.snapshots += 1;
      return { runs: [], snapshotOf: counters.snapshots };
    },
    now: () => 1_800_000_000_000,
    createEventId: () => `event-${++ids}`,
    replayWindow,
  });
  return {
    host,
    nodes,
    effects,
    configurationRevision,
    sessionRevision,
    get snapshots() {
      return counters.snapshots;
    },
  };
}

type TransportKind = "in-process" | "loopback";

function transportFor(kind: TransportKind, host: GatewayTestHost, identity = OPERATOR) {
  return kind === "in-process"
    ? new InProcessTransport(host, identity)
    : new TextLoopbackTransport(host, identity);
}

/** Holds every answer of the transport until the scheduled work is fired, so an event can land mid-request. */
function answeringLate(
  transport: GatewayTransport,
  schedule: (work: () => void) => void,
): GatewayTransport {
  return {
    connected: () => transport.connected(),
    events: (sink) => transport.events(sink),
    request: async (request) => {
      const response = await transport.request(request);
      await new Promise<void>((resolve) => schedule(resolve));
      return response;
    },
  };
}

function client(transport: GatewayTransport, onSnapshot?: (snapshot: WireValue) => void) {
  let ids = 0;
  return new GatewayClient({
    transport,
    createId: () => `request-${++ids}`,
    ...(onSnapshot ? { onSnapshot } : undefined),
  });
}

/**
 * The same suite runs against both transports: the in-process one the build
 * ships and the loopback one that carries every envelope through text, so
 * a shape that only works because it never left the process fails here.
 */
for (const kind of ["in-process", "loopback"] as const) {
  test(`[${kind}] a mutation carries an idempotency key, and the same key finds the first answer once`, async () => {
    const h = await harness();
    const c = client(transportFor(kind, h.host));
    const first = await c.call(
      GATEWAY_METHOD.RUN_SUBMIT,
      { submissionId: "sub-1", question: "hi" },
      { idempotencyKey: "sub-1" },
    );
    const retry = await c.call(
      GATEWAY_METHOD.RUN_SUBMIT,
      { submissionId: "sub-1", question: "hi" },
      { idempotencyKey: "sub-1" },
    );
    assert.deepEqual(first, retry);
    assert.deepEqual(h.effects, ["submit sub-1"]);
    // The same key with other words is a conflict, never a second effect.
    const other = await c.call(
      GATEWAY_METHOD.RUN_SUBMIT,
      { submissionId: "sub-1", question: "other" },
      { idempotencyKey: "sub-1" },
    );
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.error.code, GATEWAY_ERROR.IDEMPOTENCY_CONFLICT);
    assert.deepEqual(h.effects, ["submit sub-1"]);
    // A raw request with no key is refused before any handler runs.
    const bare = await transportFor(kind, h.host).request({
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      id: "raw-1",
      method: GATEWAY_METHOD.CONVERSATION_DELETE,
      params: {},
    });
    assert.equal(bare.ok, false);
    if (!bare.ok) assert.equal(bare.error.code, GATEWAY_ERROR.MISSING_IDEMPOTENCY_KEY);
    assert.deepEqual(h.effects, ["submit sub-1"]);
  });

  test(`[${kind}] two retries in flight together await one decision`, async () => {
    const h = await harness();
    const c = client(transportFor(kind, h.host));
    const [a, b] = await Promise.all([
      c.call(GATEWAY_METHOD.RUN_SUBMIT, { submissionId: "s" }, { idempotencyKey: "k" }),
      c.call(GATEWAY_METHOD.RUN_SUBMIT, { submissionId: "s" }, { idempotencyKey: "k" }),
    ]);
    assert.deepEqual(a, b);
    assert.deepEqual(h.effects, ["submit s"]);
  });

  test(`[${kind}] a request built over a replaced lifetime or configuration is refused before its handler`, async () => {
    const h = await harness();
    const c = client(transportFor(kind, h.host));
    const stale = await c.call(
      GATEWAY_METHOD.CONVERSATION_DELETE,
      {},
      { expectedRevision: { sessionKey: "agent:main:main", sessionRevision: "gen-0" } },
    );
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.code, GATEWAY_ERROR.REVISION_MISMATCH);
    const current = await c.call(
      GATEWAY_METHOD.CONVERSATION_DELETE,
      {},
      { expectedRevision: { sessionKey: "agent:main:main", sessionRevision: "gen-1" } },
    );
    assert.equal(current.ok, true);
    h.configurationRevision.value = 2;
    const oldConfiguration = await c.call(
      GATEWAY_METHOD.RUN_LIST,
      {},
      { expectedRevision: { configurationRevision: 1 } },
    );
    assert.equal(oldConfiguration.ok, false);
    if (!oldConfiguration.ok)
      assert.equal(oldConfiguration.error.code, GATEWAY_ERROR.REVISION_MISMATCH);
    assert.deepEqual(h.effects, ["delete"]);
  });

  test(`[${kind}] unknown methods, unsupported versions, thrown handlers, and typed refusals all answer as errors`, async () => {
    const h = await harness();
    const c = client(transportFor(kind, h.host));
    const unknown = await c.call(GATEWAY_METHOD.CHILD_LIST);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error.code, GATEWAY_ERROR.UNKNOWN_METHOD);
    const thrown = await c.call(GATEWAY_METHOD.MEMORY_STATUS);
    assert.equal(thrown.ok, false);
    if (!thrown.ok) assert.equal(thrown.error.code, GATEWAY_ERROR.INTERNAL);
    const refused = await c.call(GATEWAY_METHOD.CONFIGURATION_UPDATE, {});
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.code, GATEWAY_ERROR.REFUSED);
    const version = await transportFor(kind, h.host).request({
      protocolVersion: GATEWAY_PROTOCOL_VERSION + 1,
      id: "v",
      method: GATEWAY_METHOD.RUN_LIST,
      params: {},
    });
    assert.equal(version.ok, false);
    if (!version.ok) assert.equal(version.error.code, GATEWAY_ERROR.UNSUPPORTED_VERSION);
  });

  test(`[${kind}] a node may only offer itself; the operator's methods are refused to it`, async () => {
    const h = await harness();
    const node = client(transportFor(kind, h.host, NODE));
    const refused = await node.call(GATEWAY_METHOD.RUN_LIST);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.code, GATEWAY_ERROR.UNAUTHORIZED);
    const hello = await node.call(GATEWAY_METHOD.HELLO);
    assert.equal(hello.ok, true);
  });

  test(`[${kind}] events arrive numbered in order, and a gap is filled from the host's log before anything later is delivered`, async () => {
    const h = await harness();
    const transport = transportFor(kind, h.host);
    const c = client(transport);
    const seen: number[] = [];
    c.onEvery((event) => seen.push(event.sequence));
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    assert.deepEqual(seen, [1, 2]);
    // The wire loses two events; the third to arrive shows the gap.
    if (transport instanceof TextLoopbackTransport) transport.dropNextEvents(2);
    else transport.setConnected(false);
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    h.host.emit(GATEWAY_EVENT.DIRECTORY_CHANGED, { entries: [] });
    if (!(transport instanceof TextLoopbackTransport)) transport.setConnected(true);
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [1, 2, 3, 4, 5]);
    assert.equal(c.lastSequence(), 5);
  });

  test(`[${kind}] an event emitted while a reconnection is in flight is delivered once it settles, not at the next gap`, async () => {
    const h = await harness();
    const timers: Array<() => void> = [];
    const schedule = (work: () => void) => {
      timers.push(work);
    };
    const inner = transportFor(kind, h.host);
    const transport =
      inner instanceof TextLoopbackTransport
        ? new TextLoopbackTransport(h.host, OPERATOR, { responseDelayMs: 50, schedule })
        : answeringLate(inner, schedule);
    const c = client(transport);
    const seen: number[] = [];
    c.onEvery((event) => seen.push(event.sequence));
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    // The wire loses event 2; event 3 shows the gap and opens the reconnection.
    if (transport instanceof TextLoopbackTransport) transport.dropNextEvents(1);
    else inner.setConnected(false);
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    inner.setConnected(true);
    h.host.emit(GATEWAY_EVENT.DIRECTORY_CHANGED, { entries: [] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(timers.length, 1);
    // The host has answered from sequence 3; event 4 is emitted before the client adopts that answer.
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    assert.deepEqual(seen, [1]);
    for (const fire of timers.splice(0)) fire();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [1, 2, 3, 4]);
    assert.equal(c.lastSequence(), 4);
  });

  test(`[${kind}] a reconnection past the replay window is answered with a snapshot, never a silent skip`, async () => {
    const h = await harness(3);
    const transport = transportFor(kind, h.host);
    const adopted: WireValue[] = [];
    const c = client(transport, (snapshot) => adopted.push(snapshot));
    const seen: GatewayEvent[] = [];
    c.onEvery((event) => seen.push(event));
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    transport.setConnected(false);
    for (let i = 0; i < 5; i += 1) h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    transport.setConnected(true);
    await c.reconnect();
    assert.equal(seen.length, 1);
    assert.equal(adopted.length, 1);
    assert.equal(c.lastSequence(), 6);
    // Within the window, the replay carries every missed event instead.
    transport.setConnected(false);
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    h.host.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    transport.setConnected(true);
    await c.reconnect();
    assert.deepEqual(
      seen.map((event) => event.sequence),
      [1, 7, 8],
    );
    assert.equal(adopted.length, 1);
    // A client asking from the current sequence is owed nothing.
    const nothing = await c.call(GATEWAY_METHOD.RECONNECT, { lastSequence: 8 });
    assert.ok(nothing.ok);
    const answer = nothing.ok ? gatewayReconnectAnswerFromWire(nothing.result) : undefined;
    assert.deepEqual(answer, { kind: GATEWAY_RECONNECT_KIND.REPLAY, events: [] });
  });

  test(`[${kind}] a disconnected transport answers every request disconnected rather than hanging`, async () => {
    const h = await harness();
    const transport = transportFor(kind, h.host);
    const c = client(transport);
    transport.setConnected(false);
    const answer = await c.call(GATEWAY_METHOD.RUN_LIST);
    assert.equal(answer.ok, false);
    if (!answer.ok) assert.equal(answer.error.code, GATEWAY_ERROR.DISCONNECTED);
    assert.deepEqual(h.effects, []);
  });

  test(`[${kind}] a disconnected required node answers a typed unavailable and nothing records the action as done`, async () => {
    const h = await harness();
    const c = client(transportFor(kind, h.host));
    const changes: WireValue[] = [];
    c.on(GATEWAY_EVENT.NODE_CHANGED, (event) => changes.push(event.payload));
    h.nodes.onChange((nodes) => {
      h.host.emit(GATEWAY_EVENT.NODE_CHANGED, {
        nodes: nodes.map((node) => ({ ...node, capabilities: [...node.capabilities] })),
      });
    });
    const unknown = await c.call(GATEWAY_METHOD.NODE_INVOKE, { capability: "os.openExternal" });
    assert.ok(unknown.ok);
    if (unknown.ok) {
      assert.equal(recordOf(unknown.result).status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    }
    h.nodes.register({
      nodeId: "desktop-native",
      capabilities: { "os.openExternal": () => undefined },
    });
    const ok = await c.call(GATEWAY_METHOD.NODE_INVOKE, { capability: "os.openExternal" });
    assert.ok(ok.ok && recordOf(ok.result).status === NODE_CAPABILITY_STATUS.OK);
    h.nodes.setConnected("desktop-native", false);
    const gone = await c.call(GATEWAY_METHOD.NODE_INVOKE, { capability: "os.openExternal" });
    assert.ok(gone.ok && recordOf(gone.result).status === NODE_CAPABILITY_STATUS.UNAVAILABLE);
    assert.deepEqual(h.effects, ["invoked os.openExternal"]);
    assert.equal(changes.length, 2);
  });
}

test("a method outside the vocabulary is refused by the writer before it reaches the wire, and by the reader when it arrives", () => {
  const envelope = {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: "x",
    method: "not.a.method",
    params: {},
  };
  // SAFETY: a method name outside the vocabulary, as a foreign client might send; the writer must refuse it rather than carry it.
  assert.throws(() =>
    gatewayRequestToWire({
      ...envelope,
      method: envelope.method as typeof GATEWAY_METHOD.RUN_LIST,
    }),
  );
  assert.equal(gatewayRequestFromWire(envelope), undefined);
});

test("a delayed answer still lands, and a late acknowledgement after it changes nothing more", async () => {
  const h = await harness();
  const timers: Array<() => void> = [];
  const transport = new TextLoopbackTransport(h.host, OPERATOR, {
    responseDelayMs: 50,
    schedule: (work) => {
      timers.push(work);
    },
  });
  const c = client(transport);
  let answered = false;
  const pending = c.call(GATEWAY_METHOD.RUN_LIST).then((answer) => {
    answered = true;
    return answer;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, false);
  assert.equal(timers.length, 1);
  timers[0]?.();
  const answer = await pending;
  assert.equal(answer.ok, true);
});
