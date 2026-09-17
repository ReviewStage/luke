import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { runModeFor } from "@sidecar/host";
import { HostAssemblyTag, hostStandingLayer, layersInOrder } from "@sidecar/host/effect";
import { temporaryDirectory } from "@sidecar/runtime/testing";
import { Context, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { AppStateStore, initialAppState } from "../app-state";
import type { UpdaterEngine, UpdaterEngineEvents } from "../update-service";
import type { DesktopConfig } from "./desktop-config";
import { hostAssemblyLayerFor } from "./host-layer";
import { desktopQuit, QUIT_STAGE } from "./quit";
import type { DesktopService } from "./service";
import { serviceLayer } from "./service-layer";
import { createUpdateServiceHost, type UpdateServiceHost } from "./update-service-host";

/** The test's own handle on the updater Layer builds, to read the value a scoped Layer otherwise discards. */
class UpdatesTag extends Context.Service<UpdatesTag, UpdateServiceHost>()(
  "test/services/updates",
) {}

/**
 * The services that reach Electron cannot be constructed here at all:
 * outside an Electron process the `electron` module has no named exports, so
 * a file that imports one fails to instantiate. What is proven here is the
 * mechanism every service answers to — the order, the reverse, and the
 * handles — over the layer the composition builds every one of them in, and
 * over the two concerns that hold a handle without a window: the host and
 * the updater.
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
 * The launch as the entry runs it: the layer built once into one scope, and
 * that scope's close as the whole quit.
 */
const standing = <A, E>(
  layer: Layer.Layer<A, E, never>,
): Effect.Effect<{ readonly context: Context.Context<A>; readonly close: Effect.Effect<void> }> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Effect.orDie(Layer.buildWithScope(layer, scope));
    return { context, close: Scope.close(scope, Exit.void) };
  });

it.effect("every service stops, in the reverse of the order it began in", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    const built = yield* standing(
      layersInOrder([
        serviceLayer(recordingService("keychain", order), silent),
        serviceLayer(recordingService("host", order), silent),
        serviceLayer(recordingService("windows", order), silent),
      ]),
    );
    yield* built.close;
    assert.deepEqual(order, [
      "start:keychain",
      "start:host",
      "start:windows",
      "stop:windows",
      "stop:host",
      "stop:keychain",
    ]);
  }),
);

it.effect("one service that cannot stop is reported and does not strand the rest", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    const reports: string[] = [];
    const report = (message: string): void => {
      reports.push(message);
    };
    const built = yield* standing(
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
    yield* built.close;
    assert.deepEqual(order, ["start:keychain", "stop:keychain"]);
    assert.equal(reports.length, 1);
  }),
);

it.effect("a start that fails gives back what began before it, and starts nothing after it", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    const scope = yield* Scope.make();
    const built = yield* Effect.exit(
      Layer.buildWithScope(
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
        scope,
      ),
    );
    assert.equal(Exit.isFailure(built), true);
    yield* Scope.close(scope, Exit.void);
    // The windows never began, the operator's own stop gave back what its
    // failed start had allocated, and the keychain before it stopped last.
    assert.deepEqual(order, ["start:keychain", "start:operator", "stop:operator", "stop:keychain"]);
  }),
);

it.effect("the host's assembly stands its server up before any composer starts", (t) =>
  Effect.gen(function* () {
    const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
    const stood = yield* Effect.provide(
      Effect.map(HostAssemblyTag, (assembly) => assembly.startOrder.length > 0),
      hostAssemblyLayerFor({ config: fixtureConfig(stateRoot), cipher: CIPHER }),
    );
    assert.equal(stood, true);
  }),
);

it.effect(
  "the host stands and drains leaving no handle, and a second close is not a second drain",
  (t) =>
    Effect.gen(function* () {
      const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
      const reports: string[] = [];
      const config = fixtureConfig(stateRoot, (message) => {
        reports.push(message);
      });
      const built = yield* standing(
        Layer.provide(hostStandingLayer, hostAssemblyLayerFor({ config, cipher: CIPHER })),
      );
      const stoodUp = reports.length;
      // The drain says what it settled, once, however many asks arrive.
      yield* built.close;
      assert.equal(reports.length, stoodUp + 1);
      yield* built.close;
      assert.equal(reports.length, stoodUp + 1);
    }),
);

it.effect(
  "the updater's timers are handles the stop takes back, and a restart tears down first",
  (t) =>
    Effect.gen(function* () {
      const stateRoot = yield* Effect.promise(() => temporaryDirectory(t));
      const order: string[] = [];
      let events: UpdaterEngineEvents | undefined;
      let installed: (() => void) | undefined;
      const installAsked = new Promise<void>((resolve) => {
        installed = resolve;
      });
      const engine: UpdaterEngine = {
        wire: (wired) => {
          events = wired;
        },
        checkForUpdates: async () => undefined,
        quitAndInstall: () => {
          order.push("install");
          installed?.();
        },
        clearCachedUpdate: async () => undefined,
      };
      const config = {
        ...fixtureConfig(stateRoot),
        runMode: runModeFor({ capture: false, fixture: false }),
      };
      const state = new AppStateStore(initialAppState(config, true), Context.empty());
      const snapshots: string[] = [];
      const watching = yield* Effect.forkChild(
        Stream.runForEach(state.changes, (held) =>
          Effect.sync(() => snapshots.push(held.update.status)),
        ),
      );
      // The collector is given one turn to reach its subscription, since a
      // `SubscriptionRef` delivers a write only to a subscriber already reading.
      yield* Effect.yieldNow;
      const quit = desktopQuit();
      quit.closesThrough(async () => {
        order.push("teardown");
      });
      const built = yield* standing(
        Layer.effect(
          UpdatesTag,
          createUpdateServiceHost({
            config,
            recordProductEvent: () => undefined,
            engine,
            beforeRestart: quit.teardown,
            state,
          }),
        ),
      );
      const updates = Context.get(built.context, UpdatesTag);
      updates.start();
      assert.ok(events, "the engine was never wired");
      events.onDownloaded("9.9.9");
      updates.install();
      // The install is what the test waits on, not a turn count: the restart
      // hands over only once the teardown it runs first has finished.
      yield* Effect.promise(() => installAsked);
      // The restart into a downloaded build swaps this executable, so everything
      // owed is given back before Squirrel is let anywhere near it — and given
      // back first, so the installer's own quit is not the one held open.
      assert.deepEqual(order, ["teardown", "install"]);
      assert.ok(snapshots.length > 0, "no update state ever reached the windows");
      // The scope's close is the stop that takes the timed check's handle back.
      yield* built.close;
      yield* Fiber.interrupt(watching);
    }),
);

it.effect(
  "a launch suspended on one of its waits opens nothing once a quit has been asked for",
  () =>
    Effect.gen(function* () {
      // The invariant, in the shape the composition wires: the signal a start
      // re-checks falls the instant the teardown is asked for, so a start that
      // resumes after it has run opens nothing. Reading the runtime's own close
      // instead would flip the signal several awaited stops later, which is how
      // a resumed start came to re-open what the teardown had just given back.
      const quit = desktopQuit();
      const opened: string[] = [];
      let releaseWindows: (() => void) | undefined;
      let reachedStart: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        reachedStart = resolve;
      });
      let closed: (() => void) | undefined;
      const closing = new Promise<void>((resolve) => {
        closed = resolve;
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
      const scope = yield* Scope.make();
      quit.closesThrough(() => closing);

      const launch = yield* Effect.forkChild(
        Effect.exit(Layer.buildWithScope(layersInOrder([serviceLayer(windows, silent)]), scope)),
      );
      yield* Effect.promise(() => started);
      const torn = quit.teardown();
      releaseWindows?.();
      yield* Fiber.join(launch);
      yield* Scope.close(scope, Exit.void);
      closed?.();
      yield* Effect.promise(() => torn);
      // The teardown ran and the launch, resuming after it, opened nothing.
      assert.deepEqual(opened, ["teardown"]);
      assert.equal(quit.stage(), QUIT_STAGE.TORN_DOWN);
    }),
);

it.effect(
  "a quit arriving after the teardown finished is not held back, so an install is not aborted",
  () =>
    Effect.gen(function* () {
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

      yield* Effect.promise(quit.teardown);
      order.push("install");
      assert.equal(beforeQuit(), "through");
      assert.deepEqual(order, ["refuse", "close", "install"]);
      // And the one teardown is made once, however many asks arrive.
      yield* Effect.promise(quit.teardown);
      assert.deepEqual(order, ["refuse", "close", "install"]);
    }),
);

it.effect("the quit stands until one is asked for, and the launch falls with the ask", () =>
  Effect.gen(function* () {
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
    yield* Effect.promise(() => torn);
    assert.equal(quit.stage(), QUIT_STAGE.TORN_DOWN);
    assert.equal(quit.launchStanding(), false);
  }),
);
