import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { isRecord, isWireString } from "@sidecar/wire";
import { Deferred, Effect, Fiber, type Scope } from "effect";
import { gatewayClient } from "./client.js";
import { type InvocationMemory, invocationMemory } from "./invocations.js";
import type { GatewayMethodTable } from "./methods.js";
import { NodeRegistry } from "./nodes.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayClientIdentity,
  type GatewayResponse,
  NODE_CAPABILITY_STATUS,
  type NodeInvocation,
  RefusedRefusal,
} from "./protocol.js";
import { type GatewayInProcessHost, gatewayInProcessHost } from "./server.js";
import { TextLoopbackTransport } from "./testing.js";
import { InProcessTransport } from "./transport.js";

const OPERATOR: GatewayClientIdentity = {
  clientId: "desktop",
  role: GATEWAY_CLIENT_ROLE.OPERATOR,
};
const CAPABILITY = "os.openExternal";
const NODE_ID = "desktop-native";

/**
 * A host whose one method registers the node of the connection that asks,
 * exactly as the desktop's service does: the invoker is bound to that
 * connection, and its closing disconnects the node.
 */
function nodeMethods() {
  const nodes = new NodeRegistry();
  const owners = new Map<string, string>();
  let ids = 0;
  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.NODE_REGISTER]: (params, context) => {
      const connection = context.connection;
      if (!connection || !isWireString(params.nodeId)) {
        return Effect.fail(new RefusedRefusal({ message: "no connection" }));
      }
      const nodeId = params.nodeId;
      owners.set(nodeId, connection.connectionId);
      nodes.registerRemote({
        nodeId,
        capabilities: Array.isArray(params.capabilities)
          ? params.capabilities.filter(isWireString)
          : [],
        invoke: (capability, invoked) =>
          connection.invoke({
            invocationId: `invocation-${++ids}`,
            nodeId,
            capability,
            params: invoked,
          }),
      });
      connection.onClosed(() => {
        if (owners.get(nodeId) === connection.connectionId) nodes.setConnected(nodeId, false);
      });
      return Effect.succeed({ nodeId });
    },
  };
  return { methods, nodes, nextId: () => `event-${++ids}` };
}

function hostWithNodes(): Effect.Effect<
  { readonly host: GatewayInProcessHost; readonly nodes: NodeRegistry },
  never,
  Scope.Scope
> {
  const { methods, nodes, nextId } = nodeMethods();
  return Effect.map(
    gatewayInProcessHost({
      methods,
      configurationRevision: () => 1,
      sessionRevision: () => undefined,
      snapshot: () => ({}),
      now: () => 0,
      createEventId: nextId,
    }),
    (host) => ({ host, nodes }),
  );
}

/** The one door each host admitted this client through; a host without one would be a second connection for the same client. */
function doorOf(
  doors: ReadonlyMap<GatewayInProcessHost, InProcessTransport>,
  host: GatewayInProcessHost,
): InProcessTransport {
  const door = doors.get(host);
  if (!door) throw new Error("the host was never given a door");
  return door;
}

const INVOCATION: NodeInvocation = {
  invocationId: "i-1",
  nodeId: NODE_ID,
  capability: CAPABILITY,
  params: { url: "https://example.test" },
};

/**
 * A memory whose one performance says when it began and answers only when
 * the test lets it, so a duplicate can be made to arrive while the first is
 * still out.
 */
const heldMemory = (performances: {
  count: number;
}): Effect.Effect<
  {
    readonly memory: InvocationMemory;
    readonly started: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const memory = yield* invocationMemory({
      handler: (invocation) =>
        Effect.gen(function* () {
          performances.count += 1;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return { status: NODE_CAPABILITY_STATUS.OK, value: invocation.params.url };
        }),
    });
    return { memory, started, release };
  });

it.effect(
  "the node's memory performs a distinct invocation once and answers a duplicate from the first performance",
  () =>
    Effect.gen(function* () {
      const performances = { count: 0 };
      const held = yield* heldMemory(performances);
      const first = yield* Effect.forkChild(held.memory.take(INVOCATION));
      yield* Deferred.await(held.started);
      const duplicateWhilePending = yield* Effect.forkChild(held.memory.take(INVOCATION));
      yield* Effect.yieldNow;
      assert.equal(performances.count, 1);
      yield* Deferred.succeed(held.release, undefined);
      const answered = yield* Fiber.join(first);
      assert.deepEqual(answered, {
        invocationId: "i-1",
        result: { status: NODE_CAPABILITY_STATUS.OK, value: "https://example.test" },
      });
      assert.deepEqual(yield* Fiber.join(duplicateWhilePending), answered);
      assert.deepEqual(yield* held.memory.take(INVOCATION), answered);
      assert.equal(performances.count, 1);
    }),
);

it.effect(
  "a duplicate is answered from the performance the first frame opened even where that frame's own caller gave up",
  () =>
    Effect.gen(function* () {
      const performances = { count: 0 };
      const held = yield* heldMemory(performances);
      const first = yield* Effect.forkChild(held.memory.take(INVOCATION));
      yield* Deferred.await(held.started);
      yield* Fiber.interrupt(first);
      const duplicate = yield* Effect.forkChild(held.memory.take(INVOCATION));
      yield* Deferred.succeed(held.release, undefined);
      assert.deepEqual(yield* Fiber.join(duplicate), {
        invocationId: "i-1",
        result: { status: NODE_CAPABILITY_STATUS.OK, value: "https://example.test" },
      });
      assert.equal(performances.count, 1);
    }),
);

for (const kind of ["in-process", "loopback"] as const) {
  it.live(
    `[${kind}] a node registered over a connection is invoked through it, and a repeated frame performs once`,
    () =>
      Effect.gen(function* () {
        const { host, nodes } = yield* hostWithNodes();
        const transport =
          kind === "in-process"
            ? new InProcessTransport(host, OPERATOR)
            : new TextLoopbackTransport(host, OPERATOR);
        const opened: string[] = [];
        yield* transport.serveInvocations?.((invocation) =>
          Effect.sync(() => {
            opened.push(String(invocation.params.url));
            return { status: NODE_CAPABILITY_STATUS.OK, value: undefined };
          }),
        ) ?? Effect.void;
        const client = yield* gatewayClient({
          transport,
          createId: () => `r-${opened.length}-${Math.random()}`,
        });
        const registered = yield* client.call(GATEWAY_METHOD.NODE_REGISTER, {
          nodeId: NODE_ID,
          capabilities: [CAPABILITY],
        });
        assert.ok(registered.ok);
        if (transport instanceof TextLoopbackTransport) transport.repeatNextInvocation(2);
        const result = yield* nodes.invoke(CAPABILITY, { url: "https://one.test" });
        assert.equal(result.status, NODE_CAPABILITY_STATUS.OK);
        assert.deepEqual(opened, ["https://one.test"]);
        // The connection closing disconnects the node: the next ask is never
        // dispatched and says so, distinctly from an ask whose answer was lost.
        yield* transport.close();
        const afterClose = yield* nodes.invoke(CAPABILITY, { url: "https://two.test" });
        assert.equal(afterClose.status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
        assert.deepEqual(opened, ["https://one.test"]);
      }),
  );
}

it.live(
  "a client that adopts a replaced host follows the new host's numbering from its snapshot rather than dropping its events",
  () =>
    Effect.gen(function* () {
      let ids = 0;
      const makeHost = (run: string) =>
        gatewayInProcessHost({
          methods: {},
          configurationRevision: () => 1,
          sessionRevision: () => undefined,
          snapshot: () => ({ sessions: [run] }),
          now: () => 0,
          createEventId: () => `event-${++ids}`,
        });
      // The client's one transport: requests go to the connection that now
      // stands, and every sink hears the events of that connection alone.
      const oldHost = yield* makeHost("old");
      const newHost = yield* makeHost("new");
      const doors = new Map<GatewayInProcessHost, InProcessTransport>([
        [oldHost, new InProcessTransport(oldHost, OPERATOR)],
        [newHost, new InProcessTransport(newHost, OPERATOR)],
      ]);
      let current = oldHost;
      const sinks = new Set<(event: import("./protocol.js").GatewayEvent) => void>();
      for (const host of [oldHost, newHost]) {
        host.log.listen((event) => {
          if (current !== host) return;
          for (const sink of [...sinks]) sink(event);
        });
      }
      const heard: string[] = [];
      const snapshots: string[] = [];
      const client = yield* gatewayClient({
        transport: {
          request: (request) => doorOf(doors, current).request(request),
          events: (sink) => {
            sinks.add(sink);
            return () => sinks.delete(sink);
          },
          connected: () => true,
        },
        createId: () => `r-${++ids}`,
        onSnapshot: (snapshot) => {
          if (isRecord(snapshot) && Array.isArray(snapshot.sessions))
            snapshots.push(String(snapshot.sessions[0]));
        },
      });
      client.on(GATEWAY_EVENT.SESSIONS_CHANGED, (event) => heard.push(String(event.payload)));
      for (let i = 0; i < 5; i += 1)
        oldHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, `old-${i + 1}`);
      assert.equal(client.lastSequence(), 5);
      // The Gateway is replaced: a new host numbers from one again. Its first
      // event reads as already seen against the old count, and is lost.
      current = newHost;
      newHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, "new-1");
      assert.deepEqual(heard, ["old-1", "old-2", "old-3", "old-4", "old-5"]);
      // Adopting the host fences that: the cursor moves to the new host's
      // sequence, its snapshot stands in for what was numbered before, and
      // every event after is delivered.
      yield* client.adoptHost();
      assert.equal(client.lastSequence(), 1);
      assert.deepEqual(snapshots, ["new"]);
      newHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, "new-2");
      assert.deepEqual(heard, ["old-1", "old-2", "old-3", "old-4", "old-5", "new-2"]);
      // A late event of the old host reaches no sink: the transport dropped it.
      oldHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, "old-6");
      assert.equal(heard.length, 6);
    }),
);

it.live(
  "a fresh client with no baseline adopts the host as it stands rather than replaying the window before it arrived",
  () =>
    Effect.gen(function* () {
      let ids = 0;
      const host = yield* gatewayInProcessHost({
        methods: {},
        configurationRevision: () => 1,
        sessionRevision: () => undefined,
        snapshot: () => ({ sessions: [] }),
        now: () => 0,
        createEventId: () => `event-${++ids}`,
      });
      // The host spoke before this client existed: a session change for a renderer that is gone.
      host.log.publish(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED, { phase: "closed" });
      host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, "old-sessions");
      const transport = new InProcessTransport(host, OPERATOR);
      const heard: string[] = [];
      let snapshots = 0;
      const client = yield* gatewayClient({
        transport,
        createId: () => `r-${++ids}`,
        onSnapshot: () => {
          snapshots += 1;
        },
      });
      client.onEvery((event) => heard.push(event.kind));
      // The first thing it hears is not the host's first event: no baseline, so
      // the host is adopted, and the old change is never delivered.
      host.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, "current");
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      assert.equal(snapshots, 1);
      assert.deepEqual(heard, []);
      assert.equal(client.lastSequence(), 3);
      // From here the stream is followed, and a later gap is replayed as before.
      host.log.publish(GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED, { phase: "wanted" });
      assert.deepEqual(heard, [GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED]);
    }),
);

it.live(
  "an event of the new host arriving during adoption is held and delivered after it, whatever the old cursor said, and an adoption supersedes a reconnection still out",
  () =>
    Effect.gen(function* () {
      let ids = 0;
      const makeHost = () =>
        gatewayInProcessHost({
          methods: {},
          configurationRevision: () => 1,
          sessionRevision: () => undefined,
          snapshot: () => ({}),
          now: () => 0,
          createEventId: () => `event-${++ids}`,
        });
      const oldHost = yield* makeHost();
      const newHost = yield* makeHost();
      const doors = new Map<GatewayInProcessHost, InProcessTransport>([
        [oldHost, new InProcessTransport(oldHost, OPERATOR)],
        [newHost, new InProcessTransport(newHost, OPERATOR)],
      ]);
      let current = oldHost;
      let wireUp = true;
      const sinks = new Set<(event: import("./protocol.js").GatewayEvent) => void>();
      for (const host of [oldHost, newHost]) {
        host.log.listen((event) => {
          if (current !== host || !wireUp) return;
          for (const sink of [...sinks]) sink(event);
        });
      }
      // Every request is handled at once but its answer travels back only when
      // the test releases it, so an event can be emitted after the hello was
      // captured and before its answer lands.
      const pendingAnswers: Array<() => void> = [];
      const client = yield* gatewayClient({
        transport: {
          request: (request) =>
            Effect.callback<GatewayResponse>((resume) => {
              const answering = Effect.runFork(doorOf(doors, current).request(request));
              pendingAnswers.push(() => resume(Fiber.join(answering)));
            }),
          events: (sink) => {
            sinks.add(sink);
            return () => sinks.delete(sink);
          },
          connected: () => true,
        },
        createId: () => `r-${++ids}`,
      });
      const heard: string[] = [];
      client.on(GATEWAY_EVENT.SESSIONS_CHANGED, (event) => heard.push(String(event.payload)));
      // The old host ran long: the cursor is high.
      for (let i = 0; i < 100; i += 1)
        oldHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, `old-${i + 1}`);
      assert.equal(client.lastSequence(), 100);
      // A dropped event on the old host puts a reconnection out; its answer is delayed.
      wireUp = false;
      oldHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, "old-101-dropped");
      wireUp = true;
      oldHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, "old-102");
      assert.equal(pendingAnswers.length, 1);
      // Before that answers, the host is replaced and adopted. The new host had
      // emitted five events before this client arrived; its sixth lands while
      // the hello's answer is out, numbered far below the old cursor.
      current = newHost;
      for (let i = 0; i < 5; i += 1)
        newHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, `new-${i + 1}`);
      const adoption = Effect.runFork(client.adoptHost());
      assert.equal(pendingAnswers.length, 2);
      // The host handles the hello (capturing sequence 5) before the sixth event
      // is emitted; only the answer is still on its way.
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      newHost.log.publish(GATEWAY_EVENT.SESSIONS_CHANGED, "new-6");
      // The old reconnection answers first and installs nothing; then the hello lands.
      pendingAnswers[0]?.();
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      pendingAnswers[1]?.();
      yield* Fiber.join(adoption);
      // The hello was captured at sequence 5; the sixth was held rather than
      // dropped against the old cursor of 100, and is delivered after the
      // adoption; nothing of the old host's replay landed.
      assert.equal(client.lastSequence(), 6);
      assert.equal(heard.includes("old-101-dropped"), false);
      assert.equal(heard.includes("old-102"), false);
    }),
);
