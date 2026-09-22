import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/messages/update";
import { type UpdaterEngineEvents, UpdateService } from "./update-service";

/** An engine whose lifecycle fires only when the test says so. */
function fakeEngine() {
  const calls = { checks: 0, installs: 0, cacheClears: 0 };
  let events: UpdaterEngineEvents | undefined;
  let rejectNextCheck: string | undefined;
  return {
    calls,
    fire: (): UpdaterEngineEvents => {
      assert.ok(events, "the service wires the engine at construction");
      return events;
    },
    rejectNextCheckWith: (message: string) => {
      rejectNextCheck = message;
    },
    engine: {
      wire: (next: UpdaterEngineEvents) => {
        events = next;
      },
      checkForUpdates: async () => {
        calls.checks += 1;
        if (rejectNextCheck) {
          const message = rejectNextCheck;
          rejectNextCheck = undefined;
          throw new Error(message);
        }
      },
      quitAndInstall: () => {
        calls.installs += 1;
      },
      clearCachedUpdate: async () => {
        calls.cacheClears += 1;
      },
    },
  };
}

/**
 * `UpdateService.make` demands the ambient `Scope.Scope` its forked fibers
 * land in and reads its clock from the ambient services; `it.effect`'s own
 * scope stands in for the launch's assembly scope, exactly as in production,
 * and its `TestClock` is what every timed check sleeps
 * on, so a test advances the clock rather than waiting. The scope is never
 * closed by a test: `stop()` interrupts the tracked fibers directly and does
 * not depend on the scope's own closing to do it.
 */
function service(
  options: Partial<Parameters<typeof UpdateService.make>[0]> & { states?: UpdateSnapshot[] },
) {
  const states = options.states ?? [];
  return UpdateService.make({
    currentVersion: "0.1.0",
    onChange: (update) => states.push(update),
    report: () => undefined,
    ...options,
  });
}

it.effect("a found update downloads at once and installs only at the one restart press", () =>
  Effect.gen(function* () {
    const { calls, fire, engine } = fakeEngine();
    const states: UpdateSnapshot[] = [];
    const updates = yield* service({ engine, states });

    // Installing before anything is downloaded is ignored, not a crash.
    updates.install();
    assert.equal(calls.installs, 0);

    const checked = updates.check();
    fire().onChecking();
    fire().onAvailable("0.2.0");
    assert.deepEqual(yield* Effect.promise(() => checked), {
      status: UPDATE_STATUS.DOWNLOADING,
      currentVersion: "0.1.0",
      installSupported: true,
      latestVersion: "0.2.0",
    });

    fire().onProgress({ percent: 40, transferredBytes: 40, totalBytes: 100 });
    assert.deepEqual(
      updates.snapshot().status === UPDATE_STATUS.DOWNLOADING && updates.snapshot(),
      {
        status: UPDATE_STATUS.DOWNLOADING,
        currentVersion: "0.1.0",
        installSupported: true,
        latestVersion: "0.2.0",
        progress: { percent: 40, transferredBytes: 40, totalBytes: 100 },
      },
    );

    fire().onDownloaded("0.2.0");
    assert.equal(updates.snapshot().status, UPDATE_STATUS.READY);

    // Only the first press reaches the engine: repeat presses while Squirrel
    // stages the swap race to replace the binary and can lose the update.
    updates.install();
    updates.install();
    assert.equal(calls.installs, 1);
    assert.deepEqual(
      states.map((state) => state.status),
      [
        UPDATE_STATUS.CHECKING,
        UPDATE_STATUS.CHECKING,
        UPDATE_STATUS.DOWNLOADING,
        UPDATE_STATUS.DOWNLOADING,
        UPDATE_STATUS.READY,
      ],
    );
  }),
);

it.effect("nothing newer is idle with the up-to-date mark, never an error", () =>
  Effect.gen(function* () {
    const { fire, engine } = fakeEngine();
    const updates = yield* service({ engine });

    const checked = updates.check();
    fire().onNotAvailable();
    assert.deepEqual(yield* Effect.promise(() => checked), {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "0.1.0",
      installSupported: true,
      upToDate: true,
    });
  }),
);

it.effect(
  "a network failure is silence for the next timed check; anything else is the error row",
  () =>
    Effect.gen(function* () {
      const { calls, fire, engine, rejectNextCheckWith } = fakeEngine();
      const updates = yield* service({ engine });

      // The engine's error event mid-download, transient: back to idle, unmarked.
      fire().onAvailable("0.2.0");
      fire().onError("net::ERR_INTERNET_DISCONNECTED");
      assert.deepEqual(updates.snapshot(), {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "0.1.0",
        installSupported: true,
        upToDate: false,
      });
      assert.equal(calls.cacheClears, 0);

      // A real failure lands on the error row, still naming the newer build, and
      // drops the cached download a corrupt archive would otherwise pin forever.
      fire().onAvailable("0.2.0");
      fire().onError("code signature validation failed");
      assert.deepEqual(updates.snapshot(), {
        status: UPDATE_STATUS.ERROR,
        currentVersion: "0.1.0",
        installSupported: true,
        latestVersion: "0.2.0",
      });
      assert.equal(calls.cacheClears, 1);

      // A check whose own promise rejects answers the same two ways.
      rejectNextCheckWith("ENOTFOUND api.github.com");
      assert.equal((yield* Effect.promise(() => updates.check())).status, UPDATE_STATUS.IDLE);
      rejectNextCheckWith("cannot parse update info");
      assert.equal((yield* Effect.promise(() => updates.check())).status, UPDATE_STATUS.ERROR);
    }),
);

it.effect("an error mid-install releases the guard so the next ready build can install", () =>
  Effect.gen(function* () {
    const { calls, fire, engine } = fakeEngine();
    const updates = yield* service({ engine });

    fire().onDownloaded("0.2.0");
    updates.install();
    assert.equal(calls.installs, 1);

    // Squirrel surfaced an error instead of quitting: the guard must release,
    // or the row's restart press is dead for the rest of the run.
    fire().onError("could not stage the update");
    fire().onDownloaded("0.2.0");
    updates.install();
    assert.equal(calls.installs, 2);
  }),
);

it.effect("no check moves the row while a download in flight or in hand holds it", () =>
  Effect.gen(function* () {
    const { calls, fire, engine } = fakeEngine();
    const updates = yield* service({ engine });

    fire().onAvailable("0.2.0");
    const midDownload = calls.checks;
    assert.equal((yield* Effect.promise(() => updates.check())).status, UPDATE_STATUS.DOWNLOADING);
    assert.equal(calls.checks, midDownload, "a timed tick mid-download never reaches the feed");

    fire().onDownloaded("0.2.0");
    assert.equal((yield* Effect.promise(() => updates.check())).status, UPDATE_STATUS.READY);
    assert.equal(calls.checks, midDownload, "a build in hand is never traded for a re-check");
  }),
);

it.effect("without an engine nothing checks, downloads, or installs", () =>
  Effect.gen(function* () {
    const { calls } = fakeEngine();
    const updates = yield* service({});

    assert.deepEqual(yield* Effect.promise(() => updates.check()), {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "0.1.0",
      installSupported: false,
      upToDate: false,
    });
    updates.install();
    updates.start();
    yield* TestClock.adjust(10);
    assert.equal(calls.checks, 0);
    assert.equal(calls.installs, 0);
  }),
);

it.effect("the timed check starts at once and stops when asked", () =>
  Effect.gen(function* () {
    const { calls, engine } = fakeEngine();
    const updates = yield* service({ engine, intervalMs: 10 });

    updates.start();
    yield* TestClock.adjust(45);
    assert.ok(calls.checks >= 2, `expected the timer to have checked again, saw ${calls.checks}`);

    updates.stop();
    const settled = calls.checks;
    yield* TestClock.adjust(30);
    assert.equal(calls.checks, settled);
  }),
);

it.effect("the first launch after an install says what happened before checking again", () =>
  Effect.gen(function* () {
    const { calls, engine } = fakeEngine();
    let stored: string | undefined = "0.1.0";
    const states: UpdateSnapshot[] = [];
    const updates = yield* service({
      currentVersion: "0.2.0",
      onChange: (update) => states.push(update),
      engine,
      lastRunVersion: {
        read: () => stored,
        write: (version) => {
          stored = version;
        },
      },
      justUpdatedFirstCheckDelayMs: 30,
      intervalMs: 60_000,
    });

    updates.start();
    assert.deepEqual(updates.snapshot(), {
      status: UPDATE_STATUS.UPDATED,
      currentVersion: "0.2.0",
      installSupported: true,
      previousVersion: "0.1.0",
    });
    assert.equal(stored, "0.2.0");
    // The confirmation holds until the delayed first check overwrites it.
    assert.equal(calls.checks, 0);
    yield* TestClock.adjust(60);
    assert.ok(calls.checks >= 1);
    updates.stop();
  }),
);

it.effect("a listener that throws does not fail the transition", () =>
  Effect.gen(function* () {
    const { fire, engine } = fakeEngine();
    const updates = yield* service({
      onChange: () => {
        throw new Error("window already torn down");
      },
      engine,
    });

    fire().onAvailable("0.2.0");
    assert.equal(updates.snapshot().status, UPDATE_STATUS.DOWNLOADING);
  }),
);
