import path from "node:path";
import { runModeFor } from "@sidecar/host";
import { app, Menu, shell } from "electron";
import { buildCarriesDeveloperIdSigning, resolveAppName } from "./app-identity";
import { registerDesktopIpc } from "./ipc/register-desktop-ipc";
import { composeDesktop, type DesktopServices } from "./services/compose-desktop";
import type { DesktopConfig } from "./services/desktop-config";
import { initializeCrashReporting } from "./services/telemetry-service";

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
 * Nothing of the launch happens while these modules load. What is at module
 * scope here is only what has to be settled before Electron derives anything
 * from it — the name, the paths, and the crash reporter over them — and the
 * single-instance lock, which the losing copy must lose having touched
 * nothing. Everything else is composed and then started, in `main`.
 */

/** Reads one `--name value` argument. */
function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// Which Luke this process is decides where its state lives and which Keychain
// entry protects its credentials; see app-identity.ts for why a development
// run must never share the release's. Applied before anything derives a path.
const appName = resolveAppName({
  packaged: app.isPackaged,
  developerIdSigned: buildCarriesDeveloperIdSigning(),
});
app.setName(appName);
const stateRoot = path.join(app.getPath("appData"), appName);
app.setPath("userData", stateRoot);
app.setPath("sessionData", stateRoot);

const captureOutput = argumentValue("--capture-evidence");
const fixtureName = argumentValue("--fixture");
const captureMode = captureOutput !== undefined;
const runMode = runModeFor({ capture: captureMode, fixture: fixtureName !== undefined });
initializeCrashReporting(runMode);

// The introduction's mint lives on the same origin as the account service;
// the one development override redirects both, and stops at packaging.
const ACCOUNT_BASE_URL =
  (app.isPackaged ? undefined : process.env.LUKE_ACCOUNT_BASE_URL) ??
  "https://tryluke.dev/api/auth";

const config: DesktopConfig = {
  stateRoot,
  runMode,
  appVersion: app.getVersion(),
  packaged: app.isPackaged,
  homeDirectory: app.getPath("home"),
  environment: process.env,
  platform: process.platform,
  resourceDirectory: __dirname,
  hostedServiceBaseUrl: ACCOUNT_BASE_URL.replace(/\/api\/auth\/?$/, ""),
  launch: {
    captureOutput,
    profile: argumentValue("--profile") ?? "idle",
    fixtureName,
    startPeeked: process.argv.includes("--peek"),
    startInSlot: process.argv.includes("--slot"),
    captureMode,
    fixtureMode: captureMode || fixtureName !== undefined,
  },
  report: (message) => process.stderr.write(`${message}\n`),
  openExternal: (url) => shell.openExternal(url),
  quit: () => app.quit(),
};

// One Luke per machine, decided before any window, host, or composition work:
// the losing copy must exit having started no second store worker, claimed no
// global shortcut, and opened no window.
if (app.requestSingleInstanceLock()) {
  void main();
} else {
  process.stderr.write(
    "Luke is already running; the existing panel was refreshed instead of starting a second copy.\n",
  );
  app.quit();
}

async function main(): Promise<void> {
  await app.whenReady();
  // A window created under the default activation policy flashes a Dock tile,
  // so both are settled before anything opens one.
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  Menu.setApplicationMenu(null);

  const services = composeDesktop(config);
  registerQuit(services);
  registerDesktopIpc(services);
  try {
    await services.start();
  } catch (error) {
    // A start that cannot finish leaves nothing to draw, so this process
    // gives back what it did arm and goes, rather than sitting on the
    // single-instance lock with no window and no way for the next launch in.
    // The quit below is what drains the host, in the one order.
    config.report(
      `the runtime could not stand up: ${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
  }
}

/**
 * The whole quit: every service gives back what it began, in the reverse of
 * the order it began in, and the host's drain is one of those steps — so no
 * runtime work of Luke's continues after an intentional quit. The first ask
 * is held open for the teardown; the quit it makes afterwards is the one that
 * leaves.
 *
 * A quit arriving after the teardown has finished is never held, and the
 * updater's restart depends on it: Squirrel's own quit must reach the
 * installer, and a prevented `before-quit` aborts the update. So the updater
 * runs the same teardown itself and only then hands over, which is why what
 * is read here is whether one has finished rather than whether one is owed.
 */
function registerQuit(services: DesktopServices): void {
  app.on("before-quit", (event) => {
    if (services.stopped()) return;
    event.preventDefault();
    void services.stop().finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
