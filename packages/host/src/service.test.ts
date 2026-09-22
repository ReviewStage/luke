import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GATEWAY_EVENT, NODE_CAPABILITY_STATUS } from "@sidecar/gateway";
import { isRecord, type WireValue } from "@sidecar/wire";
import { Effect } from "effect";
import { createGatewayService } from "./service.js";

it.effect(
  "a capability no registered node offers answers unavailable, and a registration is told as an event",
  () =>
    Effect.gen(function* () {
      const service = createGatewayService({});
      const heard: WireValue[] = [];
      service.gateway.on(GATEWAY_EVENT.NODE_CHANGED, (payload) => heard.push(payload));

      const missing = yield* service.nodes.invoke("os.openExternal", {
        url: "https://example.test",
      });
      assert.equal(missing.status, NODE_CAPABILITY_STATUS.UNAVAILABLE);

      service.nodes.registerRemote({
        nodeId: "native",
        capabilities: ["os.openExternal"],
        invoke: () => Effect.succeed({ status: NODE_CAPABILITY_STATUS.OK, value: undefined }),
      });
      const opened = yield* service.nodes.invoke("os.openExternal", {
        url: "https://example.test",
      });
      assert.equal(opened.status, NODE_CAPABILITY_STATUS.OK);
      assert.equal(heard.length, 1);
      const [payload] = heard;
      assert.ok(isRecord(payload));
      assert.deepEqual(payload.nodes, [
        { nodeId: "native", capabilities: ["os.openExternal"], connected: true },
      ]);
    }),
);
