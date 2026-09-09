import assert from "node:assert/strict";
import test from "node:test";
import {
  Emitter,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { WebSocket } from "ws";
import { GatewayClient } from "./client.js";
import { InvocationMemory, NODE_INVOCATION_REFUSAL } from "./invocations.js";
import { NodeRegistry } from "./nodes.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayClientIdentity,
  type GatewayEvent,
  NODE_CAPABILITY_STATUS,
  type NodeInvocation,
  nodeInvocationAnswerToWire,
  nodeInvocationFromWire,
} from "./protocol.js";
import { type GatewayMethodTable, GatewayServer, gatewayError, gatewayOk } from "./server.js";
import { TextLoopbackTransport } from "./testing.js";
import { InProcessTransport } from "./transport.js";
import {
  bearerAuthentication,
  connectWebSocketGateway,
  GATEWAY_FRAME,
  WEB_SOCKET_GATEWAY_DEFAULTS,
  WebSocketTransport,
} from "./websocket.js";

const TOKEN = "a-shared-secret";
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
function hostWithNodes() {
  const nodes = new NodeRegistry();
  const owners = new Map<string, string>();
  let ids = 0;
  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.NODE_REGISTER]: (params, context) => {
      const connection = context.connection;
      if (!connection || !isWireString(params.nodeId)) {
        return gatewayError(GATEWAY_ERROR.REFUSED, "no connection");
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
      return gatewayOk({ nodeId });
    },
  };
  const server = new GatewayServer({
    methods,
    configurationRevision: () => 1,
    sessionRevision: () => undefined,
    snapshot: () => ({}),
    now: () => 0,
    createEventId: () => `event-${++ids}`,
  });
  return { server, nodes };
}

async function socketHost() {
  const { server, nodes } = hostWithNodes();
  const host = new WebSocketTransport({ server, authenticate: bearerAuthentication(TOKEN) });
  const port = await host.bind();
  return { server, nodes, host, port, close: () => host.close() };
}

function socketUrl(port: number): string {
  return `ws://${WEB_SOCKET_GATEWAY_DEFAULTS.HOST}:${port}/`;
}

/** A raw socket admitted as a node, so a test can send frames the client never would. */
function rawSocket(port: number, clientId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl(port), {
      headers: {
        [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}`,
        [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: clientId,
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: GATEWAY_CLIENT_ROLE.OPERATOR,
      },
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function frames(socket: WebSocket): WireRecord[] {
  const seen: WireRecord[] = [];
  socket.on("message", (data) => {
    // SAFETY: the host sends JSON text frames; parsing yields a wire value the readers check.
    const value = JSON.parse(data.toString()) as UnparsedWireValue;
    if (isRecord(value)) seen.push(value);
  });
  return seen;
}

function sendRequest(socket: WebSocket, id: string, method: string, params: WireRecord): void {
  socket.send(
    JSON.stringify({
      kind: GATEWAY_FRAME.REQUEST,
      envelope: {
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        id,
        method,
        params,
        idempotencyKey: id,
      },
    }),
  );
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(label);
}

test("the node's memory performs a distinct invocation once and answers a duplicate from the first performance", async () => {
  let performed = 0;
  let release: (() => void) | undefined;
  const memory = new InvocationMemory(async (invocation) => {
    performed += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { status: NODE_CAPABILITY_STATUS.OK, value: invocation.params.url };
  });
  const invocation: NodeInvocation = {
    invocationId: "i-1",
    nodeId: NODE_ID,
    capability: CAPABILITY,
    params: { url: "https://example.test" },
  };
  const first = memory.take(invocation);
  const duplicateWhilePending = memory.take(invocation);
  assert.equal(performed, 1);
  release?.();
  const [a, b] = await Promise.all([first, duplicateWhilePending]);
  assert.deepEqual(a, b);
  const duplicateAfterSettling = await memory.take(invocation);
  assert.deepEqual(duplicateAfterSettling, a);
  assert.equal(performed, 1);
});

for (const kind of ["in-process", "loopback"] as const) {
  test(`[${kind}] a node registered over a connection is invoked through it, and a repeated frame performs once`, async () => {
    const { server, nodes } = hostWithNodes();
    const transport =
      kind === "in-process"
        ? new InProcessTransport(server, OPERATOR)
        : new TextLoopbackTransport(server, OPERATOR);
    const opened: string[] = [];
    transport.serveInvocations?.(async (invocation) => {
      opened.push(String(invocation.params.url));
      return { status: NODE_CAPABILITY_STATUS.OK, value: undefined };
    });
    const client = new GatewayClient({
      transport,
      createId: () => `r-${opened.length}-${Math.random()}`,
    });
    const registered = await client.call(GATEWAY_METHOD.NODE_REGISTER, {
      nodeId: NODE_ID,
      capabilities: [CAPABILITY],
    });
    assert.ok(registered.ok);
    if (transport instanceof TextLoopbackTransport) transport.repeatNextInvocation(2);
    const result = await nodes.invoke(CAPABILITY, { url: "https://one.test" });
    assert.equal(result.status, NODE_CAPABILITY_STATUS.OK);
    assert.deepEqual(opened, ["https://one.test"]);
    // The connection closing disconnects the node: the next ask is never
    // dispatched and says so, distinctly from an ask whose answer was lost.
    transport.close();
    const afterClose = await nodes.invoke(CAPABILITY, { url: "https://two.test" });
    assert.equal(afterClose.status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    assert.deepEqual(opened, ["https://one.test"]);
  });
}

test("over the socket: an ask dispatched to a node whose connection closes answers unknown, one made after answers unavailable, and a new connection is never replayed the old ask", async () => {
  const hosted = await socketHost();
  try {
    const first = await rawSocket(hosted.port, "desktop");
    const seenByFirst = frames(first);
    sendRequest(first, "reg-1", GATEWAY_METHOD.NODE_REGISTER, {
      nodeId: NODE_ID,
      capabilities: [CAPABILITY],
    });
    await until(
      () => seenByFirst.some((frame) => frame.kind === GATEWAY_FRAME.RESPONSE),
      "the registration answered",
    );
    // The host asks; the node has performed the effect and dies before answering.
    const pending = hosted.nodes.invoke(CAPABILITY, { url: "https://effect.test" });
    await until(
      () => seenByFirst.some((frame) => frame.kind === GATEWAY_FRAME.INVOCATION),
      "the invocation reached the node",
    );
    const dispatched = seenByFirst.find((frame) => frame.kind === GATEWAY_FRAME.INVOCATION);
    assert.ok(dispatched && isRecord(dispatched.envelope));
    const invocation = nodeInvocationFromWire(dispatched.envelope);
    assert.ok(invocation);
    first.terminate();
    const lost = await pending;
    assert.equal(lost.status, NODE_CAPABILITY_STATUS.UNKNOWN);
    if (lost.status === NODE_CAPABILITY_STATUS.UNKNOWN) {
      assert.equal(lost.reason, NODE_INVOCATION_REFUSAL.ANSWER_LOST);
    }
    // Nothing connected offers the capability now: never dispatched.
    const undispatched = await hosted.nodes.invoke(CAPABILITY, { url: "https://later.test" });
    assert.equal(undispatched.status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    // A relaunched client registers again and hears no frame for the lost ask;
    // its reconnect replay carries no invocation either, because none is an event.
    const second = await rawSocket(hosted.port, "desktop");
    const seenBySecond = frames(second);
    sendRequest(second, "reg-2", GATEWAY_METHOD.NODE_REGISTER, {
      nodeId: NODE_ID,
      capabilities: [CAPABILITY],
    });
    sendRequest(second, "rc-1", GATEWAY_METHOD.RECONNECT, { lastSequence: 0 });
    await until(
      () => seenBySecond.filter((frame) => frame.kind === GATEWAY_FRAME.RESPONSE).length === 2,
      "the second client's registration and reconnection answered",
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(seenBySecond.filter((frame) => frame.kind === GATEWAY_FRAME.INVOCATION).length, 0);
    const replay = seenBySecond.find(
      (frame) =>
        frame.kind === GATEWAY_FRAME.RESPONSE &&
        isRecord(frame.envelope) &&
        frame.envelope.id === "rc-1",
    );
    assert.ok(replay && isRecord(replay.envelope) && isRecord(replay.envelope.result));
    assert.deepEqual(replay.envelope.result.events, []);
    // A late answer for the lost ask, from the new connection, lands nowhere.
    second.send(
      JSON.stringify({
        kind: GATEWAY_FRAME.ANSWER,
        envelope: nodeInvocationAnswerToWire({
          invocationId: invocation.invocationId,
          result: { status: NODE_CAPABILITY_STATUS.OK, value: "too late" },
        }),
      }),
    );
    // And a fresh ask is dispatched to the new connection alone, once.
    const fresh = hosted.nodes.invoke(CAPABILITY, { url: "https://fresh.test" });
    await until(
      () => seenBySecond.some((frame) => frame.kind === GATEWAY_FRAME.INVOCATION),
      "the fresh invocation reached the second client",
    );
    const freshFrame = seenBySecond.find((frame) => frame.kind === GATEWAY_FRAME.INVOCATION);
    assert.ok(freshFrame && isRecord(freshFrame.envelope));
    const freshInvocation = nodeInvocationFromWire(freshFrame.envelope);
    assert.ok(freshInvocation && freshInvocation.invocationId !== invocation.invocationId);
    second.send(
      JSON.stringify({
        kind: GATEWAY_FRAME.ANSWER,
        envelope: nodeInvocationAnswerToWire({
          invocationId: freshInvocation.invocationId,
          result: { status: NODE_CAPABILITY_STATUS.OK, value: "opened" },
        }),
      }),
    );
    const answered = await fresh;
    assert.deepEqual(answered, { status: NODE_CAPABILITY_STATUS.OK, value: "opened" });
    second.terminate();
  } finally {
    await hosted.close();
  }
});

test("over the socket: another connection's answer to a node's ask is ignored; only the node's own connection settles it", async () => {
  const hosted = await socketHost();
  try {
    const node = await rawSocket(hosted.port, "desktop");
    const other = await rawSocket(hosted.port, "intruder");
    const seenByNode = frames(node);
    frames(other);
    sendRequest(node, "reg", GATEWAY_METHOD.NODE_REGISTER, {
      nodeId: NODE_ID,
      capabilities: [CAPABILITY],
    });
    await until(
      () => seenByNode.some((frame) => frame.kind === GATEWAY_FRAME.RESPONSE),
      "registered",
    );
    const pending = hosted.nodes.invoke(CAPABILITY, { url: "https://guarded.test" });
    await until(
      () => seenByNode.some((frame) => frame.kind === GATEWAY_FRAME.INVOCATION),
      "dispatched",
    );
    const frame = seenByNode.find((held) => held.kind === GATEWAY_FRAME.INVOCATION);
    assert.ok(frame && isRecord(frame.envelope));
    const invocation = nodeInvocationFromWire(frame.envelope);
    assert.ok(invocation);
    other.send(
      JSON.stringify({
        kind: GATEWAY_FRAME.ANSWER,
        envelope: nodeInvocationAnswerToWire({
          invocationId: invocation.invocationId,
          result: { status: NODE_CAPABILITY_STATUS.OK, value: "forged" },
        }),
      }),
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(settled, false);
    node.send(
      JSON.stringify({
        kind: GATEWAY_FRAME.ANSWER,
        envelope: nodeInvocationAnswerToWire({
          invocationId: invocation.invocationId,
          result: { status: NODE_CAPABILITY_STATUS.OK, value: "genuine" },
        }),
      }),
    );
    assert.deepEqual(await pending, { status: NODE_CAPABILITY_STATUS.OK, value: "genuine" });
    node.terminate();
    other.terminate();
  } finally {
    await hosted.close();
  }
});

test("a client that adopts a replaced host follows the new host's numbering from its snapshot rather than dropping its events", async () => {
  let ids = 0;
  const makeServer = (run: string) =>
    new GatewayServer({
      methods: {},
      configurationRevision: () => 1,
      sessionRevision: () => undefined,
      snapshot: () => ({ runs: [run] }),
      now: () => 0,
      createEventId: () => `event-${++ids}`,
    });
  // The client's one transport: requests go to the connection that now
  // stands, and every sink hears the events of that connection alone.
  const oldServer = makeServer("old");
  const newServer = makeServer("new");
  let current = oldServer;
  const events = new Emitter<GatewayEvent>();
  for (const server of [oldServer, newServer]) {
    server.subscribe((event) => {
      if (current !== server) return;
      events.fire(event);
    });
  }
  const client = new GatewayClient({
    transport: {
      request: (request) => current.handle(request, OPERATOR),
      events: events.event,
      connected: () => true,
    },
    createId: () => `r-${++ids}`,
    onSnapshot: (snapshot) => {
      if (isRecord(snapshot) && Array.isArray(snapshot.runs))
        snapshots.push(String(snapshot.runs[0]));
    },
  });
  const heard: string[] = [];
  const snapshots: string[] = [];
  client.on(GATEWAY_EVENT.RUNS_CHANGED, (event) => heard.push(String(event.payload)));
  for (let i = 0; i < 5; i += 1) oldServer.emit(GATEWAY_EVENT.RUNS_CHANGED, `old-${i + 1}`);
  assert.equal(client.lastSequence(), 5);
  // The Gateway is replaced: a new host numbers from one again. Its first
  // event reads as already seen against the old count, and is lost.
  current = newServer;
  newServer.emit(GATEWAY_EVENT.RUNS_CHANGED, "new-1");
  assert.deepEqual(heard, ["old-1", "old-2", "old-3", "old-4", "old-5"]);
  // Adopting the host fences that: the cursor moves to the new host's
  // sequence, its snapshot stands in for what was numbered before, and
  // every event after is delivered.
  await client.adoptHost();
  assert.equal(client.lastSequence(), 1);
  assert.deepEqual(snapshots, ["new"]);
  newServer.emit(GATEWAY_EVENT.RUNS_CHANGED, "new-2");
  assert.deepEqual(heard, ["old-1", "old-2", "old-3", "old-4", "old-5", "new-2"]);
  // A late event of the old host reaches no sink: the transport dropped it.
  oldServer.emit(GATEWAY_EVENT.RUNS_CHANGED, "old-6");
  assert.equal(heard.length, 6);
});

test("the socket client serves invocations only while a handler is served, answering unavailable otherwise", async () => {
  const hosted = await socketHost();
  try {
    const connected = await connectWebSocketGateway({
      url: socketUrl(hosted.port),
      headers: { [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}` },
      client: OPERATOR,
    });
    assert.ok(connected.ok);
    const client = new GatewayClient({
      transport: connected.connection,
      createId: () => `c-${Math.random()}`,
    });
    assert.ok(
      (
        await client.call(GATEWAY_METHOD.NODE_REGISTER, {
          nodeId: NODE_ID,
          capabilities: [CAPABILITY],
        })
      ).ok,
    );
    const unserved = await hosted.nodes.invoke(CAPABILITY, { url: "https://none.test" });
    assert.equal(unserved.status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    if (unserved.status === NODE_CAPABILITY_STATUS.UNAVAILABLE) {
      assert.equal(unserved.reason, NODE_INVOCATION_REFUSAL.NOT_SERVING);
    }
    const opened: string[] = [];
    connected.connection.serveInvocations?.((invocation) => {
      opened.push(String(invocation.params.url));
      return Promise.resolve({ status: NODE_CAPABILITY_STATUS.OK, value: undefined });
    });
    const served = await hosted.nodes.invoke(CAPABILITY, { url: "https://served.test" });
    assert.equal(served.status, NODE_CAPABILITY_STATUS.OK);
    assert.deepEqual(opened, ["https://served.test"]);
    connected.connection.close();
  } finally {
    await hosted.close();
  }
});

test("a fresh client with no baseline adopts the host as it stands rather than replaying the window before it arrived", async () => {
  let ids = 0;
  const server = new GatewayServer({
    methods: {},
    configurationRevision: () => 1,
    sessionRevision: () => undefined,
    snapshot: () => ({ runs: [] }),
    now: () => 0,
    createEventId: () => `event-${++ids}`,
  });
  // The host spoke before this client existed: an offer to a renderer that is gone.
  server.emit(GATEWAY_EVENT.SPEECH_OFFERED, { id: "old-offer" });
  server.emit(GATEWAY_EVENT.RUNS_CHANGED, "old-runs");
  const transport = new InProcessTransport(server, OPERATOR);
  const heard: string[] = [];
  let snapshots = 0;
  const client = new GatewayClient({
    transport,
    createId: () => `r-${++ids}`,
    onSnapshot: () => {
      snapshots += 1;
    },
  });
  client.onEvery((event) => heard.push(event.kind));
  // The first thing it hears is not the host's first event: no baseline, so
  // the host is adopted, and the old offer is never delivered.
  server.emit(GATEWAY_EVENT.RUNS_CHANGED, "current");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(snapshots, 1);
  assert.deepEqual(heard, []);
  assert.equal(client.lastSequence(), 3);
  // From here the stream is followed, and a later gap is replayed as before.
  server.emit(GATEWAY_EVENT.SPEECH_OFFERED, { id: "new-offer" });
  assert.deepEqual(heard, [GATEWAY_EVENT.SPEECH_OFFERED]);
});

test("an event of the new host arriving during adoption is held and delivered after it, whatever the old cursor said, and an adoption supersedes a reconnection still out", async () => {
  let ids = 0;
  const makeServer = () =>
    new GatewayServer({
      methods: {},
      configurationRevision: () => 1,
      sessionRevision: () => undefined,
      snapshot: () => ({}),
      now: () => 0,
      createEventId: () => `event-${++ids}`,
    });
  const oldServer = makeServer();
  const newServer = makeServer();
  let current = oldServer;
  let wireUp = true;
  const events = new Emitter<GatewayEvent>();
  for (const server of [oldServer, newServer]) {
    server.subscribe((event) => {
      if (current !== server || !wireUp) return;
      events.fire(event);
    });
  }
  // Every request is handled at once but its answer travels back only when
  // the test releases it, so an event can be emitted after the hello was
  // captured and before its answer lands.
  const pendingAnswers: Array<() => void> = [];
  const client = new GatewayClient({
    transport: {
      request: async (request) => {
        const answered = current.handle(request, OPERATOR);
        await new Promise<void>((resolve) => pendingAnswers.push(resolve));
        return answered;
      },
      events: events.event,
      connected: () => true,
    },
    createId: () => `r-${++ids}`,
  });
  const heard: string[] = [];
  client.on(GATEWAY_EVENT.RUNS_CHANGED, (event) => heard.push(String(event.payload)));
  // The old host ran long: the cursor is high.
  for (let i = 0; i < 100; i += 1) oldServer.emit(GATEWAY_EVENT.RUNS_CHANGED, `old-${i + 1}`);
  assert.equal(client.lastSequence(), 100);
  // A dropped event on the old host puts a reconnection out; its answer is delayed.
  wireUp = false;
  oldServer.emit(GATEWAY_EVENT.RUNS_CHANGED, "old-101-dropped");
  wireUp = true;
  oldServer.emit(GATEWAY_EVENT.RUNS_CHANGED, "old-102");
  assert.equal(pendingAnswers.length, 1);
  // Before that answers, the host is replaced and adopted. The new host had
  // emitted five events before this client arrived; its sixth lands while
  // the hello's answer is out, numbered far below the old cursor.
  current = newServer;
  for (let i = 0; i < 5; i += 1) newServer.emit(GATEWAY_EVENT.RUNS_CHANGED, `new-${i + 1}`);
  const adoption = client.adoptHost();
  assert.equal(pendingAnswers.length, 2);
  // The host handles the hello (capturing sequence 5) before the sixth event
  // is emitted; only the answer is still on its way.
  await new Promise((resolve) => setTimeout(resolve, 0));
  newServer.emit(GATEWAY_EVENT.RUNS_CHANGED, "new-6");
  assert.deepEqual(
    heard.filter((h) => h.startsWith("new")),
    [],
  );
  // The old reconnection answers first and installs nothing; then the hello lands.
  pendingAnswers[0]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  pendingAnswers[1]?.();
  await adoption;
  // The hello was captured at sequence 5; the sixth was held rather than
  // dropped against the old cursor of 100, and is delivered after the
  // adoption; nothing of the old host's replay landed.
  assert.equal(client.lastSequence(), 6);
  assert.deepEqual(
    heard.filter((h) => h.startsWith("new")),
    ["new-6"],
  );
  assert.equal(heard.includes("old-101-dropped"), false);
  assert.equal(heard.includes("old-102"), false);
});
