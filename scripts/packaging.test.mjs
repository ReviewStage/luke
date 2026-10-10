import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import {
  createElectronBuilderConfig,
  ELECTRON_BUILDER_UPDATE_CACHE_DIR_NAME,
  ELECTRON_BUILDER_UPDATE_FEED_URL,
  ELECTRON_BUILDER_UPDATE_PUBLISH_CONFIG,
} from "../apps/desktop/scripts/electron-builder-config.mjs";
import {
  APP_UPDATE_CACHE_DIR_NAME,
  APP_UPDATE_FEED_URL,
  APPLE_EVENTS_USAGE_DESCRIPTION,
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
import {
  NATIVE_HELPERS,
  packagedAppExecutable,
  packagedAppPath,
} from "../apps/desktop/scripts/package-layout.mjs";

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
function builderConfig(env = {}) {
  return createElectronBuilderConfig(env);
}

/** PNG's Paeth predictor: whichever neighbour is nearest left + up - upLeft. */
function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const [distanceLeft, distanceUp, distanceUpLeft] = [left, up, upLeft].map((value) =>
    Math.abs(estimate - value),
  );
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

/**
 * The pixels of an 8-bit RGBA PNG as rows of `[r, g, b, a]`, for reading the
 * committed icon artwork without a decoder dependency. Note that this reads
 * only what the brand rasterizer writes: non-interlaced RGBA at depth 8.
 */
function readPngPixels(pngPath) {
  const png = fs.readFileSync(pngPath);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.deepEqual([png[24], png[25], png[28]], [8, 6, 0], `${pngPath} is not 8-bit RGBA`);
  const chunks = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const data = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)];
    const row = Buffer.from(data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous[x];
      const upLeft = x >= 4 ? previous[x - 4] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      row[x] = (row[x] + predictor) & 0xff;
    }
    rows.push(Array.from({ length: width }, (_, x) => [...row.subarray(x * 4, x * 4 + 4)]));
    previous = row;
  }
  return rows;
}

/** The first and last index along a line of alpha values the tile covers. */
function coveredSpan(alphas) {
  const covered = (alpha) => alpha > 128;
  return [alphas.findIndex(covered), alphas.findLastIndex(covered)];
}

test("workspace package versions agree on v0.10.0", () => {
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
    packagePaths.map(() => "0.10.0"),
  );
});

test("electron-builder answers to Luke's application identity", () => {
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

test("packaging is pinned to Apple Silicon and the builder output directory", () => {
  const config = builderConfig();
  const versionMacro = "$" + "{version}";
  const archMacro = "$" + "{arch}";
  const extensionMacro = "$" + "{ext}";

  assert.equal(PACKAGED_ARCHITECTURE, "arm64");
  assert.equal(config.mac.target, "default");
  assert.deepEqual(config.files, ["dist/**/*", "package.json", "!dist/**/*.map"]);
  assert.equal(
    config.mac.artifactName,
    `Luke-${versionMacro}-macos-${archMacro}.${extensionMacro}`,
  );
  assert.equal(config.dmg.artifactName, `Luke-${versionMacro}-${archMacro}.${extensionMacro}`);
  assert.equal(
    packagedAppPath("/repo"),
    path.join("/repo", "artifacts", "release-builder", "mac-arm64", "Luke.app"),
  );
  assert.equal(
    config.dmg.contents[0].path,
    path.join(repoRoot, "artifacts", "release-builder", "mac-arm64", "Luke.app"),
  );
  assert.equal(
    packagedAppExecutable("/repo"),
    path.join(
      "/repo",
      "artifacts",
      "release-builder",
      "mac-arm64",
      "Luke.app",
      "Contents",
      "MacOS",
      "Luke",
    ),
  );
});

test("the packaged app launches as a regular app, with a Dock tile and an app menu", () => {
  // An agent app (LSUIElement) or a background-only one launches with no Dock
  // tile, no Command-Tab entry, and no menu bar of its own.
  const info = builderConfig().mac.extendInfo;
  assert.equal(info.LSUIElement, undefined);
  assert.equal(info.LSBackgroundOnly, undefined);
});

test("packaging declares the macOS deployment target", () => {
  const config = builderConfig();
  const compilerArguments = swiftCompilerArguments("source.swift", "helper");

  assert.equal(MACOS_DEPLOYMENT_TARGET, "14.0");
  assert.equal(SWIFT_TARGET_TRIPLE, "arm64-apple-macos14.0");
  assert.equal(config.mac.minimumSystemVersion, MACOS_DEPLOYMENT_TARGET);
  assert.equal(config.mac.extendInfo.LSMinimumSystemVersion, MACOS_DEPLOYMENT_TARGET);
  assert.deepEqual(compilerArguments.slice(0, 4), [
    "swiftc",
    "-parse-as-library",
    "-target",
    SWIFT_TARGET_TRIPLE,
  ]);
});

test("every native helper is built, shipped, and signed", () => {
  const config = builderConfig();
  const builderShipped = config.extraResources.slice(0, NATIVE_HELPERS.length);
  const builderBinaries = config.mac.binaries;

  for (const helper of NATIVE_HELPERS) {
    const builderResource = builderShipped.find((resource) => resource.to === helper.binary);
    assert.ok(builderResource, `${helper.binary} reaches the electron-builder bundle`);
    assert.ok(
      builderResource.from.endsWith(helper.binary),
      `${helper.binary} is copied from its built output`,
    );
    assert.ok(
      builderBinaries.some((resourcePath) => resourcePath.endsWith(helper.binary)),
      `${helper.binary} is signed explicitly by electron-builder`,
    );
    assert.ok(helper.source.endsWith(".swift"));
    assert.ok(helper.frameworks.length > 0);
  }
});

test("the talk key is compiled against the framework that reads it", () => {
  const talkKey = NATIVE_HELPERS.find((helper) => helper.binary === "mac-talk-key");

  assert.ok(talkKey, "the talk key helper is declared");
  assert.ok(swiftCompilerArguments("s", "o", talkKey.frameworks).includes("Carbon"));
});

test("packaging includes the Luke license and approved microphone description", () => {
  const config = builderConfig();
  const licenseResource = config.extraResources.at(-1);

  assert.equal(LICENSE_RESOURCE_NAME, "LUKE-LICENSE.txt");
  assert.deepEqual(licenseResource, {
    from: path.join(repoRoot, "apps", "desktop", ".build", LICENSE_RESOURCE_NAME),
    to: LICENSE_RESOURCE_NAME,
  });
  assert.equal(
    config.mac.extendInfo.NSMicrophoneUsageDescription,
    "Luke uses the microphone for spoken conversation. Audio from a turn you start is sent to OpenAI to answer it, and is never recorded or written to disk.",
  );
  assert.equal(config.mac.extendInfo.NSMicrophoneUsageDescription, MICROPHONE_USAGE_DESCRIPTION);
});

test("packaging includes the approved Apple Events description", () => {
  const config = builderConfig();

  assert.equal(
    config.mac.extendInfo.NSAppleEventsUsageDescription,
    "Luke turns Music and Spotify down while you talk, and back up afterwards",
  );
  assert.equal(config.mac.extendInfo.NSAppleEventsUsageDescription, APPLE_EVENTS_USAGE_DESCRIPTION);
});

test("every Dock icon draws its tile on Apple's 824-of-1024 macOS grid", () => {
  const brandIconDirectory = path.join(repoRoot, "design", "brand", "icon");
  const sources = [...new Set(Object.values(ICONSET_SOURCES)), "luke-icon-light-512.png"];

  for (const sourceName of sources.filter((name) => !/-(16|32|64)\.png$/.test(name))) {
    const alpha = readPngPixels(path.join(brandIconDirectory, sourceName)).map((row) =>
      row.map((pixel) => pixel[3]),
    );
    const side = alpha.length;
    const middle = Math.floor(side / 2);
    const [left, right] = coveredSpan(alpha[middle]);
    const [top] = coveredSpan(alpha.map((row) => row[middle]));
    const expected = { margin: (100 / 1024) * side, tile: (824 / 1024) * side };
    const tolerance = 2;

    assert.ok(Math.abs(left - expected.margin) <= tolerance, `${sourceName} left margin ${left}`);
    assert.ok(Math.abs(top - expected.margin) <= tolerance, `${sourceName} top margin ${top}`);
    assert.ok(
      Math.abs(right - left + 1 - expected.tile) <= tolerance,
      `${sourceName} tile width ${right - left + 1}`,
    );
  }
});

test("every Dock icon's tile gradient steps one level at a time, without banding", () => {
  const brandIconDirectory = path.join(repoRoot, "design", "brand", "icon");

  for (const sourceName of ["luke-icon-dark-1024.png", "luke-icon-light-512.png"]) {
    const pixels = readPngPixels(path.join(brandIconDirectory, sourceName));
    const side = pixels.length;
    // A row below the glyph, inside the tile's straight sides, holds only gradient.
    const row = pixels[Math.floor(side * 0.8)].slice(
      Math.floor(side * 0.3),
      Math.floor(side * 0.7),
    );

    for (let x = 1; x < row.length; x++) {
      const step = Math.max(
        ...[0, 1, 2].map((channel) => Math.abs(row[x][channel] - row[x - 1][channel])),
      );
      assert.ok(step <= 1, `${sourceName} jumps ${step} levels at x ${x}`);
    }
  }
});

test("packaging uses the generated Luke application icon", () => {
  const config = builderConfig();
  const builderIconPath = path.join(repoRoot, "apps", "desktop", ".build", "Luke.icns");

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
  const adHocBuilder = builderConfig();
  assert.equal(adHocBuilder.mac.identity, "-");
  assert.equal(adHocBuilder.mac.hardenedRuntime, false);

  const identity = "Developer ID Application: X (TEAM)";
  const developerIdSigning = resolveSigningMode({ LUKE_CODESIGN_IDENTITY: identity });
  const developerIdBuilder = builderConfig({ LUKE_CODESIGN_IDENTITY: identity });
  assert.deepEqual(developerIdSigning, { mode: SIGNING_MODE.DEVELOPER_ID, identity });
  assert.equal(developerIdBuilder.mac.identity, identity);
  assert.equal(developerIdBuilder.mac.hardenedRuntime, true);
  assert.equal(developerIdBuilder.mac.gatekeeperAssess, false);
  assert.equal(developerIdBuilder.mac.notarize, false);
  assert.equal(developerIdBuilder.mac.entitlements, entitlementsPath);
  assert.equal(developerIdBuilder.mac.entitlementsInherit, entitlementsPath);
});

test("the baked signing define mirrors the signing mode and carries no identity", () => {
  assert.deepEqual(signingModeDefine({}), { PACKAGED_WITH_DEVELOPER_ID_SIGNING: "false" });
  const defined = signingModeDefine({
    LUKE_CODESIGN_IDENTITY: "Developer ID Application: X (TEAM)",
  });
  assert.deepEqual(defined, { PACKAGED_WITH_DEVELOPER_ID_SIGNING: "true" });
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
  assert.match(entitlements, /<key>com\.apple\.security\.automation\.apple-events<\/key>/);
});
