import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";
import { DEVELOPMENT_APP_NAME } from "./app-identity";
import { type BootstrapApp, bootstrapDesktop } from "./bootstrap";

/** Every call the bootstrap makes of Electron's app, in the order it made them. */
const recordingApp = (
  steps: string[],
  packaged = false,
): BootstrapApp & { readonly isPackaged: boolean } => ({
  isPackaged: packaged,
  setName: (name) => {
    steps.push(`setName:${name}`);
  },
  getPath: (name) => {
    steps.push(`getPath:${name}`);
    return path.join("/tmp", name);
  },
  setPath: (name) => {
    steps.push(`setPath:${name}`);
  },
  getVersion: () => "0.0.0-test",
});

const bootstrap = (
  steps: string[],
  argv: readonly string[] = [],
  packaged = false,
): ReturnType<typeof bootstrapDesktop> =>
  bootstrapDesktop({
    app: recordingApp(steps, packaged),
    argv,
    environment: {},
    resourceDirectory: "/tmp/resources",
    report: () => undefined,
    openExternal: async () => undefined,
    quit: () => undefined,
    initializeCrashReporting: () => {
      steps.push("crashReporting");
    },
  });

test("the crash reporter is initialized only once both paths have moved", () => {
  // The reporter writes its own state under Luke's `userData`, so it must
  // stand after the paths move; it must also stand before Electron spawns a
  // child process it is to file a minidump for, which is why it is here at all
  // rather than inside a service that starts later.
  const steps: string[] = [];
  bootstrap(steps);
  assert.deepEqual(steps.slice(0, 2), [`setName:${DEVELOPMENT_APP_NAME}`, "getPath:appData"]);
  assert.deepEqual(steps.slice(2, 5), [
    "setPath:userData",
    "setPath:sessionData",
    "crashReporting",
  ]);
  assert.equal(steps.indexOf("crashReporting") < steps.indexOf("getPath:home"), true);
});

test("the state root is the moved path, and the launch's flags are read from its own arguments", () => {
  const steps: string[] = [];
  const config = bootstrap(steps, [
    "electron",
    ".",
    "--fixture",
    "smoke",
    "--profile",
    "working",
    "--peek",
  ]);
  assert.equal(config.stateRoot, path.join("/tmp", "appData", DEVELOPMENT_APP_NAME));
  assert.equal(config.launch.fixtureName, "smoke");
  assert.equal(config.launch.profile, "working");
  assert.equal(config.launch.startPeeked, true);
  assert.equal(config.launch.startInSlot, false);
  assert.equal(config.launch.captureMode, false);
  assert.equal(config.launch.fixtureMode, true);
  assert.equal(config.runMode.sendsNetwork, false);
});

test("an evidence run is a capture run, and neither observes nor sends", () => {
  const steps: string[] = [];
  const config = bootstrap(steps, ["--capture-evidence", "/tmp/evidence.png"]);
  assert.equal(config.launch.captureOutput, "/tmp/evidence.png");
  assert.equal(config.launch.captureMode, true);
  assert.equal(config.launch.fixtureMode, true);
  assert.equal(config.runMode.sendsNetwork, false);
  assert.equal(config.runMode.observesProviders, false);
});

test("the account override is read in a development run and never in a packaged one", () => {
  const steps: string[] = [];
  const development = bootstrapDesktop({
    app: recordingApp(steps),
    argv: [],
    environment: { LUKE_ACCOUNT_BASE_URL: "https://example.invalid/api/auth" },
    resourceDirectory: "/tmp/resources",
    report: () => undefined,
    openExternal: async () => undefined,
    quit: () => undefined,
    initializeCrashReporting: () => undefined,
  });
  assert.equal(development.hostedServiceBaseUrl, "https://example.invalid");
  const packaged = bootstrapDesktop({
    app: recordingApp(steps, true),
    argv: [],
    environment: { LUKE_ACCOUNT_BASE_URL: "https://example.invalid/api/auth" },
    resourceDirectory: "/tmp/resources",
    report: () => undefined,
    openExternal: async () => undefined,
    quit: () => undefined,
    initializeCrashReporting: () => undefined,
  });
  assert.equal(packaged.hostedServiceBaseUrl, "https://tryluke.dev");
  assert.equal(packaged.runMode.sendsNetwork, true);
});
