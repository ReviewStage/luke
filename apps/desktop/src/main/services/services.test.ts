import assert from "node:assert/strict";
import { setImmediate as immediate } from "node:timers/promises";
import { runModeFor } from "@sidecar/host";
import { HostAssemblyTag, hostStandingLayer, layersInOrder } from "@sidecar/host/effect";
import { temporaryDirectory } from "@sidecar/runtime/testing";
import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Runtime, Stream } from "effect";
import { test } from "vitest";
import { AppStateStore, initialAppState } from "../app-state";
import type { UpdaterEngine, UpdaterEngineEvents } from "../update-service";
import type { DesktopConfig } from "./desktop-config";
import { hostAssemblyLayerFor } from "./host-layer";
import { desktopQuit, QUIT_STAGE } from "./quit";
import type { DesktopService } from "./service";
import { serviceLayer } from "./service-layer";
import { createUpdateServiceHost, type UpdateServiceHost } from "./update-service-host";

/** The test's own handle on the updater Layer builds, to read the value a scoped Layer otherwise discards. */
class UpdatesTag extends Context.Tag("test/services/updates")<UpdatesTag, UpdateServiceHost>() {}

/**
 * The services that reach Electron cannot be constructed here at all:
 * outside an Electron process the `electron` module has no named exports, so
 * a file that imports one fails to instantiate. What is proven here is the
 * mechanism every service answers to — the order, the reverse, the
 * idempotence, and the handles — over the layer the composition builds every
 * one of them in, and over the two concerns that hold a handle without a
 * window: the host and the updater.
 *
 * Every assertion about a handle depends on this file running without
 * `--test-force-exit`, which `pnpm test` does: a `stop` that left an
 * interval behind hangs the run rather than passing it.
 */

const silent = (): void => undefined;

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
  report: (message: string) => void = silent,
): DesktopConfig {
  return {
    stateRoot,
    runMode: runModeFor({ capture: false, fixture: true }),
    appVersion: "0.0.0-test",
    packaged: false,
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

/**
 * The launch as the entry runs it: one runtime over the layer, built once,
 * and the close that is the whole quit.
 */
const standing = async <A, E>(
  layer: Layer.Layer<A, E, never>,
): Promise<{ readonly close: () => Promise<void> }> => {
  const runtime = ManagedRuntime.make(layer);
  await runtime.runPromise(Effect.void);
  return { close: () => runtime.dispose() };
};

test("every service stops, in the reverse of the order it began in", async () => {
  const order: string[] = [];
  const built = await standing(
    layersInOrder([
      serviceLayer(recordingService("keychain", order), silent),
      serviceLayer(recordingService("host", order), silent),
      serviceLayer(recordingService("windows", order), silent),
    ]),
  );
  await built.close();
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
  const report = (message: string): void => {
    reports.push(message);
  };
  const built = await standing(
    layersInOrder([
      serviceLayer(recordingService("keychain", order), report),
      serviceLayer(
        {
          name: "windows",
          start: async () => undefined,
          stop: async () => {
            throw new Error("a window was already gone");
          },
        },
        report,
      ),
    ]),
  );
  await built.close();
  assert.deepEqual(order, ["start:keychain", "stop:keychain"]);
  assert.equal(reports.length, 1);
});

test("a start that fails gives back what began before it, and starts nothing after it", async () => {
  const order: string[] = [];
  const runtime = ManagedRuntime.make(
    layersInOrder([
      serviceLayer(recordingService("keychain", order), silent),
      serviceLayer(
        {
          name: "operator",
          start: async () => {
            order.push("start:operator");
            throw new Error("the host answered no bootstrap");
          },
          stop: async () => {
            order.push("stop:operator");
          },
        },
        silent,
      ),
      serviceLayer(recordingService("windows", order), silent),
    ]),
  );
  const built = await runtime.runPromiseExit(Effect.void);
  assert.equal(Exit.isFailure(built), true);
  await runtime.dispose();
  // The windows never began, the operator's own stop gave back what its
  // failed start had allocated, and the keychain before it stopped last.
  assert.deepEqual(order, ["start:keychain", "start:operator", "stop:operator", "stop:keychain"]);
});

test("a close before any start resolves, and a second close resolves too", async () => {
  const unstarted = ManagedRuntime.make(
    layersInOrder([serviceLayer(tickingService("first"), silent)]),
  );
  await unstarted.dispose();
  const built = await standing(layersInOrder([serviceLayer(tickingService("second"), silent)]));
  await built.close();
  await built.close();
});

test("the host's assembly stands its server up before any composer starts", async (t) => {
  const stateRoot = await temporaryDirectory(t);
  const stood = await Effect.runPromise(
    Effect.provide(
      Effect.map(HostAssemblyTag, (assembly) => assembly.startOrder.length > 0),
      hostAssemblyLayerFor({ config: fixtureConfig(stateRoot), cipher: CIPHER }),
    ),
  );
  assert.equal(stood, true);
});

test("the host stands and drains leaving no handle, and a second close is not a second drain", async (t) => {
  const stateRoot = await temporaryDirectory(t);
  const reports: string[] = [];
  const config = fixtureConfig(stateRoot, (message) => {
    reports.push(message);
  });
  const built = await standing(
    Layer.provide(hostStandingLayer, hostAssemblyLayerFor({ config, cipher: CIPHER })),
  );
  const stoodUp = reports.length;
  // The drain says what it settled, once, however many asks arrive.
  await built.close();
  assert.equal(reports.length, stoodUp + 1);
  await built.close();
  assert.equal(reports.length, stoodUp + 1);
});

test("the updater's timers are handles the stop takes back, and a restart tears down first", async (t) => {
  const stateRoot = await temporaryDirectory(t);
  const order: string[] = [];
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
  const state = new AppStateStore(initialAppState(config, true), Runtime.defaultRuntime);
  const snapshots: string[] = [];
  const watching = Effect.runSync(
    Effect.forkDaemon(
      Stream.runForEach(state.changes, (held) =>
        Effect.sync(() => snapshots.push(held.update.status)),
      ),
    ),
  );
  const quit = desktopQuit();
  quit.closesThrough(async () => {
    order.push("teardown");
  });
  const runtime = ManagedRuntime.make(
    Layer.scoped(
      UpdatesTag,
      createUpdateServiceHost({
        config,
        recordProductEvent: () => undefined,
        engine,
        beforeRestart: quit.teardown,
        state,
        runtime: Runtime.defaultRuntime,
      }),
    ),
  );
  const updates = await runtime.runPromise(UpdatesTag);
  updates.start();
  assert.ok(events, "the engine was never wired");
  events.onDownloaded("9.9.9");
  updates.install();
  await immediate();
  await immediate();
  // The restart into a downloaded build swaps this executable, so everything
  // owed is given back before Squirrel is let anywhere near it — and given
  // back first, so the installer's own quit is not the one held open.
  assert.deepEqual(order, ["teardown", "install"]);
  assert.ok(snapshots.length > 0, "no update state ever reached the windows");
  // The scope's close is the stop, and a second one is not a second stop.
  await runtime.dispose();
  await runtime.dispose();
  await Effect.runPromise(Fiber.interrupt(watching));
});

test("a launch suspended on one of its waits opens nothing once a quit has been asked for", async () => {
  // The invariant, in the shape the composition wires: the signal a start
  // re-checks falls the instant the teardown is asked for, so a start that
  // resumes after it has run opens nothing. Reading the runtime's own close
  // instead would flip the signal several awaited stops later, which is how a
  // resumed start came to re-open what the teardown had just given back.
  const quit = desktopQuit();
  const opened: string[] = [];
  let releaseWindows: (() => void) | undefined;
  let reachedStart: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    reachedStart = resolve;
  });
  const windows: DesktopService = {
    name: "windows",
    start: async () => {
      await new Promise<void>((resolve) => {
        releaseWindows = resolve;
        reachedStart?.();
      });
      if (quit.launchStanding()) opened.push("window");
    },
    stop: async () => {
      opened.push("teardown");
    },
  };
  const runtime = ManagedRuntime.make(layersInOrder([serviceLayer(windows, silent)]));
  quit.closesThrough(() => runtime.dispose());

  const launch = runtime.runPromiseExit(Effect.void);
  await started;
  const torn = quit.teardown();
  releaseWindows?.();
  await Promise.all([launch, torn]);
  // The teardown ran and the launch, resuming after it, opened nothing.
  assert.deepEqual(opened, ["teardown"]);
  assert.equal(quit.stage(), QUIT_STAGE.TORN_DOWN);
});

test("a quit arriving after the teardown finished is not held back, so an install is not aborted", async () => {
  // The regression this pins: holding every `before-quit` open aborts the
  // update, because Squirrel's own quit is the one that reaches the
  // installer. The updater runs the teardown itself and hands over only once
  // it has finished, so what the entry reads is whether one has finished.
  const order: string[] = [];
  const quit = desktopQuit();
  quit.beforeTeardown(() => order.push("refuse"));
  quit.closesThrough(async () => {
    order.push("close");
  });
  // The entry's own rule, as `registerQuit` applies it.
  const beforeQuit = (): "held" | "through" => {
    if (quit.stage() === QUIT_STAGE.TORN_DOWN) return "through";
    void quit.teardown();
    return "held";
  };

  await quit.teardown();
  order.push("install");
  assert.equal(beforeQuit(), "through");
  assert.deepEqual(order, ["refuse", "close", "install"]);
  // And the one teardown is made once, however many asks arrive.
  await quit.teardown();
  assert.deepEqual(order, ["refuse", "close", "install"]);
});

test("the quit stands until one is asked for, and the launch falls with the ask", async () => {
  const quit = desktopQuit();
  let release: (() => void) | undefined;
  quit.closesThrough(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  assert.equal(quit.stage(), QUIT_STAGE.STANDING);
  assert.equal(quit.launchStanding(), true);
  const torn = quit.teardown();
  assert.equal(quit.stage(), QUIT_STAGE.TEARING_DOWN);
  assert.equal(quit.launchStanding(), false);
  release?.();
  await torn;
  assert.equal(quit.stage(), QUIT_STAGE.TORN_DOWN);
  assert.equal(quit.launchStanding(), false);
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
