import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createPackagerOptions,
  LICENSE_RESOURCE_NAME,
  MACOS_DEPLOYMENT_TARGET,
  MICROPHONE_USAGE_DESCRIPTION,
  PACKAGED_ARCHITECTURE,
  resolveSigningMode,
  SIGNING_MODE,
  SWIFT_TARGET_TRIPLE,
  swiftCompilerArguments,
} from "../apps/desktop/scripts/package-config.mjs";
import { packagedAppExecutable } from "../apps/desktop/scripts/package-layout.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const entitlementsPath = path.join(
  repoRoot,
  "apps",
  "desktop",
  "native",
  "macos",
  "entitlements.plist",
);

function packagerOptions(signing = resolveSigningMode({})) {
  return createPackagerOptions({
    appRoot: "/repo/apps/desktop",
    outputRoot: "/repo/apps/desktop/out",
    helperPath: "/repo/apps/desktop/.build/native/mac-screen-geometry",
    licensePath: `/repo/apps/desktop/.build/${LICENSE_RESOURCE_NAME}`,
    entitlementsPath,
    signing,
    version: "0.1.0",
  });
}

test("workspace package versions agree on v0.1.0", () => {
  const packagePaths = [
    "package.json",
    "apps/desktop/package.json",
    "apps/web/package.json",
    "packages/sidecar-core/package.json",
  ];
  const versions = packagePaths.map((packagePath) =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, packagePath), "utf8")),
  );

  assert.deepEqual(
    versions.map(({ version }) => version),
    packagePaths.map(() => "0.1.0"),
  );
});

test("packaging is pinned to Apple Silicon", () => {
  const options = packagerOptions();

  assert.equal(options.platform, "darwin");
  assert.equal(options.arch, PACKAGED_ARCHITECTURE);
  assert.equal(PACKAGED_ARCHITECTURE, "arm64");
  assert.equal(
    packagedAppExecutable("/repo"),
    path.join(
      "/repo",
      "apps",
      "desktop",
      "out",
      "Luke-darwin-arm64",
      "Luke.app",
      "Contents",
      "MacOS",
      "Luke",
    ),
  );
});

test("packaging declares the macOS deployment target", () => {
  const options = packagerOptions();
  const compilerArguments = swiftCompilerArguments("source.swift", "helper");

  assert.equal(MACOS_DEPLOYMENT_TARGET, "14.0");
  assert.equal(SWIFT_TARGET_TRIPLE, "arm64-apple-macos14.0");
  assert.equal(options.extendInfo.LSMinimumSystemVersion, MACOS_DEPLOYMENT_TARGET);
  assert.deepEqual(compilerArguments.slice(0, 4), [
    "swiftc",
    "-parse-as-library",
    "-target",
    SWIFT_TARGET_TRIPLE,
  ]);
});

test("packaging includes the Luke license and approved microphone description", () => {
  const options = packagerOptions();

  assert.equal(LICENSE_RESOURCE_NAME, "LUKE-LICENSE.txt");
  assert.equal(
    options.extraResource.some((resourcePath) => resourcePath.endsWith(LICENSE_RESOURCE_NAME)),
    true,
  );
  assert.equal(
    options.extendInfo.NSMicrophoneUsageDescription,
    "Luke uses microphone input to display live audio activity. Audio is processed locally and is not recorded or uploaded.",
  );
  assert.equal(options.extendInfo.NSMicrophoneUsageDescription, MICROPHONE_USAGE_DESCRIPTION);
});

test("signing configuration separates ad-hoc and Developer ID modes", () => {
  const adHocSigning = resolveSigningMode({});
  assert.deepEqual(adHocSigning, { mode: SIGNING_MODE.AD_HOC });
  assert.equal("osxSign" in packagerOptions(adHocSigning), false);

  const identity = "Developer ID Application: X (TEAM)";
  const developerIdSigning = resolveSigningMode({ LUKE_CODESIGN_IDENTITY: identity });
  const developerIdOptions = packagerOptions(developerIdSigning);
  assert.deepEqual(developerIdSigning, { mode: SIGNING_MODE.DEVELOPER_ID, identity });
  assert.equal(developerIdOptions.osxSign.identity, identity);
  assert.deepEqual(developerIdOptions.osxSign.optionsForFile(), {
    hardenedRuntime: true,
    entitlements: entitlementsPath,
  });
});

test("release entitlements allow microphone input", () => {
  const entitlements = fs.readFileSync(entitlementsPath, "utf8");
  assert.match(entitlements, /<key>com\.apple\.security\.device\.audio-input<\/key>/);
});
