import { appLinkInArguments, appLinkInbox } from "@repo/features/app-links";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { launchFailureReported } from "@repo/features/sentry-reporting";
import { reportToStderr, tolerateClosedStderr } from "@repo/host/node";
import { desktopQuit, QUIT_STAGE } from "@repo/host/quit";
import { Duration, Effect, Fiber, ManagedRuntime, Option } from "effect";
import { app, Menu, protocol, shell } from "electron";
import { menuBarDrawer } from "./app-menu";
import { bootstrapDesktop } from "./bootstrap";
import { offerMoveToApplications } from "./move-to-applications";
import { composeDesktop, DesktopTag } from "./services/compose-desktop";
import { initializeCrashReporting, mainSentry } from "./services/telemetry-service";
import { PAGE_SCHEME_PRIVILEGES } from "./window/page-protocol";

const RUNTIME_CLOSE_WAIT_MS = 15_000;

const appLinks = appLinkInbox();
app.on("open-url", (event, url) => {
  event.preventDefault();
  appLinks.arrive(url);
});
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
protocol.registerSchemesAsPrivileged([PAGE_SCHEME_PRIVILEGES]);
app.commandLine.appendSwitch("force-color-profile", "srgb");

const quit = desktopQuit();

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

if (app.requestSingleInstanceLock()) {
  void main();
} else {
  reportToStderr(
    `${PRODUCT_NAME} is already running; the existing panel was refreshed instead of starting a second copy.`,
  );
  app.quit();
}

async function main(): Promise<void> {
  await app.whenReady();
  if (await offerMoveToApplications(config)) return;
  config.showMenuBar();

  const runtime = ManagedRuntime.make(composeDesktop(config, quit));
  quit.closesThrough(() => Effect.runPromise(closeRuntime(runtime)));
  registerQuit();
  try {
    await runtime.runPromise(DesktopTag);
  } catch (error) {
    if (!quit.launchStanding()) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    config.report(`the runtime could not stand up: ${failure.message}`);
    await Effect.runPromise(launchFailureReported(mainSentry, failure));
    app.quit();
  }
}

function registerQuit(): void {
  app.on("before-quit", (event) => {
    if (quit.stage() === QUIT_STAGE.TORN_DOWN) return;
    event.preventDefault();
    if (quit.held()) return;
    void quit.teardown().finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
