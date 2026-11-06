import path from "node:path";
import type { AppLinkInbox } from "@repo/features/app-links";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { type RunMode, runModeFor } from "@repo/host";
import {
  buildCarriesDeveloperIdSigning,
  resolveAppName,
  resolveInstance,
} from "@repo/host/app-identity";
import { RUN_PROFILE } from "@repo/host/app-state";
import { buildCommit } from "@repo/host/build-commit";
import { type SentryEnvironment, sentryEnvironment } from "@repo/host/sentry-environment";
import type { MenuBarChange } from "./app-menu";
import type { DesktopConfig } from "./services/desktop-config";

export interface BootstrapApp {
  setName: (name: string) => void;
  getPath: (name: "appData") => string;
  setPath: (name: "userData" | "sessionData", directory: string) => void;
  getVersion: () => string;
  readonly isPackaged: boolean;
}

export interface BootstrapDependencies {
  app: BootstrapApp;
  argv: readonly string[];
  environment: NodeJS.ProcessEnv;
  resourceDirectory: string;
  report: (message: string) => void;
  openExternal: (url: string) => Promise<void>;
  quit: () => void;
  showMenuBar: (change?: MenuBarChange) => void;
  appLinks: AppLinkInbox;
  initializeCrashReporting: (runMode: RunMode, environment: SentryEnvironment) => void;
}

function argumentValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function bootstrapDesktop(dependencies: BootstrapDependencies): DesktopConfig {
  const { app, argv, environment } = dependencies;
  const requested = environment.APP_INSTANCE || undefined;
  const instance = resolveInstance({ packaged: app.isPackaged, requested });
  if (!app.isPackaged && requested !== undefined && instance === undefined) {
    dependencies.report(
      `APP_INSTANCE "${requested}" is not an instance name; running as the plain one`,
    );
  }
  const identity = {
    packaged: app.isPackaged,
    developerIdSigned: buildCarriesDeveloperIdSigning(),
  };
  const appName = resolveAppName({ ...identity, instance });
  app.setName(appName);
  const stateRoot = path.join(app.getPath("appData"), appName);
  app.setPath("userData", stateRoot);
  app.setPath("sessionData", stateRoot);

  const captureOutput = argumentValue(argv, "--capture-evidence");
  const fixtureName = argumentValue(argv, "--fixture");
  const captureMode = captureOutput !== undefined;
  const fixtureMode = captureMode || fixtureName !== undefined;
  const profile = argumentValue(argv, "--profile") ?? RUN_PROFILE.IDLE;
  const runMode = runModeFor({ capture: captureMode, fixture: fixtureName !== undefined });
  dependencies.initializeCrashReporting(runMode, sentryEnvironment(identity));

  const commit = buildCommit();

  const accountBaseUrl =
    (app.isPackaged ? undefined : environment.APP_ACCOUNT_BASE_URL) ?? `${LINK_ORIGIN}/api/auth`;

  return {
    stateRoot,
    ...(instance === undefined ? undefined : { instance }),
    runMode,
    appVersion: app.getVersion(),
    ...(commit ? { commit } : undefined),
    packaged: app.isPackaged,
    environment,
    platform: process.platform,
    resourceDirectory: dependencies.resourceDirectory,
    hostedServiceBaseUrl: accountBaseUrl.replace(/\/api\/auth\/?$/, ""),
    launch: {
      captureOutput,
      profile,
      captureMode,
      fixtureMode,
    },
    report: dependencies.report,
    openExternal: dependencies.openExternal,
    quit: dependencies.quit,
    showMenuBar: dependencies.showMenuBar,
    appLinks: dependencies.appLinks,
  };
}
