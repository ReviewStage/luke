import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  packagedAppExecutable,
  packageIgnorePatterns,
} from "../apps/desktop/scripts/package-layout.mjs";

function isIgnored(relativePath) {
  return packageIgnorePatterns.some((pattern) => pattern.test(relativePath));
}

test("packaging excludes source and workspace-only inputs", () => {
  for (const relativePath of [
    "/.build/native/helper",
    "/native/macos/ScreenGeometry.swift",
    "/node_modules/electron/index.js",
    "/out/Luke-darwin-arm64/Luke.app",
    "/scripts/build.mjs",
    "/src/main.ts",
    "/tests/window.test.ts",
    "/dist/main.js.map",
    "/pnpm-lock.yaml",
    "/tsconfig.json",
  ]) {
    assert.equal(isIgnored(relativePath), true, relativePath);
  }

  assert.equal(isIgnored("/dist/main.js"), false);
  assert.equal(isIgnored("/package.json"), false);
});

test("recording resolves the packaged app for the current architecture", () => {
  assert.equal(
    packagedAppExecutable("/repo", "x64"),
    path.join(
      "/repo",
      "apps",
      "desktop",
      "out",
      "Luke-darwin-x64",
      "Luke.app",
      "Contents",
      "MacOS",
      "Luke",
    ),
  );
});
