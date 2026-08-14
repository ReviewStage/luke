import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  APPLE_EVENTS_USAGE_DESCRIPTION,
  addonCompilerArguments,
  createPackagerOptions,
  ICONSET_SOURCES,
  iconutilArguments,
  LICENSE_RESOURCE_NAME,
  MACOS_DEPLOYMENT_TARGET,
  MICROPHONE_USAGE_DESCRIPTION,
  PACKAGED_ARCHITECTURE,
  resolveSigningMode,
  SIGNING_MODE,
  SWIFT_TARGET_TRIPLE,
  swiftCompilerArguments,
} from "../apps/desktop/scripts/package-config.mjs";
import { NATIVE_HELPERS, packagedAppExecutable } from "../apps/desktop/scripts/package-layout.mjs";

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
const iconPath = "/repo/apps/desktop/.build/Luke.icns";

function packagerOptions(signing = resolveSigningMode({})) {
  return createPackagerOptions({
    appRoot: "/repo/apps/desktop",
    outputRoot: "/repo/apps/desktop/out",
    helperPaths: [
      "/repo/apps/desktop/.build/native/mac-media-duck",
      "/repo/apps/desktop/.build/native/mac-microphone-use",
      "/repo/apps/desktop/.build/native/mac-output-volume",
      "/repo/apps/desktop/.build/native/mac-screen-geometry",
      "/repo/apps/desktop/.build/native/mac-talk-key",
      "/repo/apps/desktop/.build/native/mac-stationary-window.node",
    ],
    iconPath,
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

/**
 * The bundle carries the name macOS shows, and the manifest carries the name
 * Electron works from: `productName` is what it derives the user-data directory
 * and the Keychain entry from, falling back to the package name — which is
 * scoped, and would put Luke's own state two directories down inside `@luke`.
 * Nothing warns when the two disagree; the app just answers to one name in the
 * Finder and another in the Keychain, so they are held together here.
 */
test("the app answers to one name in the bundle and in Electron", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "apps", "desktop", "package.json"), "utf8"),
  );
  const options = packagerOptions();

  assert.equal(manifest.productName, "Luke");
  assert.equal(options.name, manifest.productName);
  assert.equal(options.executableName, manifest.productName);
  assert.equal(options.extendInfo.CFBundleDisplayName, manifest.productName);
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

test("every native helper is built and shipped, or neither happens", () => {
  const shipped = packagerOptions().extraResource;

  for (const helper of NATIVE_HELPERS) {
    assert.ok(
      shipped.some((resourcePath) => resourcePath.endsWith(helper.binary)),
      // A helper built but not bundled is a feature that works in development
      // and is simply absent from the app someone downloads.
      `${helper.binary} reaches the bundle`,
    );
    // A spawned helper is a Swift executable; an in-process addon is
    // Objective-C, loaded through Node-API, and named so the loader can tell.
    assert.ok(helper.source.endsWith(".swift") || helper.source.endsWith(".m"));
    assert.equal(helper.binary.endsWith(".node"), helper.source.endsWith(".m"));
    assert.ok(helper.frameworks.length > 0);
  }
});

test("the stationary window addon is compiled as a loadable Node-API module", () => {
  const stationary = NATIVE_HELPERS.find(
    (helper) => helper.binary === "mac-stationary-window.node",
  );

  assert.ok(stationary, "the stationary window addon is declared");
  const compilerArguments = addonCompilerArguments("s", "o", stationary.frameworks);
  assert.deepEqual(compilerArguments.slice(0, 3), ["clang", "-target", SWIFT_TARGET_TRIPLE]);
  assert.ok(compilerArguments.includes("-dynamiclib"));
  // Node-API symbols resolve from the Electron binary at load time, so the
  // link must be allowed to leave them undefined.
  assert.ok(compilerArguments.includes("-Wl,-undefined,dynamic_lookup"));
  // NSWindowCollectionBehaviorStationary is the whole reason the addon exists.
  assert.ok(compilerArguments.includes("AppKit"));
});

test("the microphone helper knows the bundle identifier Luke ships under", () => {
  const options = packagerOptions();
  const source = fs.readFileSync(
    path.join(repoRoot, "apps", "desktop", "src", "microphone-use.ts"),
    "utf8",
  );

  // The helper drops Luke's own processes by identifier prefix. A Luke that
  // has been renamed and not told about it there would read his own
  // conversation as a call the developer had just joined, for as long as it
  // stayed connected — so the two literals are held together here.
  assert.ok(
    source.includes(`"${options.appBundleId}"`),
    `LUKE_BUNDLE_PREFIXES carries ${options.appBundleId}`,
  );
});

test("the talk key is compiled against the framework that reads it", () => {
  const talkKey = NATIVE_HELPERS.find((helper) => helper.binary === "mac-talk-key");

  assert.ok(talkKey, "the talk key helper is declared");
  // Carbon is what `RegisterEventHotKey` lives in, and it is the whole reason
  // the helper exists: it reports a key being released without Accessibility.
  assert.ok(swiftCompilerArguments("s", "o", talkKey.frameworks).includes("Carbon"));
});

test("packaging includes the Luke license and approved microphone description", () => {
  const options = packagerOptions();

  assert.equal(LICENSE_RESOURCE_NAME, "LUKE-LICENSE.txt");
  assert.equal(
    options.extraResource.some((resourcePath) => resourcePath.endsWith(LICENSE_RESOURCE_NAME)),
    true,
  );
  // Spelled out rather than compared to the constant alone: this is the sentence
  // macOS shows when it asks for the microphone, so a change to it is a change
  // to what the user consented to and should not pass unnoticed.
  assert.equal(
    options.extendInfo.NSMicrophoneUsageDescription,
    "Luke uses the microphone for spoken conversation. Audio from a turn you start is sent to OpenAI to answer it, and is never recorded or written to disk.",
  );
  assert.equal(options.extendInfo.NSMicrophoneUsageDescription, MICROPHONE_USAGE_DESCRIPTION);
});

test("packaging includes the approved Apple Events description", () => {
  const options = packagerOptions();

  // Spelled out for the same reason the microphone's is: this is the sentence
  // macOS shows when it asks whether Luke may speak to Music or Spotify, so a
  // change to it is a change to what the user consented to.
  assert.equal(
    options.extendInfo.NSAppleEventsUsageDescription,
    "Luke turns Music and Spotify down while you are having a spoken conversation, and back up afterwards. He never pauses them, and reads nothing beyond whether each is playing and how loud.",
  );
  assert.equal(options.extendInfo.NSAppleEventsUsageDescription, APPLE_EVENTS_USAGE_DESCRIPTION);
});

test("packaging uses the generated Luke application icon", () => {
  assert.equal(packagerOptions().icon, iconPath);
});

test("the iconset maps every required macOS size to a consistent source PNG", () => {
  assert.deepEqual(Object.keys(ICONSET_SOURCES), [
    "icon_16x16.png",
    "icon_16x16@2x.png",
    "icon_32x32.png",
    "icon_32x32@2x.png",
    "icon_128x128.png",
    "icon_128x128@2x.png",
    "icon_256x256.png",
    "icon_256x256@2x.png",
    "icon_512x512.png",
    "icon_512x512@2x.png",
  ]);
  assert.deepEqual(ICONSET_SOURCES, {
    "icon_16x16.png": "luke-icon-dark-16.png",
    "icon_16x16@2x.png": "luke-icon-dark-32.png",
    "icon_32x32.png": "luke-icon-dark-32.png",
    "icon_32x32@2x.png": "luke-icon-dark-64.png",
    "icon_128x128.png": "luke-icon-dark-128.png",
    "icon_128x128@2x.png": "luke-icon-dark-256.png",
    "icon_256x256.png": "luke-icon-dark-256.png",
    "icon_256x256@2x.png": "luke-icon-dark-512.png",
    "icon_512x512.png": "luke-icon-dark-512.png",
    "icon_512x512@2x.png": "luke-icon-dark-1024.png",
  });
});

test("every iconset source PNG is committed", () => {
  const brandIconDirectory = path.join(repoRoot, "design", "brand", "icon");

  for (const sourceName of new Set(Object.values(ICONSET_SOURCES))) {
    assert.equal(
      fs.existsSync(path.join(brandIconDirectory, sourceName)),
      true,
      `${sourceName} is missing`,
    );
  }
});

test("iconutil receives explicit input and output paths", () => {
  assert.deepEqual(iconutilArguments("/tmp/luke.iconset", "/tmp/Luke.icns"), [
    "-c",
    "icns",
    "/tmp/luke.iconset",
    "-o",
    "/tmp/Luke.icns",
  ]);
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

test("release entitlements allow required capabilities without unsigned executable memory", () => {
  const entitlements = fs.readFileSync(entitlementsPath, "utf8");
  assert.doesNotMatch(
    entitlements,
    /<key>com\.apple\.security\.cs\.allow-unsigned-executable-memory<\/key>/,
  );
  assert.match(entitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>/);
  assert.match(entitlements, /<key>com\.apple\.security\.device\.audio-input<\/key>/);
  // Apple Events are what the media duck speaks: without this, a hardened
  // build fails the first duck rather than asking the user.
  assert.match(entitlements, /<key>com\.apple\.security\.automation\.apple-events<\/key>/);
});
