import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createElectronBuilderConfig,
  ELECTRON_BUILDER_UPDATE_CACHE_DIR_NAME,
  ELECTRON_BUILDER_UPDATE_FEED_URL,
  ELECTRON_BUILDER_UPDATE_PUBLISH_CONFIG,
} from "../apps/desktop/scripts/electron-builder-config.mjs";
import {
  APP_UPDATE_CACHE_DIR_NAME,
  APP_UPDATE_CONFIG_FILE_NAME,
  APP_UPDATE_FEED_URL,
  APPLE_EVENTS_USAGE_DESCRIPTION,
  addonCompilerArguments,
  appleCalendarHelperInfoPlist,
  appUpdateConfig,
  CALENDARS_USAGE_DESCRIPTION,
  CALENDARS_USAGE_KEYS,
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
  signingModeDefine,
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
      "/repo/apps/desktop/.build/native/Luke.app",
      "/repo/apps/desktop/.build/native/mac-media-duck",
      "/repo/apps/desktop/.build/native/mac-microphone-route",
      "/repo/apps/desktop/.build/native/mac-output-volume",
      "/repo/apps/desktop/.build/native/mac-screen-geometry",
      "/repo/apps/desktop/.build/native/mac-talk-key",
      "/repo/apps/desktop/.build/native/mac-stationary-window.node",
    ],
    iconPath,
    licensePath: `/repo/apps/desktop/.build/${LICENSE_RESOURCE_NAME}`,
    appUpdateConfigPath: `/repo/apps/desktop/.build/${APP_UPDATE_CONFIG_FILE_NAME}`,
    entitlementsPath,
    signing,
    version: "0.3.6",
  });
}

function builderConfig(env = {}) {
  return createElectronBuilderConfig(env);
}

test("the bundle carries the updater config electron-updater reads before every download", () => {
  // Setting the feed at runtime does not spare app-update.yml: the download
  // step reads updaterCacheDirName from the bundle's own Resources, so a
  // package without it finds an update and then fails with ENOENT.
  assert.ok(
    packagerOptions().extraResource.some((resourcePath) =>
      resourcePath.endsWith(APP_UPDATE_CONFIG_FILE_NAME),
    ),
  );
  const config = appUpdateConfig();
  assert.ok(config.includes("provider: generic"));
  assert.ok(config.includes(`url: ${APP_UPDATE_FEED_URL}`));
  assert.ok(config.includes(`updaterCacheDirName: ${APP_UPDATE_CACHE_DIR_NAME}`));

  // The bundled config and the runtime feed must name the same address, or a
  // packaged build would read one feed and cache under another's rules.
  const updateService = fs.readFileSync(
    path.join(repoRoot, "apps", "desktop", "src", "main", "update-service.ts"),
    "utf8",
  );
  assert.ok(
    updateService.includes(`UPDATE_FEED_URL: "${APP_UPDATE_FEED_URL}"`),
    "src/main/update-service.ts UPDATE_ENDPOINT.UPDATE_FEED_URL must equal APP_UPDATE_FEED_URL",
  );
});

test("workspace package versions agree on v0.3.6", () => {
  // Enumerated rather than listed, so a package added to the workspace is held
  // to the release version without anyone remembering to name it here.
  const packagePaths = [
    "package.json",
    "apps/desktop/package.json",
    "apps/web/package.json",
    ...fs
      .readdirSync(path.join(repoRoot, "packages"), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(repoRoot, "packages", entry.name, "package.json")),
      )
      .map((entry) => entry.name)
      .sort()
      .map((name) => `packages/${name}/package.json`),
  ];
  const versions = packagePaths.map((packagePath) =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, packagePath), "utf8")),
  );

  assert.deepEqual(
    versions.map(({ version }) => version),
    packagePaths.map(() => "0.3.6"),
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

test("electron-builder answers to the same application identity", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "apps", "desktop", "package.json"), "utf8"),
  );
  const config = builderConfig();

  assert.equal(config.productName, manifest.productName);
  assert.equal(config.mac.executableName, manifest.productName);
  assert.equal(config.mac.extendInfo.CFBundleName, manifest.productName);
  assert.equal(config.mac.extendInfo.CFBundleDisplayName, manifest.productName);
  assert.equal(config.appId, "dev.reviewstage.luke");
});

test("electron-builder generates the updater config electron-updater reads before downloads", () => {
  const config = builderConfig();
  const [appUpdatePublishConfig] = config.publish;
  const updateService = fs.readFileSync(
    path.join(repoRoot, "apps", "desktop", "src", "main", "update-service.ts"),
    "utf8",
  );

  assert.deepEqual(appUpdatePublishConfig, ELECTRON_BUILDER_UPDATE_PUBLISH_CONFIG);
  assert.equal(ELECTRON_BUILDER_UPDATE_FEED_URL, APP_UPDATE_FEED_URL);
  assert.equal(ELECTRON_BUILDER_UPDATE_CACHE_DIR_NAME, APP_UPDATE_CACHE_DIR_NAME);
  assert.equal(appUpdatePublishConfig.provider, "generic");
  assert.equal(appUpdatePublishConfig.url, APP_UPDATE_FEED_URL);
  assert.equal(appUpdatePublishConfig.updaterCacheDirName, APP_UPDATE_CACHE_DIR_NAME);
  assert.equal(config.extraMetadata.name, "luke");
  assert.equal(`${config.extraMetadata.name}-updater`, APP_UPDATE_CACHE_DIR_NAME);
  assert.ok(
    updateService.includes(`UPDATE_FEED_URL: "${APP_UPDATE_FEED_URL}"`),
    "src/main/update-service.ts UPDATE_ENDPOINT.UPDATE_FEED_URL must match app-update.yml",
  );
});

test("packaging is pinned to Apple Silicon", () => {
  const options = packagerOptions();
  const config = builderConfig();

  assert.equal(options.platform, "darwin");
  assert.equal(options.arch, PACKAGED_ARCHITECTURE);
  assert.equal(PACKAGED_ARCHITECTURE, "arm64");
  assert.equal(config.mac.target, "default");
  const versionMacro = "$" + "{version}";
  const archMacro = "$" + "{arch}";
  const extensionMacro = "$" + "{ext}";
  assert.equal(
    config.mac.artifactName,
    `Luke-${versionMacro}-macos-${archMacro}.${extensionMacro}`,
  );
  assert.equal(config.dmg.artifactName, `Luke-${versionMacro}-${archMacro}.${extensionMacro}`);
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
  const config = builderConfig();
  const compilerArguments = swiftCompilerArguments("source.swift", "helper");

  assert.equal(MACOS_DEPLOYMENT_TARGET, "14.0");
  assert.equal(SWIFT_TARGET_TRIPLE, "arm64-apple-macos14.0");
  assert.equal(options.extendInfo.LSMinimumSystemVersion, MACOS_DEPLOYMENT_TARGET);
  assert.equal(config.mac.minimumSystemVersion, MACOS_DEPLOYMENT_TARGET);
  assert.equal(config.mac.extendInfo.LSMinimumSystemVersion, MACOS_DEPLOYMENT_TARGET);
  assert.deepEqual(compilerArguments.slice(0, 4), [
    "swiftc",
    "-parse-as-library",
    "-target",
    SWIFT_TARGET_TRIPLE,
  ]);
});

test("every native helper is built and shipped, or neither happens", () => {
  const shipped = packagerOptions().extraResource;
  const config = builderConfig();
  const builderShipped = config.extraResources.slice(0, NATIVE_HELPERS.length);
  const builderBinaries = config.mac.binaries;

  for (const helper of NATIVE_HELPERS) {
    assert.ok(
      shipped.some((resourcePath) => resourcePath.endsWith(helper.bundle ?? helper.binary)),
      // A helper built but not bundled is a feature that works in development
      // and is simply absent from the app someone downloads.
      `${helper.binary} reaches the bundle`,
    );
    const builderResource = builderShipped.find(
      (resource) => resource.to === (helper.bundle ?? helper.binary),
    );
    assert.ok(builderResource, `${helper.binary} reaches the electron-builder bundle`);
    assert.ok(
      builderResource.from.endsWith(helper.bundle ?? helper.binary),
      `${helper.binary} is copied from its built output`,
    );
    const explicitlySigned = builderBinaries.some((resourcePath) =>
      resourcePath.endsWith(helper.binary),
    );
    assert.equal(
      explicitlySigned,
      helper.bundle === undefined,
      helper.bundle
        ? `${helper.bundle} is signed as a nested app bundle, not again as a loose binary`
        : `${helper.binary} is signed explicitly by electron-builder`,
    );
    // A spawned helper is a Swift executable; an in-process addon is
    // Objective-C, loaded through Node-API, and named so the loader can tell.
    assert.ok(helper.source.endsWith(".swift") || helper.source.endsWith(".m"));
    assert.equal(helper.binary.endsWith(".node"), helper.source.endsWith(".m"));
    assert.ok(helper.frameworks.length > 0);
  }
});

test("the calendar helper's bundle names itself Luke and carries the usage sentences", () => {
  // The helper answers to TCC as itself, so its bundle's Info.plist is what
  // the consent dialog is judged against and named from — and macOS may fall
  // back to the process name or the folder's basename, so the executable and
  // the bundle folder are both named Luke.
  const calendarHelper = NATIVE_HELPERS.find((helper) => helper.source === "AppleCalendar.swift");
  assert.equal(calendarHelper?.bundle, "Luke.app");
  assert.equal(calendarHelper?.binary, "Luke");

  // Every key macOS may look the sentence up under, in the helper and the
  // app alike; the same sentence everywhere, so the dialog can never say two
  // different things depending on which binary asked.
  const plist = appleCalendarHelperInfoPlist();
  const extendInfo = packagerOptions().extendInfo;
  const builderExtendInfo = builderConfig().mac.extendInfo;
  for (const key of CALENDARS_USAGE_KEYS) {
    assert.ok(plist.includes(`<key>${key}</key>`));
    assert.equal(extendInfo[key], CALENDARS_USAGE_DESCRIPTION);
    assert.equal(builderExtendInfo[key], CALENDARS_USAGE_DESCRIPTION);
  }
  assert.ok(plist.includes(CALENDARS_USAGE_DESCRIPTION));
  assert.ok(plist.includes("<key>CFBundleIdentifier</key>"));
  assert.ok(plist.includes("<key>CFBundleExecutable</key>\n\t<string>Luke</string>"));
  assert.ok(plist.includes("<key>CFBundleDisplayName</key>\n\t<string>Luke</string>"));
  // The System Settings consent row draws the bundle's own icon.
  assert.ok(plist.includes("<key>CFBundleIconFile</key>\n\t<string>Luke.icns</string>"));
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

test("the talk key is compiled against the framework that reads it", () => {
  const talkKey = NATIVE_HELPERS.find((helper) => helper.binary === "mac-talk-key");

  assert.ok(talkKey, "the talk key helper is declared");
  // Carbon is what `RegisterEventHotKey` lives in, and it is the whole reason
  // the helper exists: it reports a key being released without Accessibility.
  assert.ok(swiftCompilerArguments("s", "o", talkKey.frameworks).includes("Carbon"));
});

test("packaging includes the Luke license and approved microphone description", () => {
  const options = packagerOptions();
  const config = builderConfig();
  const licenseResource = config.extraResources.at(-1);

  assert.equal(LICENSE_RESOURCE_NAME, "LUKE-LICENSE.txt");
  assert.equal(
    options.extraResource.some((resourcePath) => resourcePath.endsWith(LICENSE_RESOURCE_NAME)),
    true,
  );
  assert.deepEqual(licenseResource, {
    from: path.join(repoRoot, "apps", "desktop", ".build", LICENSE_RESOURCE_NAME),
    to: LICENSE_RESOURCE_NAME,
  });
  // Spelled out rather than compared to the constant alone: this is the sentence
  // macOS shows when it asks for the microphone, so a change to it is a change
  // to what the user consented to and should not pass unnoticed.
  assert.equal(
    options.extendInfo.NSMicrophoneUsageDescription,
    "Luke uses the microphone for spoken conversation. Audio from a turn you start is sent to OpenAI to answer it, and is never recorded or written to disk.",
  );
  assert.equal(options.extendInfo.NSMicrophoneUsageDescription, MICROPHONE_USAGE_DESCRIPTION);
  assert.equal(config.mac.extendInfo.NSMicrophoneUsageDescription, MICROPHONE_USAGE_DESCRIPTION);
});

test("packaging includes the approved Apple Events description", () => {
  const options = packagerOptions();
  const config = builderConfig();

  // Spelled out for the same reason the microphone's is: this is the sentence
  // macOS shows when it asks whether Luke may speak to Music or Spotify, so a
  // change to it is a change to what the user consented to.
  assert.equal(
    options.extendInfo.NSAppleEventsUsageDescription,
    "Luke turns Music and Spotify down while you are having a spoken conversation, and back up afterwards. He never pauses them, and reads nothing beyond whether each is playing and how loud.",
  );
  assert.equal(options.extendInfo.NSAppleEventsUsageDescription, APPLE_EVENTS_USAGE_DESCRIPTION);
  assert.equal(config.mac.extendInfo.NSAppleEventsUsageDescription, APPLE_EVENTS_USAGE_DESCRIPTION);
});

test("packaging uses the generated Luke application icon", () => {
  const config = builderConfig();
  const builderIconPath = path.join(repoRoot, "apps", "desktop", ".build", "Luke.icns");

  assert.equal(packagerOptions().icon, iconPath);
  assert.equal(config.mac.icon, builderIconPath);
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
  assert.equal(builderConfig().mac.identity, "-");

  const identity = "Developer ID Application: X (TEAM)";
  const developerIdSigning = resolveSigningMode({ LUKE_CODESIGN_IDENTITY: identity });
  const developerIdOptions = packagerOptions(developerIdSigning);
  const developerIdBuilder = builderConfig({ LUKE_CODESIGN_IDENTITY: identity });
  assert.deepEqual(developerIdSigning, { mode: SIGNING_MODE.DEVELOPER_ID, identity });
  assert.equal(developerIdOptions.osxSign.identity, identity);
  assert.equal(developerIdBuilder.mac.identity, identity);
  assert.equal(developerIdBuilder.mac.hardenedRuntime, true);
  assert.equal(developerIdBuilder.mac.gatekeeperAssess, false);
  assert.equal(developerIdBuilder.mac.notarize, false);
  assert.deepEqual(developerIdOptions.osxSign.optionsForFile(), {
    hardenedRuntime: true,
    entitlements: entitlementsPath,
  });
  assert.equal(developerIdBuilder.mac.entitlements, entitlementsPath);
  assert.equal(developerIdBuilder.mac.entitlementsInherit, entitlementsPath);
});

test("the baked signing define mirrors the signing mode and carries no identity", () => {
  // app-identity.ts reads this define to decide which name — and so which
  // state directory and Keychain entry — a run answers to, so it must say
  // Developer ID exactly when the packager signs with one.
  assert.deepEqual(signingModeDefine({}), { PACKAGED_WITH_DEVELOPER_ID_SIGNING: "false" });
  const defined = signingModeDefine({
    LUKE_CODESIGN_IDENTITY: "Developer ID Application: X (TEAM)",
  });
  assert.deepEqual(defined, { PACKAGED_WITH_DEVELOPER_ID_SIGNING: "true" });
  // Only the fact travels into the bundle: a boolean literal, never the
  // identity's own name.
  for (const value of Object.values(defined)) {
    assert.equal(value.includes("Developer ID"), false);
  }
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
