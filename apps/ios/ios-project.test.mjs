import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const iosRoot = path.dirname(fileURLToPath(import.meta.url));
const project = fs.readFileSync(path.join(iosRoot, "Luke.xcodeproj", "project.pbxproj"), "utf8");

test("the Xcode project has unique object identifiers", () => {
  const definitions = [...project.matchAll(/^\t\t([A-F0-9]{24}) (?:\/\* .* \*\/ )?= /gm)].map(
    (match) => match[1],
  );
  const duplicates = definitions.filter((id, index) => definitions.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});

test("the iPhone app embeds and depends on the Watch app", () => {
  assert.match(project, /LukeWatch\.app in Embed Watch Content/);
  assert.match(project, /name = "Embed Watch Content";/);
  assert.match(project, /dstPath = "\$\(CONTENTS_FOLDER_PATH\)\/Watch";/);
  assert.match(project, /dstSubfolderSpec = 16;/);
  assert.match(project, /PBXTargetDependency[\s\S]*?target = [^;]+ \/\* LukeWatch \*\//);
});

const phonePrivacyManifest = fs.readFileSync(
  path.join(iosRoot, "Luke", "PrivacyInfo.xcprivacy"),
  "utf8",
);
const watchPrivacyManifest = fs.readFileSync(
  path.join(iosRoot, "LukeWatch", "PrivacyInfo.xcprivacy"),
  "utf8",
);
const exportOptions = fs.readFileSync(path.join(iosRoot, "ExportOptions.plist"), "utf8");

function swiftSources(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".swift"))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

const shippedSwift = [
  path.join(iosRoot, "Luke"),
  path.join(iosRoot, "LukeWatch"),
  path.join(iosRoot, "LukeKit", "Sources"),
]
  .map(swiftSources)
  .join("\n");

// Apple's required-reason API list, as the symbols each category covers in
// Swift. A category the shipped sources call must be declared in both
// manifests, and a declared category must still be called, so the manifests
// say exactly what the code does.
const REQUIRED_REASON_APIS = {
  NSPrivacyAccessedAPICategoryUserDefaults: /\bUserDefaults\b/,
  NSPrivacyAccessedAPICategorySystemBootTime: /\bsystemUptime\b|\bmach_absolute_time\b/,
  NSPrivacyAccessedAPICategoryFileTimestamp:
    /\bcreationDate\b|\bmodificationDate\b|\bcontentModificationDate(?:Key)?\b|\bfileModificationDate\b|\b[fl]?stat\(|\bgetattrlist\(/,
  NSPrivacyAccessedAPICategoryDiskSpace:
    /\bvolumeAvailableCapacity\w*\b|\bvolumeTotalCapacity\b|\bsystemFreeSize\b|\bsystemSize\b|\bstatfs\(/,
  NSPrivacyAccessedAPICategoryActiveKeyboards: /\bactiveInputModes\b/,
};

test("the iPhone and Watch apps share one version and build number", () => {
  const versions = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]);
  const builds = [...project.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(
    (match) => match[1],
  );
  assert.equal(versions.length, 2);
  assert.equal(builds.length, 2);
  assert.equal(new Set(versions).size, 1);
  assert.equal(new Set(builds).size, 1);
  const projectConfigurations = project.slice(
    project.indexOf("/* Begin XCBuildConfiguration section */"),
    project.indexOf("AABBCC000000000000000072 /* Debug */ = {"),
  );
  assert.equal(projectConfigurations.match(/MARKETING_VERSION = /g)?.length, 2);
  assert.equal(projectConfigurations.match(/CURRENT_PROJECT_VERSION = /g)?.length, 2);
  assert.match(exportOptions, /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/);
});

test("both apps declare exempt encryption so every build can be tested at once", () => {
  assert.equal(project.match(/INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;/g)?.length, 4);
});

test("both apps ship a privacy manifest that matches the APIs the code calls", () => {
  assert.match(project, /AABBCC000000000000000102 \/\* PrivacyInfo\.xcprivacy in Resources \*\/,/);
  assert.match(project, /AABBCC000000000000000103 \/\* PrivacyInfo\.xcprivacy in Resources \*\/,/);
  assert.match(project, /path = PrivacyInfo\.xcprivacy;[\s\S]*?path = PrivacyInfo\.xcprivacy;/);
  for (const manifest of [phonePrivacyManifest, watchPrivacyManifest]) {
    assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    assert.match(manifest, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
    for (const [category, symbols] of Object.entries(REQUIRED_REASON_APIS)) {
      assert.equal(
        manifest.includes(`<string>${category}</string>`),
        symbols.test(shippedSwift),
        category,
      );
    }
  }
});

const kitManifest = fs.readFileSync(path.join(iosRoot, "LukeKit", "Package.swift"), "utf8");
const kitSources = path.join(iosRoot, "LukeKit", "Sources", "LukeKit");
const webRTCImport = /^import LiveKitWebRTC$/m;

// The WebRTC binary has no watchOS slice, so the watch build must never
// reach it: the manifest links it for the phone (and for a Mac's
// `swift test`) alone, and the one file that imports it compiles only where
// it is linked, so every other target compiles the peer without the binary.
test("the WebRTC framework is linked for the phone alone, behind one gated file", () => {
  assert.match(kitManifest, /url: "https:\/\/github\.com\/livekit\/webrtc-xcframework\.git", exact: "150\.7871\.02"/);
  assert.match(
    kitManifest,
    /name: "LiveKitWebRTC",\s*package: "webrtc-xcframework",\s*condition: \.when\(platforms: \[\.iOS, \.macOS\]\)/,
  );
  const linuxExclusions = kitManifest.slice(kitManifest.indexOf("#if os(Linux)"), kitManifest.indexOf("#else"));
  assert.match(linuxExclusions, /"WebRTCPeer\.swift",/);
  assert.match(linuxExclusions, /let webRTCPackages: \[Package\.Dependency\] = \[\]/);
  const importers = fs
    .readdirSync(kitSources)
    .filter((name) => name.endsWith(".swift"))
    .filter((name) => webRTCImport.test(fs.readFileSync(path.join(kitSources, name), "utf8")));
  assert.deepEqual(importers, ["WebRTCPeer.swift"]);
  const adaptor = fs.readFileSync(path.join(kitSources, "WebRTCPeer.swift"), "utf8");
  assert.equal(adaptor.split("\n")[0], "#if canImport(LiveKitWebRTC)");
  assert.match(adaptor, /\n#endif\n$/);
  assert.doesNotMatch(swiftSources(path.join(iosRoot, "LukeWatch")), webRTCImport);
});

const phoneEntitlements = fs.readFileSync(path.join(iosRoot, "Luke", "Luke.entitlements"), "utf8");

test("the iPhone app alone signs with the push entitlement, in both configurations", () => {
  assert.equal(project.match(/CODE_SIGN_ENTITLEMENTS = Luke\/Luke\.entitlements;/g)?.length, 2);
  assert.equal(project.match(/CODE_SIGN_ENTITLEMENTS = /g)?.length, 2);
  assert.match(project, /path = Luke\.entitlements;/);
  assert.match(phoneEntitlements, /<key>aps-environment<\/key>\s*<string>development<\/string>/);
});

test("the export options upload to App Store Connect without naming a team", () => {
  assert.match(exportOptions, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(exportOptions, /<key>destination<\/key>\s*<string>upload<\/string>/);
  assert.match(exportOptions, /<key>signingStyle<\/key>\s*<string>automatic<\/string>/);
  assert.doesNotMatch(exportOptions, /teamID/);
});
