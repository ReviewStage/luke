import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GATEWAY_ERROR, GATEWAY_METHOD, type GatewayMethod } from "@sidecar/gateway";
import { isRecord } from "@sidecar/wire";
import { temporaryDirectory } from "@sidecar/wire/testing";
import { Effect, Layer, Result } from "effect";
import { hostAssemblyLayer } from "./compose-host.js";
import { type Composer, DuplicateGatewayMethod, foldMethods } from "./composer.js";
import { HostTag, hostStandingLayer } from "./effect/host.js";
import { testKernelLayer } from "./testing/test-kernel.js";

function stubComposer(methods: readonly GatewayMethod[]): Composer {
  return {
    methods: Object.fromEntries(methods.map((method) => [method, () => Effect.succeed({})])),
    lifetime: Effect.void,
  };
}

/** The host over a fixture state root, standing every composer for the scope it is provided to. */
function fixtureHostLayer(stateRoot: string) {
  return Layer.provide(
    Layer.provide(hostStandingLayer, hostAssemblyLayer),
    testKernelLayer({ stateRoot }),
  );
}

it("a method two composers claim is a construction failure, not a last writer", () => {
  assert.deepEqual(
    foldMethods([
      stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
      stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
    ]),
    Result.fail(new DuplicateGatewayMethod({ method: GATEWAY_METHOD.SETTINGS_SNAPSHOT })),
  );
  const merged = foldMethods([
    stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
    stubComposer([GATEWAY_METHOD.ACCOUNT_SNAPSHOT]),
  ]);
  assert.ok(Result.isSuccess(merged));
  assert.deepEqual(
    Object.keys(merged.success).sort(),
    [GATEWAY_METHOD.ACCOUNT_SNAPSHOT, GATEWAY_METHOD.SETTINGS_SNAPSHOT].sort(),
  );
});

it.effect(
  "the merge answers the bootstrap every concern contributes to, and starts and stops",
  (t) =>
    Effect.gen(function* () {
      const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
      yield* Effect.provide(
        Effect.gen(function* () {
          const host = yield* HostTag;
          // The one method no composer owns: it reads several of them, so an
          // answer proves the merge stood every concern up and linked their
          // back-edges.
          const response = yield* host.gateway.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP);
          assert.ok(response.ok);
          assert.ok(isRecord(response.result));
          assert.equal(response.result.voiceAvailable, false);
          const first = yield* host.drain({ deadlineMs: 0 });
          // A second drain is the quit arriving twice; it must answer the first outcome rather than throw.
          const second = yield* host.drain({ deadlineMs: 0 });
          assert.deepEqual(second, first);
        }),
        fixtureHostLayer(stateRoot),
      );
    }),
);

it.effect(
  "an offer for a planning call about a plan the panel does not have open is refused before any session is asked for",
  (t) =>
    Effect.gen(function* () {
      const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
      yield* Effect.provide(
        Effect.gen(function* () {
          const host = yield* HostTag;
          const sdp = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
          const [aboutPlan, aboutNothing] = yield* Effect.all([
            host.gateway.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, {
              sdp,
              planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
            }),
            host.gateway.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, { sdp }),
          ]);
          // The planning offer is refused for its plan; an offer about no plan
          // is not a call this host creates at all.
          assert.ok(!aboutPlan.ok && !aboutNothing.ok);
          assert.match(aboutPlan.error.message, /plan/);
          assert.equal(aboutNothing.error.code, GATEWAY_ERROR.INVALID_PARAMS);
        }),
        fixtureHostLayer(stateRoot),
      );
    }),
);
