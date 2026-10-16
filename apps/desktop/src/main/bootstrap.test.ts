import assert from "node:assert/strict";
import path from "node:path";
import { appLinkInbox } from "@luke/features/app-links";
import { test } from "vitest";
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
    showMenuBar: () => undefined,
    initializeCrashReporting: () => undefined,
    appLinks: appLinkInbox(),
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
    showMenuBar: () => undefined,
    initializeCrashReporting: () => undefined,
    appLinks: appLinkInbox(),
  });
  assert.equal(packaged.hostedServiceBaseUrl, "https://tryluke.dev");
  assert.equal(packaged.runMode.sendsNetwork, true);
});

test("a named development instance keeps its state apart, and a packaged build has none", () => {
  const launch = (packaged: boolean, environment: NodeJS.ProcessEnv) =>
    bootstrapDesktop({
      app: recordingApp([], packaged),
      argv: [],
      environment,
      resourceDirectory: "/tmp/resources",
      report: () => undefined,
      openExternal: async () => undefined,
      quit: () => undefined,
      showMenuBar: () => undefined,
      initializeCrashReporting: () => undefined,
      appLinks: appLinkInbox(),
    });
  const plain = launch(false, {});
  const named = launch(false, { LUKE_INSTANCE: "preview" });
  assert.equal(plain.instance, undefined);
  assert.equal(named.instance, "preview");
  assert.notEqual(named.stateRoot, plain.stateRoot);
  const packaged = launch(true, { LUKE_INSTANCE: "preview" });
  assert.equal(packaged.instance, undefined);
  assert.equal(packaged.stateRoot, launch(true, {}).stateRoot);
});
