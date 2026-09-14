import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_METHOD,
  gatewayClient,
  InProcessTransport,
  NODE_CAPABILITY_STATUS,
} from "@sidecar/gateway";
import { TextLoopbackTransport } from "@sidecar/gateway/testing";
import { isRecord, type WireRecord, type WireValue } from "@sidecar/wire";
import { Effect } from "effect";
import { HOST_NATIVE_NODE_ID } from "./node-capabilities.js";
import { createGatewayService } from "./service.js";

const NOW = 1_800_000_000_000;

/** A wire value the test expects to be a record; anything else fails the test where it stands. */
function recordOf(value: WireValue | undefined): WireRecord {
  assert.ok(isRecord(value));
  return value;
}

/** The service over its own node registry, and one operator client on the transport under test. */
function fixture(transportKind: "in-process" | "loopback" = "in-process") {
  return Effect.gen(function* () {
    let ids = 0;
    const service = yield* createGatewayService({
      now: () => NOW,
      createId: () => `id-${++ids}`,
    });
    const identity = { clientId: "operator", role: GATEWAY_CLIENT_ROLE.OPERATOR };
    const transport =
      transportKind === "in-process"
        ? new InProcessTransport(service.gateway, identity)
        : new TextLoopbackTransport(service.gateway, identity);
    const client = yield* gatewayClient({ transport, createId: () => `request-${++ids}` });
    return { service, client };
  });
}

for (const kind of ["in-process", "loopback"] as const) {
  it.effect(
    `[${kind}] a node the host needs that is not connected answers unavailable through the protocol`,
    () =>
      Effect.gen(function* () {
        const f = yield* fixture(kind);
        const missing = yield* f.client.call(GATEWAY_METHOD.NODE_INVOKE, {
          capability: "os.openExternal",
          params: { url: "https://example.test" },
        });
        assert.ok(missing.ok);
        assert.equal(recordOf(missing.result).status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
        const opened: string[] = [];
        f.service.nodes.register({
          nodeId: HOST_NATIVE_NODE_ID,
          capabilities: {
            "os.openExternal": (params) => {
              opened.push(String(params.url));
              return undefined;
            },
          },
        });
        const ok = yield* f.client.call(GATEWAY_METHOD.NODE_INVOKE, {
          capability: "os.openExternal",
          params: { url: "https://example.test" },
        });
        assert.ok(ok.ok && recordOf(ok.result).status === NODE_CAPABILITY_STATUS.OK);
        assert.deepEqual(opened, ["https://example.test"]);
        // A registration over the wire binds the node to the connection it came
        // on: an ask of it is dispatched there and nowhere else, and a connection
        // that serves no handler answers unavailable, the ask never dispatched.
        const remote = yield* f.client.call(GATEWAY_METHOD.NODE_REGISTER, {
          nodeId: "phone",
          capabilities: ["mic"],
        });
        assert.ok(remote.ok);
        const unserved = yield* f.client.call(GATEWAY_METHOD.NODE_INVOKE, {
          capability: "mic",
          params: {},
        });
        assert.ok(unserved.ok);
        assert.equal(recordOf(unserved.result).status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
        assert.ok(f.service.nodes.list().some((node) => node.nodeId === "phone" && node.connected));
      }),
  );

  it.effect(`[${kind}] a hello's snapshot carries the nodes as they stand and nothing else`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(kind);
      const hello = yield* f.client.call(GATEWAY_METHOD.HELLO);
      assert.ok(hello.ok);
      const snapshot = recordOf(recordOf(hello.result).snapshot);
      assert.deepEqual(Object.keys(snapshot), ["nodes"]);
      assert.deepEqual(snapshot.nodes, []);
    }),
  );
}
