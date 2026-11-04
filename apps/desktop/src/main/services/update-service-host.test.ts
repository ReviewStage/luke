import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AppStateStore } from "@repo/host/client";
import type { UpdaterEngine, UpdaterEngineEvents } from "@repo/host/update-service";
import { UPDATE_FAILURE, UPDATE_STATUS, type UpdateSnapshot } from "@repo/settings/update";
import { Effect } from "effect";
import { vi } from "vitest";
import type { DesktopConfig } from "./desktop-config";
import { createUpdateServiceHost } from "./update-service-host";

/**
 * Restart to update as the Updates row and the menu bar press it, over an
 * installer that has a build downloaded: it asks first, a Cancel installs
 * nothing and counts nothing, and a yes gives everything back before
 * Squirrel's own quit and install, which nothing holds. Synthetic versions
 * throughout.
 */

// Note that Electron is never reached: the menu bar is drawn through `showMenuBar`, and no window opens.
vi.mock("electron", () => ({}));

/** What the updater reads of the launch: a packaged build that sends nothing on its own. */
const CONFIG = {
  appVersion: "1.0.0",
  packaged: true,
  runMode: { sendsNetwork: false },
  stateRoot: "unused-state-root",
  report: () => undefined,
  showMenuBar: () => undefined,
  openExternal: async () => undefined,
};

/** The updater over an installer holding `2.0.0`, recording what reached the teardown, Squirrel, and the counts. */
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
      // SAFETY: the updater reads only the fields `CONFIG` names.
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
      // SAFETY: the updater only writes where it stands, which no assertion reads.
      state: { update: () => undefined } as unknown as AppStateStore,
      showSettings: () => undefined,
      moveToApplications: () => undefined,
    });
    heard?.onDownloaded("2.0.0");
    return { updates, happened };
  });

/** Lets the question's answer, and the teardown behind it, run. */
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
      // SAFETY: the updater reads only the fields `CONFIG` names.
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
      // SAFETY: the updater only writes where it stands, which `told` keeps.
      state: {
        update: ({ update }: { update: UpdateSnapshot }) => told.push(update),
      } as unknown as AppStateStore,
      showSettings: () => undefined,
      moveToApplications: () => undefined,
    });

    heard?.onAvailable("2.0.0");
    // Squirrel.Mac's own words, as electron-updater hands them on.
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
