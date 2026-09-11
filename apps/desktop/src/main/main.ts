import { Duration, Effect, Fiber, ManagedRuntime, Option } from "effect";
import { app, Menu, shell } from "electron";
import { bootstrapDesktop } from "./bootstrap";
import { composeDesktop, DesktopTag } from "./services/compose-desktop";
import { desktopQuit, QUIT_STAGE } from "./services/quit";
import { initializeCrashReporting } from "./services/telemetry-service";
import { reportToStderr, tolerateClosedStderr } from "./stderr-report";

/**
 * The desktop client's entry: the process that draws. It owns the windows,
 * the keys, the Dock, the native helpers this machine's devices answer
 * through, the updater that replaces this binary, and the one-time
 * introduction; it reaches everything else — the store, the brain, the
 * credentials, the observation, the accounts — through the Gateway protocol
 * as one operator, and offers this machine's native capabilities back to the
 * host as one node. The host it operates is composed here, in this process,
 * and reached over the in-process transport; a host on the other side of a
 * socket is the same client over another transport, and nothing above the
 * transport changes.
 *
 * This is the one place in the process that runs an Effect. Everything of the
 * launch is one `Layer`, built on one `ManagedRuntime`: building it is the
 * whole standup, and disposing it is the whole quit.
 *
 * Nothing of the launch happens while these modules load. What is at module
 * scope here is only what has to be settled before Electron derives anything
 * from it — the name, the paths, and the crash reporter over them — and the
 * single-instance lock, which the losing copy must lose having touched
 * nothing. Everything else is composed and then started, in `main`.
 */

/**
 * How long the quit waits for the runtime to close before leaving it to the
 * exit. The host's own drain is bounded inside it; what this bounds is the
 * rest — a start that stops answering mid-launch, a stop that never returns —
 * because this process holds the single-instance lock, so a quit that waited
 * forever would leave the next launch able only to report that Luke is
 * already running.
 */
const RUNTIME_CLOSE_WAIT_MS = 15_000;

const config = bootstrapDesktop({
  app,
  argv: process.argv,
  environment: process.env,
  resourceDirectory: __dirname,
  report: reportToStderr,
  openExternal: (url) => shell.openExternal(url),
  quit: () => app.quit(),
  initializeCrashReporting,
});
tolerateClosedStderr();

const quit = desktopQuit();

/**
 * The whole quit: the one scope every service and the host were built in
 * closes, so each gives back what it began in the reverse of the order it
 * began in and the host's drain is the first of those steps — no runtime work
 * of Luke's continues after an intentional quit. The close is forked so the
 * bound above cannot interrupt it: a close that outran its wait is still
 * closing when this process leaves, which is the same answer an unsettled
 * drain leaves behind.
 */
const closeRuntime = (runtime: { readonly disposeEffect: Effect.Effect<void> }) =>
  Effect.gen(function* () {
    const closing = yield* Effect.forkDaemon(runtime.disposeEffect);
    const closed = yield* Effect.timeoutOption(
      Fiber.join(closing),
      Duration.millis(RUNTIME_CLOSE_WAIT_MS),
    );
    if (Option.isNone(closed)) {
      config.report("the runtime did not close in time; leaving it to the exit");
    }
  });

// One Luke per machine, decided before any window, host, or composition work:
// the losing copy must exit having started no second store worker, claimed no
// global shortcut, and opened no window.
if (app.requestSingleInstanceLock()) {
  void main();
} else {
  reportToStderr(
    "Luke is already running; the existing panel was refreshed instead of starting a second copy.",
  );
  app.quit();
}

async function main(): Promise<void> {
  await app.whenReady();
  // A window created under the default activation policy flashes a Dock tile,
  // so both are settled before anything opens one.
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  Menu.setApplicationMenu(null);

  const runtime = ManagedRuntime.make(composeDesktop(config, quit));
  quit.closesThrough(() => Effect.runPromise(closeRuntime(runtime)));
  registerQuit();
  try {
    // Building the layer is the whole standup: every service's start is one
    // step of it, in the one order, and the host's is among them.
    await runtime.runPromise(DesktopTag);
  } catch (error) {
    // A standup a quit interrupted is not a standup that failed: the teardown
    // it was interrupted by is already giving everything back, and reporting
    // a failure for it would only name the quit as an error.
    if (!quit.launchStanding()) return;
    // A start that cannot finish leaves nothing to draw, so this process
    // gives back what it did arm and goes, rather than sitting on the
    // single-instance lock with no window and no way for the next launch in.
    // The quit below is what closes the runtime, in the one order.
    config.report(
      `the runtime could not stand up: ${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
  }
}

/**
 * A quit arriving after the teardown has finished is never held, and the
 * updater's restart depends on it: Squirrel's own quit must reach the
 * installer, and a prevented `before-quit` aborts the update. So the updater
 * runs the same teardown itself and only then hands over, which is why what
 * is read here is whether one has finished rather than whether one is owed.
 */
function registerQuit(): void {
  app.on("before-quit", (event) => {
    if (quit.stage() === QUIT_STAGE.TORN_DOWN) return;
    event.preventDefault();
    void quit.teardown().finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
