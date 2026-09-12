import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACTION_REFUSAL } from "@sidecar/actions";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayMethod,
  InProcessTransport,
} from "@sidecar/gateway";
import type { GatewayInProcessHost } from "@sidecar/gateway/server";
import { ACTION_RESULT_STATUS, isRecord, lateRef } from "@sidecar/wire";
import { temporaryDirectory } from "@sidecar/wire/testing";
import { Effect, Layer } from "effect";
import { hostLayer } from "./compose-host.js";
import { type Composer, mergeMethods } from "./composer.js";
import { HostTag } from "./effect/host.js";
import { createHostKernel } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";
import type { SecretCipher } from "./settings-store.js";
import { testKernelLayer } from "./testing/test-kernel.js";

const CIPHER: SecretCipher = {
  isAvailable: () => false,
  encrypt: (plainText) => Buffer.from(plainText, "utf8"),
  decrypt: (cipherText) => cipherText.toString("utf8"),
};

function stubComposer(methods: readonly GatewayMethod[]): Composer {
  return {
    methods: Object.fromEntries(methods.map((method) => [method, () => Effect.succeed({})])),
    start: async () => undefined,
    stop: async () => undefined,
  };
}

/** `hostLayer` over a fixture state root, standing every composer for the scope it is provided to. */
function fixtureHostLayer(stateRoot: string) {
  return Layer.provide(hostLayer, testKernelLayer({ stateRoot }));
}

/** One client of the composed host, as the desktop's own operator is: one connection, every request on it. */
function operatorTransport(gateway: GatewayInProcessHost): InProcessTransport {
  return new InProcessTransport(gateway, {
    clientId: "test",
    role: GATEWAY_CLIENT_ROLE.OPERATOR,
  });
}

it("a method two composers claim is a construction failure, not a last writer", () => {
  assert.throws(
    () =>
      mergeMethods([
        stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
        stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
      ]),
    /two composers answer settings\.snapshot/,
  );
  assert.deepEqual(
    Object.keys(
      mergeMethods([
        stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
        stubComposer([GATEWAY_METHOD.ACCOUNT_SNAPSHOT]),
      ]),
    ).sort(),
    [GATEWAY_METHOD.ACCOUNT_SNAPSHOT, GATEWAY_METHOD.SETTINGS_SNAPSHOT].sort(),
  );
});

it("a late reference read before link() has run says so rather than answering nothing", () => {
  const held = lateRef<{ value: number }>("the test's links");
  assert.throws(() => held.get(), /the test's links is read before link\(\) has run/);
  held.set({ value: 1 });
  assert.equal(held.get().value, 1);
});

it("the kernel's service is a named failure before the merge composed it", () => {
  const kernel = createHostKernel({
    stateRoot: "/nowhere",
    runMode: runModeFor({ capture: false, fixture: true }),
    appVersion: "0.0.0-test",
    packaged: false,
    environment: {},
    cipher: CIPHER,
    createWorker: () => {
      throw new Error("unused");
    },
    now: () => 0,
    createId: () => "id",
    report: () => undefined,
  });
  assert.throws(() => kernel.service(), /before the merge composed it/);
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
          const response = yield* Effect.promise(() =>
            operatorTransport(host.gateway).request({
              protocolVersion: GATEWAY_PROTOCOL_VERSION,
              id: "bootstrap-1",
              method: GATEWAY_METHOD.CLIENT_BOOTSTRAP,
              params: {},
            }),
          );
          assert.ok(response.ok);
          assert.ok(isRecord(response.result));
          assert.equal(response.result.calendarOnboardingOwed, false);
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
  "a row's write reaches the host as a method and is refused for a session the roster does not hold",
  (t) =>
    Effect.gen(function* () {
      const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
      yield* Effect.provide(
        Effect.gen(function* () {
          const host = yield* HostTag;
          const identity = { providerId: "conductor", providerSessionId: "chat-nobody-observed" };
          const transport = operatorTransport(host.gateway);
          const [sent, pressed] = yield* Effect.promise(() =>
            Promise.all([
              transport.request({
                protocolVersion: GATEWAY_PROTOCOL_VERSION,
                id: "send-1",
                method: GATEWAY_METHOD.SESSION_SEND_MESSAGE,
                params: { identity, text: "hello" },
                idempotencyKey: "send-1",
              }),
              transport.request({
                protocolVersion: GATEWAY_PROTOCOL_VERSION,
                id: "press-1",
                method: GATEWAY_METHOD.SESSION_EXECUTE_CONTROL,
                params: { identity, controlId: "cancel-run" },
                idempotencyKey: "press-1",
              }),
            ]),
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
