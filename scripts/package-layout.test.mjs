import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { packagedAppExecutable, packagedAppPath } from "../apps/desktop/scripts/package-layout.mjs";

test("recording resolves the electron-builder app for the current architecture", () => {
  assert.equal(
    packagedAppPath("/repo", "x64"),
    path.join("/repo", "artifacts", "release-builder", "mac-x64", "Luke.app"),
  );
  assert.equal(
    packagedAppExecutable("/repo", "x64"),
    path.join(
      "/repo",
      "artifacts",
      "release-builder",
      "mac-x64",
      "Luke.app",
      "Contents",
      "MacOS",
      "Luke",
    ),
  );
});
