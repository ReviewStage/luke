import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { accountBearer } from "@repo/features";
import { PORT_FORWARD_STATE } from "@repo/features/port-forward-acts";
import { TUNNEL_CLOSE, TUNNEL_FRAME } from "@repo/features/sandbox-tunnel-wire";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@repo/gateway";
import type { WireRecord } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { type Cause, Deferred, Effect, Fiber, Queue, Stream } from "effect";
import { Base64 } from "effect/encoding";
import { TestClock } from "effect/testing";
import {
  composePortForwards,
  type LoopbackConnection,
  PORT_FORWARD,
} from "./compose-port-forwards.js";
import type { TerminalSocketArrival, TerminalSocketFrame } from "./compose-terminals.js";

/**
 * A coding agent's cloud ports forwarded to the Mac's loopback, over a
 * service whose port reads answer from a script, a loopback whose taken
 * ports the test names, and a relay whose sockets the test drives, on the
 * test clock: a port taken locally is listened on at the next free one; the
 * forwarded ports follow each read, for one agent at a time; and each
 * accepted connection is a channel on its port's tunnel, a closed tunnel
 * opened again by the next connection. Synthetic ids and bytes throughout.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER_AGENT_ID = "1d2f3a4b-5c6d-4c6b-9e0a-8b3c7a1e2f4d";
const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Lets every fiber the last step woke run to its next wait. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
  discard: true,
});

/** One accepted connection as a test drives it: what its far side sends pushed in, and what was written to it and whether it closed, kept. */
const scriptedConnection = Effect.gen(function* () {
  const inbound = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const written: string[] = [];
  const state = { closed: false };
  const connection: LoopbackConnection = {
    received: Stream.fromQueue(inbound),
    write: (bytes) => Effect.sync(() => void written.push(decode(bytes))),
    close: Effect.andThen(
      Effect.sync(() => {
        state.closed = true;
      }),
      Queue.end(inbound),
    ),
  };
  return { connection, send: (text: string) => Queue.offer(inbound, encode(text)), written, state };
});

/** The composer over the scripted service, loopback, and relay. */
function subject(options: { taken?: number[]; started?: Effect.Effect<void> } = {}) {
  return Effect.gen(function* () {
    const ports = new Map<string, number[]>([[AGENT_ID, []]]);
    const taken = new Set(options.taken);
    /** Each listener standing, by the local port it holds: what it accepts. */
    const listeners = new Map<number, Queue.Queue<LoopbackConnection, Cause.Done>>();
    /** Each relay socket opened, in order: its address, what the host sent on it, and its arrivals. */
    const tunnels: {
      url: string;
      sent: TerminalSocketFrame[];
      inbound: Queue.Queue<TerminalSocketArrival, Cause.Done>;
    }[] = [];
    /** What the concern last told the windows of how forwarding stands. */
    const told: { last?: unknown } = {};
    const composer = yield* composePortForwards({
      kernel: {
        runMode: { sendsNetwork: true },
        hostedServiceBaseUrl: "https://tryapp.test",
        emit: (_kind, payload) => {
          told.last = payload;
        },
      },
      account: {
        capabilitiesActive: () => true,
        credential: accountBearer({
          readAccessToken: () => Effect.succeed("bearer-1"),
          refreshAccount: () => Effect.void,
          readAccountKey: () => Effect.succeed("developer@app.test"),
        }),
      },
      client: {
        list: (agentId) => Effect.sync(() => ({ running: true, ports: ports.get(agentId) ?? [] })),
        startForwarding: () => Effect.as(options.started ?? Effect.void, { started: false }),
      },
      openSocket: (url) =>
        Effect.gen(function* () {
          const inbound = yield* Queue.unbounded<TerminalSocketArrival, Cause.Done>();
          const sent: TerminalSocketFrame[] = [];
          tunnels.push({ url, sent, inbound });
          return {
            socket: {
              arrivals: Stream.fromQueue(inbound),
              send: (frame) => Effect.sync(() => void sent.push(frame)),
              pause: Effect.void,
              resume: Effect.void,
            },
          };
        }),
      listen: (port) =>
        Effect.gen(function* () {
          if (taken.has(port) || listeners.has(port)) return undefined;
          const accepted = yield* Queue.unbounded<LoopbackConnection, Cause.Done>();
          listeners.set(port, accepted);
          yield* Effect.addFinalizer(() => Effect.sync(() => void listeners.delete(port)));
          return Stream.fromQueue(accepted);
        }),
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return {
      call,
      /** How forwarding stands, as the windows were last told. */
      told: () => told.last,
      composer,
      listeners,
      tunnels,
      /** The ports the service reads in an agent's sandbox from now on. */
      serve: (agentId: string, listening: number[]) => void ports.set(agentId, listening),
      /** A connection made to a local port, as a browser on the Mac would. */
      connect: (localPort: number, connection: LoopbackConnection) => {
        const listener = listeners.get(localPort);
        assert.ok(listener, `nothing listens on ${localPort}`);
        return Queue.offer(listener, connection);
      },
    };
  });
}

/** A channel frame as the relay reads it, its bytes as text. */
function readFrame(frame: TerminalSocketFrame) {
  assert.ok("text" in frame);
  const read = JSON.parse(frame.text);
  return read.type === TUNNEL_FRAME.DATA
    ? { ...read, data: Buffer.from(read.data, "base64").toString() }
    : read;
}

it.effect("a port taken on this Mac is listened on at the next free one", () =>
  Effect.gen(function* () {
    const { call, serve, told } = yield* subject({ taken: [3000] });
    serve(AGENT_ID, [3000, 5173]);

    yield* call(GATEWAY_METHOD.PORT_FORWARDS_SET, { agentId: AGENT_ID, on: true });
    yield* settle;

    assert.deepEqual(told(), {
      agentId: AGENT_ID,
      on: true,
      running: true,
      ports: [
        { port: 3000, localPort: 3001, state: PORT_FORWARD_STATE.LISTENING },
        { port: 5173, localPort: 5173, state: PORT_FORWARD_STATE.LISTENING },
      ],
    });
  }),
);

it.effect("turning forwarding off while it is starting leaves it off", () =>
  Effect.gen(function* () {
    const starting = yield* Deferred.make<void>();
    const { call, serve, listeners, told } = yield* subject({ started: Deferred.await(starting) });
    serve(AGENT_ID, [3000]);

    const on = yield* Effect.forkChild(
      call(GATEWAY_METHOD.PORT_FORWARDS_SET, { agentId: AGENT_ID, on: true }),
    );
    yield* settle;
    yield* call(GATEWAY_METHOD.PORT_FORWARDS_SET, { agentId: AGENT_ID, on: false });
    yield* Deferred.succeed(starting, undefined);
    yield* Fiber.join(on);
    yield* settle;

    assert.deepEqual([...listeners.keys()], []);
    assert.equal(told(), undefined);
  }),
);

it.effect("the forwarded ports follow each read, for one agent at a time", () =>
  Effect.gen(function* () {
    const { call, serve, listeners, told } = yield* subject();
    serve(AGENT_ID, [3000, 5173]);
    serve(OTHER_AGENT_ID, [8080]);

    yield* call(GATEWAY_METHOD.PORT_FORWARDS_SET, { agentId: AGENT_ID, on: true });
    yield* settle;
    assert.deepEqual([...listeners.keys()].sort(), [3000, 5173]);

    // The server on 3000 stopped and one on 4000 started: the next read lets one go and listens on the other.
    serve(AGENT_ID, [4000, 5173]);
    yield* TestClock.adjust(PORT_FORWARD.LOOK_EVERY);
    yield* settle;
    assert.deepEqual([...listeners.keys()].sort(), [4000, 5173]);

    // Forwarding another agent lets every port of the first go.
    const other = yield* call(GATEWAY_METHOD.PORT_FORWARDS_SET, {
      agentId: OTHER_AGENT_ID,
      on: true,
    });
    yield* settle;
    assert.deepEqual([...listeners.keys()], [8080]);
    assert.deepEqual(told(), {
      agentId: OTHER_AGENT_ID,
      on: true,
      running: true,
      ports: [{ port: 8080, localPort: 8080, state: PORT_FORWARD_STATE.LISTENING }],
    });
    assert.deepEqual(other, { on: true, running: false, ports: [] });

    yield* call(GATEWAY_METHOD.PORT_FORWARDS_SET, { agentId: OTHER_AGENT_ID, on: false });
    assert.deepEqual([...listeners.keys()], []);
    assert.equal(told(), null);
  }),
);

it.effect(
  "each connection is a channel on its port's tunnel, and a closed tunnel opens again on the next connection",
  () =>
    Effect.gen(function* () {
      const { call, serve, connect, tunnels, told } = yield* subject();
      serve(AGENT_ID, [3000]);
      yield* call(GATEWAY_METHOD.PORT_FORWARDS_SET, { agentId: AGENT_ID, on: true });
      yield* settle;

      const browser = yield* scriptedConnection;
      yield* connect(3000, browser.connection);
      yield* settle;
      yield* browser.send("GET / HTTP/1.1");
      yield* settle;
      const [tunnel] = tunnels;
      assert.ok(tunnel);
      const address = new URL(tunnel.url);
      assert.equal(address.searchParams.get("kind"), "port-forward");
      assert.equal(address.searchParams.get("port"), "3000");
      assert.deepEqual(tunnel.sent.map(readFrame), [
        { type: TUNNEL_FRAME.OPEN, channel: 0 },
        { type: TUNNEL_FRAME.DATA, channel: 0, data: "GET / HTTP/1.1" },
      ]);
      const [forwarded] = (told() as { ports: unknown[] }).ports;
      assert.deepEqual(forwarded, {
        port: 3000,
        localPort: 3000,
        state: PORT_FORWARD_STATE.CONNECTED,
      });

      const answer = Base64.encode(encode("HTTP/1.1 200 OK"));
      yield* Queue.offer(tunnel.inbound, {
        text: JSON.stringify({ type: TUNNEL_FRAME.DATA, channel: 0, data: answer }),
      });
      yield* settle;
      assert.deepEqual(browser.written, ["HTTP/1.1 200 OK"]);

      // The relay closed as idle: the connection it carried closes, and the listener stays for the next.
      yield* Queue.offer(tunnel.inbound, { close: TUNNEL_CLOSE.IDLE });
      yield* Queue.end(tunnel.inbound);
      yield* settle;
      assert.equal(browser.state.closed, true);

      const again = yield* scriptedConnection;
      yield* connect(3000, again.connection);
      yield* settle;
      assert.equal(tunnels.length, 2);
      assert.deepEqual(tunnels[1]?.sent.map(readFrame), [{ type: TUNNEL_FRAME.OPEN, channel: 0 }]);
    }),
);
