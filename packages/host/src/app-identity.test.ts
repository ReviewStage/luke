import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { test } from "vitest";
import { AD_HOC_APP_NAME, resolveAppName, resolveInstance } from "./app-identity.js";

/** `scripts/lib/workspace.sh`, which `run.sh` finds and names instances through. */
const WORKSPACE_SCRIPT = fileURLToPath(
  new URL("../../../scripts/lib/workspace.sh", import.meta.url),
);

/** Runs `body` in bash with the workspace helpers sourced, under `home` where given. */
function workspace(body: string, home?: string) {
  const ran = spawnSync("bash", ["-c", `source "$0"; ${body}`, WORKSPACE_SCRIPT], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home ?? process.env.HOME },
  });
  return { status: ran.status, stdout: ran.stdout.trim(), stderr: ran.stderr.trim() };
}

const development = (instance?: string) =>
  resolveAppName({ packaged: false, developerIdSigned: false, instance });

test("an ad-hoc package is isolated from unpackaged development credentials", () => {
  assert.equal(resolveAppName({ packaged: true, developerIdSigned: false }), AD_HOC_APP_NAME);
});

test("a named development instance answers to a name of its own, and a packaged build to none", () => {
  const instance = resolveInstance({ packaged: false, requested: "preview" });
  assert.equal(instance, "preview");
  assert.notEqual(development(instance), development());
  assert.equal(resolveInstance({ packaged: true, requested: "preview" }), undefined);
  assert.equal(
    resolveAppName({ packaged: true, developerIdSigned: true, instance: "preview" }),
    resolveAppName({ packaged: true, developerIdSigned: true }),
  );
});

test("a malformed instance name runs as the plain development instance", () => {
  for (const requested of ["Preview", "a--b", "-a", "a/b", "a".repeat(49), ""]) {
    assert.equal(resolveInstance({ packaged: false, requested }), undefined, requested);
  }
});

test("the run script names each instance as the app does", () => {
  assert.equal(workspace("luke_app_names | head -n 1").stdout, development());
  assert.equal(workspace("luke_instance_app_name preview").stdout, development("preview"));
});

test("a preview run is named for its branch, or for the host given, in a name the app takes", () => {
  const cases = [
    {
      branch: "luke/Task_Comments.Inbox",
      address: "https://luke-git-x-acme.vercel.app/",
      expected: "preview-luke-task-comments-inbox",
    },
    {
      branch: "",
      address: "https://luke-abc123-acme.vercel.app",
      expected: "preview-luke-abc123-acme",
    },
  ];
  for (const { branch, address, expected } of cases) {
    const named = workspace(`luke_preview_instance "${address}" "${branch}"`).stdout;
    assert.equal(named, expected);
    assert.equal(resolveInstance({ packaged: false, requested: named }), named);
  }
  const long = workspace(
    `luke_preview_instance https://a.vercel.app "feature/${"long-branch-".repeat(8)}"`,
  ).stdout;
  assert.equal(resolveInstance({ packaged: false, requested: long }), long);
});

test("a named launch replaces only its own instance, and the plain launch never a named one", async (t) => {
  const home = await temporaryDirectory(t, "luke-instances-");
  // A lock held by a live process that is not Luke, which the script reports rather than stops.
  const holdLock = (appName: string) => {
    const directory = join(home, "Library", "Application Support", appName);
    mkdirSync(directory, { recursive: true });
    symlinkSync(`${hostname()}-${process.pid}`, join(directory, "SingletonLock"));
  };

  holdLock(development());
  assert.equal(workspace("luke_stop_running_app preview", home).status, 0);
  assert.match(workspace("luke_stop_running_app", home).stderr, /holds the "Luke Dev" lock/);

  holdLock(development("preview"));
  assert.match(
    workspace("luke_stop_running_app preview", home).stderr,
    /holds the "Luke Dev preview" lock/,
  );
  assert.equal(workspace("luke_stop_running_app other", home).status, 0);
});
