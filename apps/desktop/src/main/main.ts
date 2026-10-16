import { appLinkInArguments, appLinkInbox } from "@luke/features/app-links";
import { closeEveryMacTerminal } from "@luke/host/mac-terminal";
import { desktopQuit, QUIT_STAGE } from "@luke/host/quit";
import { reportToStderr, tolerateClosedStderr } from "@luke/host/stderr-report";
import { Duration, Effect, Fiber, ManagedRuntime, Option } from "effect";
import { app, Menu, protocol, shell } from "electron";
import { menuBarDrawer } from "./app-menu";
import { bootstrapDesktop } from "./bootstrap";
import { composeDesktop, DesktopTag } from "./services/compose-desktop";
import { initializeCrashReporting } from "./services/telemetry-service";
import { PAGE_SCHEME_PRIVILEGES } from "./window/page-protocol";

/**
 * The desktop client's entry: the process that draws. It owns the windows,
 * the keys, the Dock, the native helpers this machine's devices answer
 * through, and the updater that replaces this binary; it reaches everything
 * else — the settings, the account, the voice session, the plans — through
 * the Gateway as one operator, and offers this machine's native capabilities back to the host as
 * one node. The host it operates is composed here, in this process.
 *
 * This is the one place in the process that runs an Effect. Everything of the
 * launch is one `Layer`, built on one `ManagedRuntime`: building it is the
 * whole standup, and disposing it is the whole quit.
 *
 * Nothing of the launch happens while these modules load. What is at module
 * scope here is only what has to be settled before Electron derives anything
 * from it — the name, the paths, and the crash reporter over them — and the
 * single-instance lock, which the losing copy must lose having touched
 * nothing, the scheme a plan's pages are served on, which Electron reads
 * once before it is ready, and the Luke links macOS hands the app, the one
 * that launched it arriving before it is ready. Everything else is composed
 * and then started, in `main`.
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

// A Luke link macOS hands the app (`tryluke://`) is heard from the first
// moment, since the one that launched the app arrives before it is ready,
// and held until a window can open it (`@luke/features/app-links`).
const appLinks = appLinkInbox();
app.on("open-url", (event, url) => {
  event.preventDefault();
  appLinks.arrive(url);
});
// A second launch hands its link here even before the windows stand to bring
// this one forward, which they do once they listen.
app.on("second-instance", (_event, argv) => {
  const link = appLinkInArguments(argv);
  if (link !== undefined) appLinks.arrive(link);
});
const launchedWith = appLinkInArguments(process.argv);
if (launchedWith !== undefined) appLinks.arrive(launchedWith);

const config = bootstrapDesktop({
  app,
  argv: process.argv,
  environment: process.env,
  resourceDirectory: __dirname,
  report: reportToStderr,
  openExternal: (url) => shell.openExternal(url),
  quit: () => app.quit(),
  showMenuBar: menuBarDrawer({ appName: app.name, packaged: app.isPackaged }, (template) =>
    Menu.setApplicationMenu(Menu.buildFromTemplate(template)),
  ),
  initializeCrashReporting,
  appLinks,
});
tolerateClosedStderr();
// A plan's pages are served on a scheme of their own, which Electron must be
// told of before the app is ready (`window/page-protocol.ts`).
protocol.registerSchemesAsPrivileged([PAGE_SCHEME_PRIVILEGES]);

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
    const closing = yield* Effect.forkDetach(runtime.disposeEffect);
    const closed = yield* Effect.timeoutOption(
      Fiber.join(closing),
      Duration.millis(RUNTIME_CLOSE_WAIT_MS),
    );
    if (Option.isNone(closed)) {
      config.report("the runtime did not close in time; leaving it to the exit");
    }
  });

// One Luke per machine, decided before any window, host, or composition work:
// the losing copy must exit having claimed no global shortcut and opened no
// window.
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
  // Luke is an ordinary app with a window of its own: the bundle gives him a
  // Dock tile and a place in Command-Tab, and these menus give its fields Copy
  // and Paste, its window Close, Minimize, and Quit, and its own commands
  // their shortcuts.
  // The update item joins once the updater has said where it stands.
  config.showMenuBar();

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
    // Every terminal of this Mac Luke opened is hung up, with what it started, before anything else is let go.
    closeEveryMacTerminal();
    if (quit.stage() === QUIT_STAGE.TORN_DOWN) return;
    event.preventDefault();
    // A quit a hold asks about first is asked for again once it is agreed to.
    if (quit.held()) return;
    void quit.teardown().finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
