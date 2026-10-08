import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { WireValue } from "@sidecar/wire";
import { Effect } from "effect";
import { gatewayHost } from "./host.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayClientIdentity,
  RefusedRefusal,
} from "./protocol.js";

const OPERATOR: GatewayClientIdentity = {
  clientId: "operator",
  role: GATEWAY_CLIENT_ROLE.OPERATOR,
};

function host() {
  const asked: GatewayClientIdentity[] = [];
  return {
    asked,
    gateway: gatewayHost({
      client: OPERATOR,
      methods: {
        [GATEWAY_METHOD.SETTINGS_SNAPSHOT]: (params, context) => {
          asked.push(context.client);
          return Effect.succeed({ settings: [], echoed: params.echo ?? null });
        },
        [GATEWAY_METHOD.VOICE_DIAGNOSTICS]: () => {
          throw new Error("the index fell over");
        },
        [GATEWAY_METHOD.SETTINGS_UPDATE]: () =>
          Effect.fail(new RefusedRefusal({ message: "nothing settable" })),
        [GATEWAY_METHOD.PLANNING_REFRESH]: () => Effect.succeed(undefined),
      },
    }),
  };
}

it.effect("a call runs its handler under the host's one client and answers what it answered", () =>
  Effect.gen(function* () {
    const h = host();
    const answer = yield* h.gateway.call(GATEWAY_METHOD.SETTINGS_SNAPSHOT, { echo: 1 });
    assert.deepEqual(answer, { ok: true, result: { settings: [], echoed: 1 } });
    assert.deepEqual(h.asked, [OPERATOR]);
    const nothing = yield* h.gateway.call(GATEWAY_METHOD.PLANNING_REFRESH);
    assert.deepEqual(nothing, { ok: true, result: undefined });
  }),
);

it.effect(
  "unknown, refused, and thrown are three typed errors, each refusing its own call alone",
  () =>
    Effect.gen(function* () {
      const h = host();
      const unknown = yield* h.gateway.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT);
      assert.ok(!unknown.ok);
      assert.equal(unknown.error.code, GATEWAY_ERROR.UNKNOWN_METHOD);
      const refused = yield* h.gateway.call(GATEWAY_METHOD.SETTINGS_UPDATE, {});
      assert.ok(!refused.ok);
      assert.deepEqual(refused.error, { code: GATEWAY_ERROR.REFUSED, message: "nothing settable" });
      const thrown = yield* h.gateway.call(GATEWAY_METHOD.VOICE_DIAGNOSTICS);
      assert.ok(!thrown.ok);
      assert.deepEqual(thrown.error, {
        code: GATEWAY_ERROR.INTERNAL,
        message: "the index fell over",
      });
      const after = yield* h.gateway.call(GATEWAY_METHOD.SETTINGS_SNAPSHOT);
      assert.ok(after.ok);
    }),
);

it("an event reaches every listener of its kind on the tick it is emitted, and none after it stops listening", () => {
  const h = host();
  const plans: WireValue[] = [];
  const settings: WireValue[] = [];
  const stop = h.gateway.on(GATEWAY_EVENT.PLANNING_CHANGED, (payload) => plans.push(payload));
  h.gateway.on(GATEWAY_EVENT.SETTINGS_CHANGED, (payload) => settings.push(payload));

  h.gateway.emit(GATEWAY_EVENT.PLANNING_CHANGED, { plans: [] });
  assert.deepEqual(plans, [{ plans: [] }]);
  assert.deepEqual(settings, []);

  stop();
  h.gateway.emit(GATEWAY_EVENT.PLANNING_CHANGED, { plans: [1] });
  h.gateway.emit(GATEWAY_EVENT.SETTINGS_CHANGED, { settings: {} });
  assert.deepEqual(plans, [{ plans: [] }]);
  assert.deepEqual(settings, [{ settings: {} }]);
});
