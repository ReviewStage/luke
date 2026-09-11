import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_REFUSAL } from "@sidecar/actions";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayMethod,
  gatewayOk,
} from "@sidecar/gateway";
import { temporaryDirectory } from "@sidecar/runtime/testing";
import { ACTION_RESULT_STATUS, isRecord, lateRef } from "@sidecar/wire";
import { composeHost } from "./compose-host.js";
import { type Composer, mergeMethods } from "./composer.js";
import { createHostKernel } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";
import type { SecretCipher } from "./settings-store.js";

const CIPHER: SecretCipher = {
  isAvailable: () => false,
  encrypt: (plainText) => Buffer.from(plainText, "utf8"),
  decrypt: (cipherText) => cipherText.toString("utf8"),
};

function stubComposer(methods: readonly GatewayMethod[]): Composer {
  return {
    methods: Object.fromEntries(methods.map((method) => [method, () => gatewayOk({})])),
    start: async () => undefined,
    stop: async () => undefined,
  };
}

function fixtureHost(stateRoot: string) {
  return composeHost({
    stateRoot,
    runMode: runModeFor({ capture: false, fixture: true }),
    appVersion: "0.0.0-test",
    packaged: false,
    homeDirectory: stateRoot,
    environment: {},
    cipher: CIPHER,
    createWorker: () => {
      throw new Error("a fixture run keeps nothing on disk");
    },
    now: () => 0,
    createId: () => "id",
    report: () => undefined,
  });
}

test("a method two composers claim is a construction failure, not a last writer", () => {
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

test("a late reference read before link() has run says so rather than answering nothing", () => {
  const held = lateRef<{ value: number }>("the test's links");
  assert.throws(() => held.get(), /the test's links is read before link\(\) has run/);
  held.set({ value: 1 });
  assert.equal(held.get().value, 1);
});

test("the kernel's service is a named failure before the merge composed it", () => {
  const kernel = createHostKernel({
    stateRoot: "/nowhere",
    runMode: runModeFor({ capture: false, fixture: true }),
    appVersion: "0.0.0-test",
    packaged: false,
    homeDirectory: "/nowhere",
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

test("the merge answers the bootstrap every concern contributes to, and starts and stops", async (t) => {
  const host = fixtureHost(temporaryDirectory(t));
  await host.start();
  // The one method no composer owns: it reads six of them, so an answer
  // proves the merge stood every concern up and linked their back-edges.
  const response = await host.server.handle(
    {
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      id: "bootstrap-1",
      method: GATEWAY_METHOD.CLIENT_BOOTSTRAP,
      params: {},
    },
    { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
  );
  assert.ok(response.ok);
  assert.ok(isRecord(response.result));
  assert.equal(response.result.calendarOnboardingOwed, false);
  assert.equal(response.result.voiceAvailable, false);
  await host.stop({ deadlineMs: 0 });
  // A second stop is the quit arriving twice; it must not throw.
  await host.stop({ deadlineMs: 0 });
});

test("a row's write reaches the host as a method and is refused for a session the roster does not hold", async (t) => {
  const host = fixtureHost(temporaryDirectory(t));
  await host.start();
  const identity = { providerId: "conductor", providerSessionId: "chat-nobody-observed" };
  const [sent, pressed] = await Promise.all([
    host.server.handle(
      {
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        id: "send-1",
        method: GATEWAY_METHOD.SESSION_SEND_MESSAGE,
        params: { identity, text: "hello" },
        idempotencyKey: "send-1",
      },
      { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
    ),
    host.server.handle(
      {
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        id: "press-1",
        method: GATEWAY_METHOD.SESSION_EXECUTE_CONTROL,
        params: { identity, controlId: "cancel-run" },
        idempotencyKey: "press-1",
      },
      { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
    ),
  ]);
  // A fixture host observes nothing, so admission's own roster refusal is the
  // answer for both writes: the method is wired, and nothing past admission ran.
  for (const response of [sent, pressed]) {
    assert.ok(response.ok);
    assert.deepEqual(response.result, {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: ACTION_REFUSAL.NO_SESSION,
    });
  }
  await host.stop({ deadlineMs: 0 });
});
