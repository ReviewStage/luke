import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACTION_REFUSAL } from "@sidecar/actions";
import { GATEWAY_METHOD, type GatewayMethod } from "@sidecar/gateway";
import { ACTION_RESULT_STATUS, isRecord, isWireString } from "@sidecar/wire";
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
          // The one method no composer owns: it reads six of them, so an answer
          // proves the merge stood every concern up and linked their back-edges.
          const response = yield* host.gateway.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP);
          assert.ok(response.ok);
          assert.ok(isRecord(response.result));
          assert.equal(response.result.calendarOnboardingOwed, false);
          assert.equal(response.result.introductionOwed, false);
          assert.equal(response.result.conductorKeyOnboardingOwed, false);
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

it.effect("a cloud provider's key is refused signed out, and the store never held it", (t) =>
  Effect.gen(function* () {
    const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
    yield* Effect.provide(
      Effect.gen(function* () {
        const host = yield* HostTag;
        const response = yield* host.gateway.call(GATEWAY_METHOD.CREDENTIAL_SET_API_KEY, {
          providerId: "conductor",
          apiKey: "cnd_test_key_1234567890",
        });
        assert.ok(response.ok);
        assert.ok(isRecord(response.result));
        assert.equal(response.result.status, ACTION_RESULT_STATUS.REJECTED);
        assert.ok(isWireString(response.result.reason));
        assert.ok(isRecord(response.result.settings));
        assert.ok(isRecord(response.result.settings.status));
        assert.ok(isRecord(response.result.settings.status.credentialSources));
        assert.equal(response.result.settings.status.credentialSources.conductor, "none");
      }),
      fixtureHostLayer(stateRoot),
    );
  }),
);

it.effect(
  "a row's write reaches the host as a method and is refused for a session the roster does not hold",
  (t) =>
    Effect.gen(function* () {
      const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
      yield* Effect.provide(
        Effect.gen(function* () {
          const host = yield* HostTag;
          const identity = { providerId: "conductor", providerSessionId: "chat-nobody-observed" };
          const [sent, pressed] = yield* Effect.all(
            [
              host.gateway.call(GATEWAY_METHOD.SESSION_SEND_MESSAGE, { identity, text: "hello" }),
              host.gateway.call(GATEWAY_METHOD.SESSION_EXECUTE_CONTROL, {
                identity,
                controlId: "cancel-run",
              }),
            ],
            { concurrency: "unbounded" },
          );
          // A fixture host observes nothing, so admission's own roster refusal is the
          // answer for both writes: the method is wired, and nothing past admission ran.
          for (const response of [sent, pressed]) {
            assert.ok(response.ok);
            assert.deepEqual(response.result, {
              status: ACTION_RESULT_STATUS.REJECTED,
              reason: ACTION_REFUSAL.NO_SESSION,
            });
          }
        }),
        fixtureHostLayer(stateRoot),
      );
    }),
);

it.effect(
  "an offer for a planning call about a plan the planning window does not have open is refused before any session is asked for",
  (t) =>
    Effect.gen(function* () {
      const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
      yield* Effect.provide(
        Effect.gen(function* () {
          const host = yield* HostTag;
          const sdp = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
          const [aboutPlan, desk] = yield* Effect.all([
            host.gateway.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, {
              sdp,
              planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
            }),
            host.gateway.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, { sdp }),
          ]);
          // A fixture host stands no voice source, so a desk offer is refused for want of a
          // session; the planning offer is refused for its plan first, and never reaches that.
          assert.ok(!aboutPlan.ok && !desk.ok);
          assert.notEqual(aboutPlan.error.message, desk.error.message);
          assert.match(aboutPlan.error.message, /plan/);
        }),
        fixtureHostLayer(stateRoot),
      );
    }),
);
