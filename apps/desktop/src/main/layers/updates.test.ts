import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Layer, TestContext } from "effect";
import { UPDATE_STATUS } from "#shared/contracts";
import { createDesktopRuntime, hasDesktopRuntime } from "../runtime";
import { requestDesktopShutdown, resetShutdownStateForTests } from "../shutdown";
import { PUBLISHING_RETRY_DELAYS_MS, UPDATE_CHECK_DEFAULTS } from "../update-service";
import { desktopLive } from "./app";
import { UpdatesTag, updatesLayer } from "./updates";

test("desktop runtime is singleton and shutdown is idempotent", async () => {
  resetShutdownStateForTests();
  const input = {
    platform: {
      runMode: {
        requiresAccount: true,
        observesProviders: true,
        registersGlobalKeys: true,
        animates: true,
        takesFocus: true,
        sendsNetwork: true,
      },
      appVersion: "0.1.0",
      isPackaged: false,
      platform: "darwin" as const,
      accountBaseUrl: "https://example.com/api/auth/",
      hostedServiceBaseUrl: "https://example.com",
      accountClientId: "luke-desktop",
    },
    storage: {
      userDataPath: "/tmp/luke-test",
      lastRunVersionPath: "/tmp/luke-test/last-run-version.json",
    },
    analytics: {
      sender: {
        arm: () => undefined,
        record: () => undefined,
        start: () => undefined,
        stop: () => undefined,
        flush: async () => undefined,
        markDayActive: () => undefined,
      } as never,
    },
    updates: {
      currentVersion: "0.1.0",
      onChange: () => undefined,
      report: () => undefined,
    },
  };

  assert.equal(hasDesktopRuntime(), false);
  createDesktopRuntime(input);
  assert.throws(() => createDesktopRuntime(input));
  let beforeCount = 0;
  await requestDesktopShutdown({
    beforeQuit: () => {
      beforeCount += 1;
    },
    willQuit: () => undefined,
  });
  assert.equal(beforeCount, 1);
  assert.equal(hasDesktopRuntime(), false);
  await requestDesktopShutdown({
    beforeQuit: () => {
      beforeCount += 1;
    },
    willQuit: () => undefined,
  });
  assert.equal(beforeCount, 1);
});

test("updates layer preserves schedule constants", () => {
  assert.equal(UPDATE_CHECK_DEFAULTS.INTERVAL_MS, 4 * 60 * 60 * 1000);
  assert.equal(UPDATE_CHECK_DEFAULTS.JUST_UPDATED_FIRST_CHECK_DELAY_MS, 10_000);
  assert.deepEqual(PUBLISHING_RETRY_DELAYS_MS, [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]);
});

test("desktopLive provides one Updates instance", async () => {
  const layer = desktopLive({
    platform: {
      runMode: {
        requiresAccount: true,
        observesProviders: true,
        registersGlobalKeys: true,
        animates: true,
        takesFocus: true,
        sendsNetwork: true,
      },
      appVersion: "0.1.0",
      isPackaged: false,
      platform: "darwin",
      accountBaseUrl: "https://example.com/api/auth/",
      hostedServiceBaseUrl: "https://example.com",
      accountClientId: "luke-desktop",
    },
    storage: {
      userDataPath: "/tmp/luke-test",
      lastRunVersionPath: "/tmp/luke-test/last-run-version.json",
    },
    analytics: {
      sender: {
        arm: () => undefined,
        record: () => undefined,
        start: () => undefined,
        stop: () => undefined,
        flush: async () => undefined,
        markDayActive: () => undefined,
      } as never,
    },
    updates: {
      currentVersion: "0.1.0",
      onChange: () => undefined,
      report: () => undefined,
    },
  });

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* UpdatesTag;
        const second = yield* UpdatesTag;
        assert.equal(first, second);
        assert.equal(first.snapshot().status, UPDATE_STATUS.IDLE);
      }).pipe(Effect.provide(layer)),
    ),
  );
});

test("updates layer wires just-updated confirmation before first check", async () => {
  let stored: string | undefined = "0.1.0";
  const layer = updatesLayer({
    currentVersion: "0.2.0",
    onChange: () => undefined,
    report: () => undefined,
    justUpdatedFirstCheckDelayMs: 30,
    intervalMs: 60_000,
    lastRunVersion: {
      read: () => stored,
      write: (version) => {
        stored = version;
      },
    },
    engine: {
      wire: () => undefined,
      checkForUpdates: async () => undefined,
      quitAndInstall: () => undefined,
      clearCachedUpdate: async () => undefined,
    },
  }).pipe(Layer.provideMerge(Layer.scope));

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* UpdatesTag;
        yield* updates.start();
        assert.deepEqual(updates.snapshot(), {
          status: UPDATE_STATUS.UPDATED,
          currentVersion: "0.2.0",
          installSupported: true,
          previousVersion: "0.1.0",
        });
        yield* updates.stop();
      }).pipe(Effect.provide(layer), Effect.provide(TestContext.TestContext)),
    ),
  );
});
