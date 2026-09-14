import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { isRecord, type WireRecord, type WireValue } from "@sidecar/wire";
import { Effect, Fiber, type Scope } from "effect";
import { test } from "vitest";
import { gatewayClient } from "./client.js";
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
  RefusedRefusal,
} from "./protocol.js";
import { type GatewayInProcessHost, gatewayInProcessHost } from "./server.js";
import { TextLoopbackTransport } from "./testing.js";
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
  host: GatewayInProcessHost;
  nodes: NodeRegistry;
  effects: string[];
  configurationRevision: { value: number };
  sessionRevision: Map<string, string>;
  snapshots: number;
}

function harness(replayWindow = 500): Effect.Effect<Harness, never, Scope.Scope> {
  const effects: string[] = [];
  const configurationRevision = { value: 1 };
  const sessionRevision = new Map<string, string>([["agent:main:main", "gen-1"]]);
  const nodes = new NodeRegistry();
  let ids = 0;
  const counters = { snapshots: 0 };
  return Effect.map(
    gatewayInProcessHost({
      methods: {
        [GATEWAY_METHOD.GUIDE_REPORT]: (params) => {
          effects.push(`report ${String(params.reportId)}`);
          return Effect.succeed({ outcome: "accepted", runId: `run-${effects.length}` });
        },
        [GATEWAY_METHOD.SESSION_ROSTER]: () => Effect.succeed({ sessions: [] }),
        [GATEWAY_METHOD.CONVERSATION_CLEAR]: () => {
          effects.push("clear");
          return Effect.succeed({ outcome: "complete" });
        },
        [GATEWAY_METHOD.NODE_INVOKE]: (params) =>
          Effect.map(nodes.invoke(String(params.capability), {}), (result) => {
            if (result.status === NODE_CAPABILITY_STATUS.OK) {
              effects.push(`invoked ${String(params.capability)}`);
              return { status: result.status };
            }
            return { status: result.status, reason: result.reason };
          }),
        [GATEWAY_METHOD.VOICE_DIAGNOSTICS]: () => {
          throw new Error("the index fell over");
        },
        [GATEWAY_METHOD.SETTINGS_UPDATE]: () =>
          Effect.fail(new RefusedRefusal({ message: "nothing settable" })),
      },
      configurationRevision: () => configurationRevision.value,
      sessionRevision: (key) => sessionRevision.get(key),
      snapshot: () => {
        counters.snapshots += 1;
        return { sessions: [], snapshotOf: counters.snapshots };
      },
      now: () => 1_800_000_000_000,
      createEventId: () => `event-${++ids}`,
      replayWindow,
    }),
    (host) => ({
      host,
      nodes,
      effects,
      configurationRevision,
      sessionRevision,
      get snapshots() {
        return counters.snapshots;
      },
    }),
  );
}

type TransportKind = "in-process" | "loopback";

function transportFor(kind: TransportKind, host: GatewayInProcessHost, identity = OPERATOR) {
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
    request: (request) =>
      Effect.tap(transport.request(request), () =>
        Effect.callback<void>((resume) => {
          schedule(() => resume(Effect.void));
        }),
      ),
  };
}

function client(transport: GatewayTransport, onSnapshot?: (snapshot: WireValue) => void) {
  let ids = 0;
  return gatewayClient({
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
  it.live(
    `[${kind}] a mutation carries an idempotency key, and the same key finds the first answer once`,
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const c = yield* client(transportFor(kind, h.host));
        const first = yield* c.call(
          GATEWAY_METHOD.GUIDE_REPORT,
          { reportId: "sub-1", question: "hi" },
          { idempotencyKey: "sub-1" },
        );
        const retry = yield* c.call(
          GATEWAY_METHOD.GUIDE_REPORT,
          { reportId: "sub-1", question: "hi" },
          { idempotencyKey: "sub-1" },
        );
        assert.deepEqual(first, retry);
        assert.deepEqual(h.effects, ["report sub-1"]);
        // The same key with other words is a conflict, never a second effect.
        const other = yield* c.call(
          GATEWAY_METHOD.GUIDE_REPORT,
          { reportId: "sub-1", question: "other" },
          { idempotencyKey: "sub-1" },
        );
        assert.equal(other.ok, false);
        if (!other.ok) assert.equal(other.error.code, GATEWAY_ERROR.IDEMPOTENCY_CONFLICT);
        assert.deepEqual(h.effects, ["report sub-1"]);
        // A raw request with no key is refused before any handler runs.
        const bare = yield* transportFor(kind, h.host).request({
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          id: "raw-1",
          method: GATEWAY_METHOD.CONVERSATION_CLEAR,
          params: {},
        });
        assert.equal(bare.ok, false);
        if (!bare.ok) assert.equal(bare.error.code, GATEWAY_ERROR.MISSING_IDEMPOTENCY_KEY);
        assert.deepEqual(h.effects, ["report sub-1"]);
      }),
  );

  it.live(`[${kind}] two retries in flight together await one decision`, () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const c = yield* client(transportFor(kind, h.host));
      const [a, b] = yield* Effect.all(
        [
          c.call(GATEWAY_METHOD.GUIDE_REPORT, { reportId: "s" }, { idempotencyKey: "k" }),
          c.call(GATEWAY_METHOD.GUIDE_REPORT, { reportId: "s" }, { idempotencyKey: "k" }),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(a, b);
      assert.deepEqual(h.effects, ["report s"]);
    }),
  );

  it.live(
    `[${kind}] a request built over a replaced lifetime or configuration is refused before its handler`,
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const c = yield* client(transportFor(kind, h.host));
        const stale = yield* c.call(
          GATEWAY_METHOD.CONVERSATION_CLEAR,
          {},
          { expectedRevision: { sessionKey: "agent:main:main", sessionRevision: "gen-0" } },
        );
        assert.equal(stale.ok, false);
        if (!stale.ok) assert.equal(stale.error.code, GATEWAY_ERROR.REVISION_MISMATCH);
        const current = yield* c.call(
          GATEWAY_METHOD.CONVERSATION_CLEAR,
          {},
          { expectedRevision: { sessionKey: "agent:main:main", sessionRevision: "gen-1" } },
        );
        assert.equal(current.ok, true);
        h.configurationRevision.value = 2;
        const oldConfiguration = yield* c.call(
          GATEWAY_METHOD.SESSION_ROSTER,
          {},
          { expectedRevision: { configurationRevision: 1 } },
        );
        assert.equal(oldConfiguration.ok, false);
        if (!oldConfiguration.ok)
          assert.equal(oldConfiguration.error.code, GATEWAY_ERROR.REVISION_MISMATCH);
        assert.deepEqual(h.effects, ["clear"]);
      }),
  );

  it.live(
    `[${kind}] unknown methods, unsupported versions, thrown handlers, and typed refusals all answer as errors`,
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const c = yield* client(transportFor(kind, h.host));
        const unknown = yield* c.call(GATEWAY_METHOD.WORKSPACE_PROJECTS);
        assert.equal(unknown.ok, false);
        if (!unknown.ok) assert.equal(unknown.error.code, GATEWAY_ERROR.UNKNOWN_METHOD);
        const thrown = yield* c.call(GATEWAY_METHOD.VOICE_DIAGNOSTICS);
        assert.equal(thrown.ok, false);
        if (!thrown.ok) assert.equal(thrown.error.code, GATEWAY_ERROR.INTERNAL);
        const refused = yield* c.call(GATEWAY_METHOD.SETTINGS_UPDATE, {});
        assert.equal(refused.ok, false);
        if (!refused.ok) assert.equal(refused.error.code, GATEWAY_ERROR.REFUSED);
        const version = yield* transportFor(kind, h.host).request({
          protocolVersion: GATEWAY_PROTOCOL_VERSION + 1,
          id: "v",
          method: GATEWAY_METHOD.SESSION_ROSTER,
          params: {},
        });
        assert.equal(version.ok, false);
        if (!version.ok) assert.equal(version.error.code, GATEWAY_ERROR.UNSUPPORTED_VERSION);
      }),
  );

  it.live(`[${kind}] a node may only offer itself; the operator's methods are refused to it`, () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const node = yield* client(transportFor(kind, h.host, NODE));
      const refused = yield* node.call(GATEWAY_METHOD.SESSION_ROSTER);
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.error.code, GATEWAY_ERROR.UNAUTHORIZED);
      const hello = yield* node.call(GATEWAY_METHOD.HELLO);
      assert.equal(hello.ok, true);
    }),
  );

  it.live(
    `[${kind}] events arrive numbered in order, and a gap is filled from the host's log before anything later is delivered`,
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const transport = transportFor(kind, h.host);
        const c = yield* client(transport);
        const seen: number[] = [];
        c.onEvery((event) => seen.push(event.sequence));
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        assert.deepEqual(seen, [1, 2]);
        // The wire loses two events; the third to arrive shows the gap.
        if (transport instanceof TextLoopbackTransport) transport.dropNextEvents(2);
        else transport.setConnected(false);
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        h.host.log.publish(GATEWAY_EVENT.SETTINGS_CHANGED, { settings: {} });
        if (!(transport instanceof TextLoopbackTransport)) transport.setConnected(true);
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
        yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
        assert.deepEqual(seen, [1, 2, 3, 4, 5]);
        assert.equal(c.lastSequence(), 5);
      }),
  );

  it.live(
    `[${kind}] an event emitted while a reconnection is in flight is delivered once it settles, not at the next gap`,
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const timers: Array<() => void> = [];
        const schedule = (work: () => void) => {
          timers.push(work);
        };
        const inner = transportFor(kind, h.host);
        const transport =
          inner instanceof TextLoopbackTransport
            ? new TextLoopbackTransport(h.host, OPERATOR, { responseDelayMs: 50, schedule })
            : answeringLate(inner, schedule);
        const c = yield* client(transport);
        const seen: number[] = [];
        c.onEvery((event) => seen.push(event.sequence));
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        // The wire loses event 2; event 3 shows the gap and opens the reconnection.
        if (transport instanceof TextLoopbackTransport) transport.dropNextEvents(1);
        else inner.setConnected(false);
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        inner.setConnected(true);
        h.host.log.publish(GATEWAY_EVENT.SETTINGS_CHANGED, { settings: {} });
        yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
        assert.equal(timers.length, 1);
        // The host has answered from sequence 3; event 4 is emitted before the client adopts that answer.
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        assert.deepEqual(seen, [1]);
        for (const fire of timers.splice(0)) fire();
        yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
        yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
        assert.deepEqual(seen, [1, 2, 3, 4]);
        assert.equal(c.lastSequence(), 4);
      }),
  );

  it.live(
    `[${kind}] a reconnection past the replay window is answered with a snapshot, never a silent skip`,
    () =>
      Effect.gen(function* () {
        const h = yield* harness(3);
        const transport = transportFor(kind, h.host);
        const adopted: WireValue[] = [];
        const c = yield* client(transport, (snapshot) => adopted.push(snapshot));
        const seen: GatewayEvent[] = [];
        c.onEvery((event) => seen.push(event));
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        transport.setConnected(false);
        for (let i = 0; i < 5; i += 1)
          h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        transport.setConnected(true);
        yield* c.reconnect();
        assert.equal(seen.length, 1);
        assert.equal(adopted.length, 1);
        assert.equal(c.lastSequence(), 6);
        // Within the window, the replay carries every missed event instead.
        transport.setConnected(false);
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        h.host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
        transport.setConnected(true);
        yield* c.reconnect();
        assert.deepEqual(
          seen.map((event) => event.sequence),
          [1, 7, 8],
        );
        assert.equal(adopted.length, 1);
        // A client asking from the current sequence is owed nothing.
        const nothing = yield* c.call(GATEWAY_METHOD.RECONNECT, { lastSequence: 8 });
        assert.ok(nothing.ok);
        const answer = nothing.ok ? gatewayReconnectAnswerFromWire(nothing.result) : undefined;
        assert.deepEqual(answer, { kind: GATEWAY_RECONNECT_KIND.REPLAY, events: [] });
      }),
  );

  it.live(
    `[${kind}] a disconnected transport answers every request disconnected rather than hanging`,
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const transport = transportFor(kind, h.host);
        const c = yield* client(transport);
        transport.setConnected(false);
        const answer = yield* c.call(GATEWAY_METHOD.SESSION_ROSTER);
        assert.equal(answer.ok, false);
        if (!answer.ok) assert.equal(answer.error.code, GATEWAY_ERROR.DISCONNECTED);
        assert.deepEqual(h.effects, []);
      }),
  );

  it.live(
    `[${kind}] a disconnected required node answers a typed unavailable and nothing records the action as done`,
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const c = yield* client(transportFor(kind, h.host));
        const changes: WireValue[] = [];
        c.on(GATEWAY_EVENT.NODE_CHANGED, (event) => changes.push(event.payload));
        h.nodes.onChange((nodes) => {
          h.host.log.publish(GATEWAY_EVENT.NODE_CHANGED, {
            nodes: nodes.map((node) => ({ ...node, capabilities: [...node.capabilities] })),
          });
        });
        const unknown = yield* c.call(GATEWAY_METHOD.NODE_INVOKE, {
          capability: "os.openExternal",
        });
        assert.ok(unknown.ok);
        if (unknown.ok) {
          assert.equal(recordOf(unknown.result).status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
        }
        h.nodes.register({
          nodeId: "desktop-native",
          capabilities: { "os.openExternal": () => undefined },
        });
        const ok = yield* c.call(GATEWAY_METHOD.NODE_INVOKE, { capability: "os.openExternal" });
        assert.ok(ok.ok && recordOf(ok.result).status === NODE_CAPABILITY_STATUS.OK);
        h.nodes.setConnected("desktop-native", false);
        const gone = yield* c.call(GATEWAY_METHOD.NODE_INVOKE, { capability: "os.openExternal" });
        assert.ok(gone.ok && recordOf(gone.result).status === NODE_CAPABILITY_STATUS.UNAVAILABLE);
        assert.deepEqual(h.effects, ["invoked os.openExternal"]);
        assert.equal(changes.length, 2);
      }),
  );
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
      method: envelope.method as typeof GATEWAY_METHOD.SESSION_ROSTER,
    }),
  );
  assert.equal(gatewayRequestFromWire(envelope), undefined);
});

it.live(
  "a delayed answer still lands, and a late acknowledgement after it changes nothing more",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const timers: Array<() => void> = [];
      const transport = new TextLoopbackTransport(h.host, OPERATOR, {
        responseDelayMs: 50,
        schedule: (work) => {
          timers.push(work);
        },
      });
      const c = yield* client(transport);
      let answered = false;
      const pending = yield* Effect.forkChild(
        Effect.tap(c.call(GATEWAY_METHOD.SESSION_ROSTER), () =>
          Effect.sync(() => {
            answered = true;
          }),
        ),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
      assert.equal(answered, false);
      assert.equal(timers.length, 1);
      timers[0]?.();
      const answer = yield* Fiber.join(pending);
      assert.equal(answer.ok, true);
    }),
);
