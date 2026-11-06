import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AppStateStore } from "@repo/host/client";
import type { UpdaterEngine, UpdaterEngineEvents } from "@repo/host/update-service";
import { UPDATE_FAILURE, UPDATE_STATUS, type UpdateSnapshot } from "@repo/settings/update";
import { Effect } from "effect";
import { vi } from "vitest";
import type { DesktopConfig } from "./desktop-config";
import { createUpdateServiceHost } from "./update-service-host";

vi.mock("electron", () => ({}));

const CONFIG = {
  appVersion: "1.0.0",
  packaged: true,
  runMode: { sendsNetwork: false },
  stateRoot: "unused-state-root",
  report: () => undefined,
  showMenuBar: () => undefined,
  openExternal: async () => undefined,
};

const restartFixture = (answer: boolean) =>
  Effect.gen(function* () {
    const happened: string[] = [];
    let heard: UpdaterEngineEvents | undefined;
    const engine: UpdaterEngine = {
      wire: (events) => {
        heard = events;
      },
      checkForUpdates: async () => undefined,
      quitAndInstall: () => happened.push("squirrel quit and install"),
      clearCachedUpdate: async () => undefined,
    };
    const updates = yield* createUpdateServiceHost({
      config: CONFIG as unknown as DesktopConfig,
      recordProductEvent: (name) => happened.push(`counted ${name}`),
      engine,
      beforeRestart: async () => {
        happened.push("teardown");
      },
      askBeforeRestart: async () => {
        happened.push("asked");
        return answer;
      },
      state: { update: () => undefined } as unknown as AppStateStore,
      showSettings: () => undefined,
      moveToApplications: () => undefined,
    });
    heard?.onDownloaded("2.0.0");
    return { updates, happened };
  });

const settled = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

it.effect("Restart to update asks first, and a Cancel installs nothing", () =>
  Effect.gen(function* () {
    const { updates, happened } = yield* restartFixture(false);

    updates.install();
    yield* settled;

    assert.deepEqual(happened, ["asked"]);
  }).pipe(Effect.scoped),
);

it.effect(
  "Restart to update, once agreed, gives everything back and then hands Squirrel its own quit",
  () =>
    Effect.gen(function* () {
      const { updates, happened } = yield* restartFixture(true);

      updates.install();
      yield* settled;

      assert.deepEqual(happened, [
        "asked",
        "counted update:action",
        "teardown",
        "squirrel quit and install",
      ]);
    }).pipe(Effect.scoped),
);

it.effect("an install Squirrel refuses on a read-only volume is told as that failure", () =>
  Effect.gen(function* () {
    const told: UpdateSnapshot[] = [];
    let heard: UpdaterEngineEvents | undefined;
    yield* createUpdateServiceHost({
      config: CONFIG as unknown as DesktopConfig,
      recordProductEvent: () => undefined,
      engine: {
        wire: (events) => {
          heard = events;
        },
        checkForUpdates: async () => undefined,
        quitAndInstall: () => undefined,
        clearCachedUpdate: async () => undefined,
      },
      beforeRestart: async () => undefined,
      askBeforeRestart: async () => true,
      state: {
        update: ({ update }: { update: UpdateSnapshot }) => told.push(update),
      } as unknown as AppStateStore,
      showSettings: () => undefined,
      moveToApplications: () => undefined,
    });

    heard?.onAvailable("2.0.0");
    heard?.onError(
      "Cannot update while running on a read-only volume. The application is on a read-only volume. Please move the application and try again.",
    );

    assert.deepEqual(told.at(-1), {
      status: UPDATE_STATUS.ERROR,
      currentVersion: "1.0.0",
      installSupported: true,
      latestVersion: "2.0.0",
      failure: UPDATE_FAILURE.READ_ONLY_VOLUME,
    });
  }).pipe(Effect.scoped),
);
