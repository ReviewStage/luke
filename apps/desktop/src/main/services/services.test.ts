import assert from "node:assert/strict";
import test from "node:test";
import { runModeFor } from "@sidecar/host";
import { drainMicrotasks, temporaryDirectory } from "@sidecar/runtime/testing";
import { AppStateStore, initialAppState } from "../app-state";
import type { UpdaterEngine, UpdaterEngineEvents } from "../update-service";
import type { DesktopConfig } from "./desktop-config";
import { createHostService } from "./host-service";
import { stopInReverse } from "./lifecycle";
import type { DesktopService } from "./service";
import { createUpdateServiceHost } from "./update-service-host";

/**
 * The services that reach Electron cannot be constructed here at all:
 * outside an Electron process the `electron` module has no named exports, so
 * a file that imports one fails to instantiate. What is proven here is the
 * mechanism every service answers to — the order, the reverse, the
 * idempotence, and the handles — over the services that hold a handle
 * without a window: the host and the updater.
 *
 * Every assertion about a handle depends on this file running without
 * `--test-force-exit`, which `pnpm test` does: a `stop` that left an
 * interval behind hangs the run rather than passing it.
 */

function recordingService(name: string, order: string[]): DesktopService {
  return {
    name,
    start: async () => {
      order.push(`start:${name}`);
    },
    stop: async () => {
      order.push(`stop:${name}`);
    },
  };
}

/** A service that holds a real handle, so a `stop` that forgot one is a hang rather than a green run. */
function tickingService(name: string): DesktopService {
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    name,
    start: async () => {
      timer = setInterval(() => undefined, 1_000);
    },
    stop: async () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

const CIPHER = {
  isAvailable: () => false,
  encrypt: (plainText: string) => Buffer.from(plainText, "utf8"),
  decrypt: (cipherText: Buffer) => cipherText.toString("utf8"),
};

function fixtureConfig(
  stateRoot: string,
  report: (message: string) => void = () => undefined,
): DesktopConfig {
  return {
    stateRoot,
    runMode: runModeFor({ capture: false, fixture: true }),
    appVersion: "0.0.0-test",
    packaged: false,
    homeDirectory: stateRoot,
    environment: {},
    platform: "darwin",
    resourceDirectory: stateRoot,
    hostedServiceBaseUrl: "https://example.invalid",
    launch: {
      captureOutput: undefined,
      profile: "idle",
      fixtureName: "smoke",
      startPeeked: false,
      startInSlot: false,
      captureMode: false,
      fixtureMode: true,
    },
    report,
    openExternal: async () => undefined,
    quit: () => undefined,
  };
}

test("every service stops, in the reverse of the order it began in", async () => {
  const order: string[] = [];
  const all = [
    recordingService("keychain", order),
    recordingService("host", order),
    recordingService("windows", order),
  ];
  for (const service of all) await service.start();
  await stopInReverse(all, () => undefined);
  assert.deepEqual(order, [
    "start:keychain",
    "start:host",
    "start:windows",
    "stop:windows",
    "stop:host",
    "stop:keychain",
  ]);
});

test("one service that cannot stop is reported and does not strand the rest", async () => {
  const order: string[] = [];
  const reports: string[] = [];
  await stopInReverse(
    [
      recordingService("keychain", order),
      {
        name: "windows",
        start: async () => undefined,
        stop: async () => {
          throw new Error("a window was already gone");
        },
      },
    ],
    (message) => reports.push(message),
  );
  assert.deepEqual(order, ["stop:keychain"]);
  assert.deepEqual(reports, [
    "the windows service did not stop cleanly: a window was already gone",
  ]);
});

test("a stop before any start resolves, and a second stop resolves too", async () => {
  const all = [tickingService("first"), tickingService("second")];
  await stopInReverse(all, () => undefined);
  for (const service of all) await service.start();
  await stopInReverse(all, () => undefined);
  await stopInReverse(all, () => undefined);
});

test("the host service starts and stops leaving no handle, and says what the drain settled", async (t) => {
  const stateRoot = await temporaryDirectory(t);
  const reports: string[] = [];
  const host = createHostService({
    config: fixtureConfig(stateRoot, (message) => reports.push(message)),
    cipher: CIPHER,
  });
  host.link({ attach: async () => undefined });
  assert.equal(host.drainOwed(), false);
  await host.start();
  assert.equal(host.drainOwed(), true);
  await host.stop();
  assert.equal(host.drainOwed(), false);
  assert.ok(
    reports.some((message) => message.startsWith("shutting down:")),
    `the drain reported nothing: ${reports.join(" | ")}`,
  );
  // A second ask is not a second drain, and nothing is owed once one finished.
  await host.stop();
});

test("the host's standup carries the operator's attach, and a failed attach fails the start", async (t) => {
  const stateRoot = await temporaryDirectory(t);
  const order: string[] = [];
  const host = createHostService({
    config: fixtureConfig(stateRoot),
    cipher: CIPHER,
  });
  host.link({
    attach: async () => {
      order.push("attach");
      throw new Error("the host answered no bootstrap");
    },
  });
  await assert.rejects(() => host.start(), /the host answered no bootstrap/);
  assert.deepEqual(order, ["attach"]);
  // The drain is owed from before the start, so a launch that could not stand
  // up still has a runtime to give back.
  assert.equal(host.drainOwed(), true);
  await host.stop();
});

test("the host service reads its links by name rather than answering nothing", async (t) => {
  const stateRoot = await temporaryDirectory(t);
  const host = createHostService({ config: fixtureConfig(stateRoot), cipher: CIPHER });
  await assert.rejects(
    () => host.start(),
    /the host service's links is read before link\(\) has run/,
  );
  await host.stop();
});

test("the updater's timers are handles the stop takes back, and a restart tears down first", async (t) => {
  const stateRoot = await temporaryDirectory(t);
  const order: string[] = [];
  const snapshots: string[] = [];
  let events: UpdaterEngineEvents | undefined;
  const engine: UpdaterEngine = {
    wire: (wired) => {
      events = wired;
    },
    checkForUpdates: async () => undefined,
    quitAndInstall: () => order.push("install"),
    clearCachedUpdate: async () => undefined,
  };
  const config = {
    ...fixtureConfig(stateRoot),
    runMode: runModeFor({ capture: false, fixture: false }),
  };
  const state = new AppStateStore(initialAppState(config, true));
  state.subscribe(() => snapshots.push(state.snapshot().update.status));
  const updates = createUpdateServiceHost({
    config,
    recordProductEvent: () => undefined,
    engine,
    beforeRestart: async () => {
      order.push("teardown");
    },
    state,
  });
  await updates.start();
  assert.ok(events, "the engine was never wired");
  events.onDownloaded("9.9.9");
  updates.install();
  await drainMicrotasks(2);
  // The restart into a downloaded build swaps this executable, so everything
  // owed is given back before Squirrel is let anywhere near it — and given
  // back first, so the installer's own quit is not the one held open.
  assert.deepEqual(order, ["teardown", "install"]);
  assert.ok(snapshots.length > 0, "no update state ever reached the windows");
  await updates.stop();
  await updates.stop();
});

test("a launch suspended on one of its waits opens nothing once a quit has been asked for", async (t) => {
  // The invariant, in the shape the composition wires: the signal a start
  // re-checks is set the instant `stop` is asked for, so a start that resumes
  // after the teardown has run opens nothing. Reading the drain's own state
  // instead would flip the signal several awaited stops later, which is how a
  // resumed start came to re-open what the teardown had just given back.
  const stateRoot = await temporaryDirectory(t);
  const host = createHostService({ config: fixtureConfig(stateRoot), cipher: CIPHER });
  host.link({ attach: async () => undefined });
  await host.start();

  let quitting = false;
  const opened: string[] = [];
  let releaseSettings: (() => void) | undefined;
  const windows: DesktopService = {
    name: "windows",
    start: async () => {
      await new Promise<void>((resolve) => {
        releaseSettings = resolve;
      });
      if (!quitting) opened.push("window");
    },
    stop: async () => {
      opened.push("teardown");
    },
  };
  const all = [host, windows];
  const stop = () => {
    quitting = true;
    return stopInReverse(all, () => undefined);
  };

  const launch = windows.start();
  const quit = stop();
  releaseSettings?.();
  await Promise.all([launch, quit]);
  // The teardown ran and the launch, resuming after it, opened nothing.
  assert.deepEqual(opened, ["teardown"]);
  // And by now the drain has finished, so its own state is back to owing
  // nothing — a signal that says nothing about whether a quit was asked for.
  assert.equal(host.drainOwed(), false);
});

test("a quit arriving after the teardown finished is not held back, so an install is not aborted", async () => {
  // The regression this pins: holding every `before-quit` open aborts the
  // update, because Squirrel's own quit is the one that reaches the
  // installer. The updater runs the teardown itself and hands over only once
  // it has finished, so what the entry reads is whether one has finished.
  const order: string[] = [];
  let stopped = false;
  let stopping: Promise<void> | undefined;
  const all = [
    {
      name: "host",
      start: async () => undefined,
      stop: async () => {
        order.push("drain");
      },
    },
  ];
  const teardown = (): Promise<void> => {
    if (!stopping) {
      stopping = stopInReverse(all, () => undefined).finally(() => {
        stopping = undefined;
        stopped = true;
      });
    }
    return stopping;
  };
  // The entry's own rule, as `registerQuit` applies it.
  const beforeQuit = (): "held" | "through" => {
    if (stopped) return "through";
    void teardown();
    return "held";
  };

  await teardown();
  order.push("install");
  assert.equal(beforeQuit(), "through");
  assert.deepEqual(order, ["drain", "install"]);

  // And the explicit Quit, which arrives with nothing torn down yet, is held
  // exactly once.
  stopped = false;
  assert.equal(beforeQuit(), "held");
  await stopping;
  assert.equal(beforeQuit(), "through");
});

test("a wait guarded against the quit schedules nothing new once one is asked for", () => {
  // Both halves matter. A wait that fires must not act after the teardown,
  // and a wait that was running must not arm the next one behind a teardown
  // that has already cleared them — which is how the takeover's fade came to
  // be scheduled after its own stop.
  let standing = true;
  const waits = new Set<ReturnType<typeof setTimeout>>();
  const afterDelay = (delayMs: number, run: () => void): void => {
    if (!standing) return;
    const wait = setTimeout(() => {
      waits.delete(wait);
      if (!standing) return;
      run();
    }, delayMs);
    waits.add(wait);
  };

  afterDelay(1_000, () => undefined);
  assert.equal(waits.size, 1);
  standing = false;
  afterDelay(1_000, () => undefined);
  assert.equal(waits.size, 1, "a wait was armed after the quit was asked for");
  for (const wait of waits) clearTimeout(wait);
  waits.clear();
});
