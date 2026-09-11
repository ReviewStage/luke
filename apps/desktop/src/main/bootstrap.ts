import path from "node:path";
import { type RunMode, runModeFor } from "@sidecar/host";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { buildCarriesDeveloperIdSigning, resolveAppName } from "./app-identity";
import type { DesktopConfig } from "./services/desktop-config";

/**
 * What the launch reads of Electron's own `app` before anything else exists.
 * It is a seam rather than the module itself for one reason: the order these
 * calls run in is the whole of what this file has to get right, and an order
 * is a value a test can read.
 */
export interface BootstrapApp {
  setName: (name: string) => void;
  getPath: (name: "appData" | "home") => string;
  setPath: (name: "userData" | "sessionData", directory: string) => void;
  getVersion: () => string;
  readonly isPackaged: boolean;
}

export interface BootstrapDependencies {
  app: BootstrapApp;
  argv: readonly string[];
  environment: NodeJS.ProcessEnv;
  /** Where this build's own files sit; the entry reads it from its own module. */
  resourceDirectory: string;
  report: (message: string) => void;
  openExternal: (url: string) => Promise<void>;
  quit: () => void;
  /**
   * The crash reporter, begun here rather than inside a service: Electron
   * spawns its GPU process during bootstrap, and the reporter has to stand
   * before a child process it is to file a minidump for. The one ordering it
   * owes is the paths' — it writes its own state under Luke's `userData` — so
   * it runs immediately after they move and before anything else exists.
   */
  initializeCrashReporting: (runMode: RunMode) => void;
}

/** Reads one `--name value` argument. */
function argumentValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * Everything the launch has to settle before Electron derives anything from
 * it, in the one order: which Luke this process is, where its state lives,
 * and the crash reporter over those paths. What it answers is the config every
 * service below is told, so nothing below reads an Electron global for a fact
 * established here.
 */
export function bootstrapDesktop(dependencies: BootstrapDependencies): DesktopConfig {
  const { app, argv, environment } = dependencies;
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

  const captureOutput = argumentValue(argv, "--capture-evidence");
  const fixtureName = argumentValue(argv, "--fixture");
  const captureMode = captureOutput !== undefined;
  const runMode = runModeFor({ capture: captureMode, fixture: fixtureName !== undefined });
  dependencies.initializeCrashReporting(runMode);

  // The introduction's mint lives on the same origin as the account service;
  // the one development override redirects both, and stops at packaging.
  const accountBaseUrl =
    (app.isPackaged ? undefined : environment.LUKE_ACCOUNT_BASE_URL) ??
    "https://tryluke.dev/api/auth";

  return {
    stateRoot,
    runMode,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    homeDirectory: app.getPath("home"),
    environment,
    platform: process.platform,
    resourceDirectory: dependencies.resourceDirectory,
    hostedServiceBaseUrl: accountBaseUrl.replace(/\/api\/auth\/?$/, ""),
    launch: {
      captureOutput,
      profile: argumentValue(argv, "--profile") ?? RUN_PROFILE.IDLE,
      fixtureName,
      startPeeked: argv.includes("--peek"),
      startInSlot: argv.includes("--slot"),
      captureMode,
      fixtureMode: captureMode || fixtureName !== undefined,
    },
    report: dependencies.report,
    openExternal: dependencies.openExternal,
    quit: dependencies.quit,
  };
}
