import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_METHOD,
  gatewayClient,
  NODE_CAPABILITY_STATUS,
  shutdownGatewayEffect,
} from "@sidecar/gateway";
import {
  bearerAuthentication,
  connectWebSocketGateway,
  GatewaySocketBinding,
  layerGatewaySocket,
  WEB_SOCKET_GATEWAY_DEFAULTS,
} from "@sidecar/gateway/websocket";
import { Context, Effect, Layer, type Scope } from "effect";
import { test } from "vitest";
import { HOST_NATIVE_NODE_ID, HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { createGatewayService, type GatewayService } from "./service.js";

/**
 * The ownership the client and host boundary claims, exercised over a real
 * socket: the host's native asks answer typed unavailable while no client
 * stands, and the explicit shutdown ends at its deadline with what did not
 * settle counted.
 */
const NOW = 1_800_000_000_000;
const TOKEN = "a-shared-secret";

function fakeHost() {
  return Effect.gen(function* () {
    let ids = 0;
    const service = yield* createGatewayService({
      now: () => NOW,
      createId: () => `id-${++ids}`,
    });
    return { service };
  });
}

/** One host's own methods on a real socket, bound for as long as the test's scope stands. */
interface Listening {
  readonly port: number;
}

/**
 * The host's own methods on a real socket. The binding provides the
 * `Protocol` a server is built over rather than attaching to one already
 * built, so it composes a server of its own over the service's own options:
 * the same methods, the same readers, and the same node registry the service
 * holds.
 */
const listen = (service: GatewayService): Effect.Effect<Listening, never, Scope.Scope> =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      layerGatewaySocket({
        ...service.layerOptions,
        authenticate: bearerAuthentication(TOKEN),
      }),
    ).pipe(Effect.orDie);
    const binding = Context.get(context, GatewaySocketBinding);
    return { port: binding.port };
  });

function client(port: number, clientId: string) {
  return Effect.gen(function* () {
    const connected = yield* connectWebSocketGateway({
      url: `ws://${WEB_SOCKET_GATEWAY_DEFAULTS.HOST}:${port}/`,
      headers: { [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}` },
      client: { clientId, role: GATEWAY_CLIENT_ROLE.OPERATOR },
    });
    assert.ok(connected.ok);
    let ids = 0;
    const gateway = yield* gatewayClient({
      transport: connected.connection,
      createId: () => `${clientId}-${++ids}`,
    });
    return { connection: connected.connection, gateway };
  });
}

it.live("while no client stands, a native capability the host needs answers unavailable", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = yield* fakeHost();
      const { port } = yield* listen(f.service);
      const desktop = yield* client(port, "desktop");
      yield* desktop.connection.serveInvocations?.(() =>
        Effect.succeed({ status: NODE_CAPABILITY_STATUS.OK, value: undefined }),
      ) ?? Effect.void;
      assert.ok(
        (yield* desktop.gateway.call(GATEWAY_METHOD.NODE_REGISTER, {
          nodeId: HOST_NATIVE_NODE_ID,
          capabilities: [HOST_NODE_CAPABILITY.OPEN_EXTERNAL],
        })).ok,
      );
      const served = yield* f.service.nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, {
        url: "https://a",
      });
      assert.equal(served.status, NODE_CAPABILITY_STATUS.OK);
      yield* desktop.connection.close();
      yield* Effect.sleep("20 millis");
      const absent = yield* f.service.nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, {
        url: "https://b",
      });
      assert.equal(absent.status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    }),
  ),
);

test("a shutdown whose cancellation hangs still ends at the deadline with what did not settle counted", async () => {
  const report = await Effect.runPromise(
    shutdownGatewayEffect(
      {
        closeAdmissions: Effect.void,
        cancelActive: Effect.never,
        awaitSettled: Effect.void,
        persistUnresolved: Effect.succeed(2),
      },
      { deadlineMs: 20 },
    ),
  );
  assert.equal(report.settled, false);
  assert.deepEqual(report.cancelled, []);
  assert.equal(report.unresolved, 2);
});
