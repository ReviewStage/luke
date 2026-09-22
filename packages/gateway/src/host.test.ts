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
        [GATEWAY_METHOD.SESSION_ROSTER]: (params, context) => {
          asked.push(context.client);
          return Effect.succeed({ sessions: [], echoed: params.echo ?? null });
        },
        [GATEWAY_METHOD.VOICE_DIAGNOSTICS]: () => {
          throw new Error("the index fell over");
        },
        [GATEWAY_METHOD.SETTINGS_UPDATE]: () =>
          Effect.fail(new RefusedRefusal({ message: "nothing settable" })),
        [GATEWAY_METHOD.CONVERSATION_REFRESH]: () => Effect.succeed(undefined),
      },
    }),
  };
}

it.effect("a call runs its handler under the host's one client and answers what it answered", () =>
  Effect.gen(function* () {
    const h = host();
    const answer = yield* h.gateway.call(GATEWAY_METHOD.SESSION_ROSTER, { echo: 1 });
    assert.deepEqual(answer, { ok: true, result: { sessions: [], echoed: 1 } });
    assert.deepEqual(h.asked, [OPERATOR]);
    const nothing = yield* h.gateway.call(GATEWAY_METHOD.CONVERSATION_REFRESH);
    assert.deepEqual(nothing, { ok: true, result: undefined });
  }),
);

it.effect(
  "unknown, refused, and thrown are three typed errors, each refusing its own call alone",
  () =>
    Effect.gen(function* () {
      const h = host();
      const unknown = yield* h.gateway.call(GATEWAY_METHOD.WORKSPACE_PROJECTS);
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
      const after = yield* h.gateway.call(GATEWAY_METHOD.SESSION_ROSTER);
      assert.ok(after.ok);
    }),
);

it("an event reaches every listener of its kind on the tick it is emitted, and none after it stops listening", () => {
  const h = host();
  const sessions: WireValue[] = [];
  const settings: WireValue[] = [];
  const stop = h.gateway.on(GATEWAY_EVENT.SESSIONS_CHANGED, (payload) => sessions.push(payload));
  h.gateway.on(GATEWAY_EVENT.SETTINGS_CHANGED, (payload) => settings.push(payload));

  h.gateway.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
  assert.deepEqual(sessions, [{ sessions: [] }]);
  assert.deepEqual(settings, []);

  stop();
  h.gateway.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [1] });
  h.gateway.emit(GATEWAY_EVENT.SETTINGS_CHANGED, { settings: {} });
  assert.deepEqual(sessions, [{ sessions: [] }]);
  assert.deepEqual(settings, [{ settings: {} }]);
});
