import assert from "node:assert/strict";
import test from "node:test";
import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/contracts";
import {
  type UpdaterEngineEvents,
  UpdateService,
  type UpdateServiceOptions,
} from "./update-service";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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

function service(options: Partial<UpdateServiceOptions> & { states?: UpdateSnapshot[] }) {
  const states = options.states ?? [];
  return new UpdateService({
    currentVersion: "0.1.0",
    onChange: (update) => states.push(update),
    report: () => undefined,
    ...options,
  });
}

test("a found update downloads at once and installs only at the one restart press", async () => {
  const { calls, fire, engine } = fakeEngine();
  const states: UpdateSnapshot[] = [];
  const updates = service({ engine, states });

  // Installing before anything is downloaded is ignored, not a crash.
  updates.install();
  assert.equal(calls.installs, 0);

  const checked = updates.check();
  fire().onChecking();
  fire().onAvailable("0.2.0");
  assert.deepEqual(await checked, {
    status: UPDATE_STATUS.DOWNLOADING,
    currentVersion: "0.1.0",
    installSupported: true,
    latestVersion: "0.2.0",
  });

  fire().onProgress({ percent: 40, transferredBytes: 40, totalBytes: 100 });
  assert.deepEqual(updates.snapshot().status === UPDATE_STATUS.DOWNLOADING && updates.snapshot(), {
    status: UPDATE_STATUS.DOWNLOADING,
    currentVersion: "0.1.0",
    installSupported: true,
    latestVersion: "0.2.0",
    progress: { percent: 40, transferredBytes: 40, totalBytes: 100 },
  });

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
});

test("nothing newer is idle with the up-to-date mark, never an error", async () => {
  const { fire, engine } = fakeEngine();
  const updates = service({ engine });

  const checked = updates.check();
  fire().onNotAvailable();
  assert.deepEqual(await checked, {
    status: UPDATE_STATUS.IDLE,
    currentVersion: "0.1.0",
    installSupported: true,
    upToDate: true,
  });
});

test("a network failure is silence for the next timed check; anything else is the error row", async () => {
  const { calls, fire, engine, rejectNextCheckWith } = fakeEngine();
  const updates = service({ engine });

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
  assert.equal((await updates.check()).status, UPDATE_STATUS.IDLE);
  rejectNextCheckWith("cannot parse update info");
  assert.equal((await updates.check()).status, UPDATE_STATUS.ERROR);
});

test("a download refused right after its check retries as a release still publishing", async () => {
  const { calls, fire, engine } = fakeEngine();
  const updates = service({ engine, publishingRetryDelaysMs: [10] });

  fire().onAvailable("0.2.0");
  fire().onError('Cannot download "https://github.com/x", status 404: Not Found');
  assert.deepEqual(updates.snapshot(), {
    status: UPDATE_STATUS.PUBLISHING,
    currentVersion: "0.1.0",
    installSupported: true,
    latestVersion: "0.2.0",
  });
  // The partial archive is dropped before the retry, like the error path.
  assert.equal(calls.cacheClears, 1);

  // The scheduled retry is the same check; a completed upload proceeds
  // through the ordinary download into the restart offer.
  await sleep(30);
  assert.equal(calls.checks, 1);
  fire().onAvailable("0.2.0");
  fire().onDownloaded("0.2.0");
  assert.equal(updates.snapshot().status, UPDATE_STATUS.READY);
  updates.stop();
});

test("a user press mid-wait collapses the pending retry rather than stacking one", async () => {
  const { calls, fire, engine } = fakeEngine();
  const updates = service({ engine, publishingRetryDelaysMs: [20] });

  fire().onAvailable("0.2.0");
  fire().onError("sha512 checksum mismatch, expected aaa, got bbb");
  assert.equal(updates.snapshot().status, UPDATE_STATUS.PUBLISHING);

  await updates.check();
  await sleep(50);
  assert.equal(calls.checks, 1, "the press replaced the scheduled retry, never joined it");
  updates.stop();
});

test("the exhausted retry schedule falls to the error row a corrupt release deserves", async () => {
  const { calls, fire, engine } = fakeEngine();
  const updates = service({ engine, publishingRetryDelaysMs: [60_000, 60_000] });

  const stillPublishing = 'Cannot download "https://github.com/x", status 404: Not Found';
  fire().onAvailable("0.2.0");
  fire().onError(stillPublishing);
  fire().onAvailable("0.2.0");
  fire().onError(stillPublishing);
  assert.equal(updates.snapshot().status, UPDATE_STATUS.PUBLISHING);

  fire().onAvailable("0.2.0");
  fire().onError(stillPublishing);
  assert.deepEqual(updates.snapshot(), {
    status: UPDATE_STATUS.ERROR,
    currentVersion: "0.1.0",
    installSupported: true,
    latestVersion: "0.2.0",
  });
  assert.equal(calls.cacheClears, 3);

  // A later release is its own publishing window, not the spent one's.
  fire().onAvailable("0.2.1");
  fire().onError(stillPublishing);
  assert.equal(updates.snapshot().status, UPDATE_STATUS.PUBLISHING);
  updates.stop();
});

test("a network blip mid-wait resumes the bounded schedule instead of orphaning it", async () => {
  const { calls, fire, engine } = fakeEngine();
  const updates = service({ engine, publishingRetryDelaysMs: [10, 10, 60_000] });

  fire().onAvailable("0.2.0");
  fire().onError('Cannot download "https://github.com/x", status 404: Not Found');
  await sleep(30);
  assert.equal(calls.checks, 1, "the first retry ran");

  // The retry's own check dying on the network keeps the wait standing, on
  // the next slot of the same budget, rather than falling to idle silence
  // that would leave the found version to the four-hour timer.
  fire().onError("net::ERR_INTERNET_DISCONNECTED");
  assert.deepEqual(updates.snapshot(), {
    status: UPDATE_STATUS.PUBLISHING,
    currentVersion: "0.1.0",
    installSupported: true,
    latestVersion: "0.2.0",
  });
  await sleep(30);
  assert.equal(calls.checks, 2, "the resumed retry ran");
  updates.stop();
});

test("electron-updater's doubled failure delivery spends one slot, not two", async () => {
  const { fire, engine, rejectNextCheckWith } = fakeEngine();
  const updates = service({ engine, publishingRetryDelaysMs: [10, 60_000] });

  fire().onAvailable("0.2.0");
  fire().onError('Cannot download "https://github.com/x", status 404: Not Found');
  rejectNextCheckWith("net::ERR_CONNECTION_RESET");
  await sleep(30);
  assert.equal(updates.snapshot().status, UPDATE_STATUS.PUBLISHING);

  // A failed check arrives as the `error` event and the rejected promise
  // both. The budget above has exactly one slot left, so a second delivery
  // that spent it would fall out of the wait — it must find the wait drawn
  // and leave the budget alone.
  fire().onError("net::ERR_CONNECTION_RESET");
  assert.equal(updates.snapshot().status, UPDATE_STATUS.PUBLISHING);
  updates.stop();
});

test("a wait that outlives the budget offline falls silent like any network failure", async () => {
  const { fire, engine, rejectNextCheckWith } = fakeEngine();
  const updates = service({ engine, publishingRetryDelaysMs: [10] });

  fire().onAvailable("0.2.0");
  fire().onError("sha512 checksum mismatch, expected aaa, got bbb");
  assert.equal(updates.snapshot().status, UPDATE_STATUS.PUBLISHING);

  // The one slot is spent, so the retry dying on the network has no budget
  // left to resume with and the wait ends in the network failure's own
  // answer: unmarked idle, never the error row.
  rejectNextCheckWith("net::ERR_INTERNET_DISCONNECTED");
  await sleep(30);
  assert.deepEqual(updates.snapshot(), {
    status: UPDATE_STATUS.IDLE,
    currentVersion: "0.1.0",
    installSupported: true,
    upToDate: false,
  });
  updates.stop();
});

test("stopping the service clears a pending publishing retry", async () => {
  const { calls, fire, engine } = fakeEngine();
  const updates = service({ engine, publishingRetryDelaysMs: [10] });

  fire().onAvailable("0.2.0");
  fire().onError('Cannot download "https://github.com/x", status 404: Not Found');
  updates.stop();
  await sleep(30);
  assert.equal(calls.checks, 0);
});

test("an error mid-install releases the guard so the next ready build can install", async () => {
  const { calls, fire, engine } = fakeEngine();
  const updates = service({ engine });

  fire().onDownloaded("0.2.0");
  updates.install();
  assert.equal(calls.installs, 1);

  // Squirrel surfaced an error instead of quitting: the guard must release,
  // or the row's restart press is dead for the rest of the run.
  fire().onError("could not stage the update");
  fire().onDownloaded("0.2.0");
  updates.install();
  assert.equal(calls.installs, 2);
});

test("no check moves the row while a download in flight or in hand holds it", async () => {
  const { calls, fire, engine } = fakeEngine();
  const updates = service({ engine });

  fire().onAvailable("0.2.0");
  const midDownload = calls.checks;
  assert.equal((await updates.check()).status, UPDATE_STATUS.DOWNLOADING);
  assert.equal(calls.checks, midDownload, "a timed tick mid-download never reaches the feed");

  fire().onDownloaded("0.2.0");
  assert.equal((await updates.check()).status, UPDATE_STATUS.READY);
  assert.equal(calls.checks, midDownload, "a build in hand is never traded for a re-check");
});

test("without an engine nothing checks, downloads, or installs", async () => {
  const { calls } = fakeEngine();
  const updates = service({});

  assert.deepEqual(await updates.check(), {
    status: UPDATE_STATUS.IDLE,
    currentVersion: "0.1.0",
    installSupported: false,
    upToDate: false,
  });
  updates.install();
  updates.start();
  await sleep(10);
  assert.equal(calls.checks, 0);
  assert.equal(calls.installs, 0);
});

test("the timed check starts at once and stops when asked", async () => {
  const { calls, engine } = fakeEngine();
  const updates = service({ engine, intervalMs: 10 });

  updates.start();
  await sleep(45);
  assert.ok(calls.checks >= 2, `expected the timer to have checked again, saw ${calls.checks}`);

  updates.stop();
  const settled = calls.checks;
  await sleep(30);
  assert.equal(calls.checks, settled);
});

test("the first launch after an install says what happened before checking again", async () => {
  const { calls, engine } = fakeEngine();
  let stored: string | undefined = "0.1.0";
  const states: UpdateSnapshot[] = [];
  const updates = new UpdateService({
    currentVersion: "0.2.0",
    onChange: (update) => states.push(update),
    report: () => undefined,
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
  await sleep(60);
  assert.ok(calls.checks >= 1);
  updates.stop();
});

test("a listener that throws does not fail the transition", () => {
  const { fire, engine } = fakeEngine();
  const updates = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => {
      throw new Error("window already torn down");
    },
    report: () => undefined,
    engine,
  });

  fire().onAvailable("0.2.0");
  assert.equal(updates.snapshot().status, UPDATE_STATUS.DOWNLOADING);
});
