import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const project = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "Luke.xcodeproj", "project.pbxproj"),
  "utf8",
);
const watchScheme = fs.readFileSync(
  path.join(
    repoRoot,
    "apps",
    "ios",
    "Luke.xcodeproj",
    "xcshareddata",
    "xcschemes",
    "LukeWatch.xcscheme",
  ),
  "utf8",
);
const watchRoster = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchRosterView.swift"),
  "utf8",
);
const watchVoice = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchVoiceView.swift"),
  "utf8",
);
const watchVoiceModel = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchVoiceSessionModel.swift"),
  "utf8",
);
const watchVoiceSettings = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchVoiceSettingsView.swift"),
  "utf8",
);
const watchAccount = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchAccountSession.swift"),
  "utf8",
);
const watchRoot = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "LukeWatchView.swift"),
  "utf8",
);
const watchRosterStore = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchRosterStore.swift"),
  "utf8",
);
const watchConnectivity = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchConnectivityReceiver.swift"),
  "utf8",
);

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

test("the Watch app is shown on the watch as Luke", () => {
  const watchConfigurations = project.match(
    /PRODUCT_BUNDLE_IDENTIFIER = dev\.tryluke\.ios\.watchkitapp;/g,
  );
  assert.equal(watchConfigurations?.length, 2);
  assert.equal(
    project.match(/INFOPLIST_KEY_CFBundleDisplayName = Luke;[\s\S]*?SDKROOT = watchos;/g)?.length,
    2,
  );
});

test("the Watch scheme builds the companion and runs the Watch app", () => {
  assert.match(watchScheme, /BuildableName = "Luke\.app"[\s\S]*?BuildableName = "LukeWatch\.app"/);
  assert.match(
    watchScheme,
    /<LaunchAction[\s\S]*?<BuildableProductRunnable[\s\S]*?BuildableName = "LukeWatch\.app"/,
  );
  assert.match(watchScheme, /<MacroExpansion>[\s\S]*?BuildableName = "Luke\.app"/);
});

test("iPhone and Watch messages use the same Markdown renderer", () => {
  assert.equal(project.match(/MarkdownMessageView\.swift in Sources/g)?.length, 4);
  assert.match(watchRoster, /MarkdownMessageView\(message\.text\)/);
  assert.doesNotMatch(watchRoster, /AttributedString\(markdown:/);
});

test("the Watch tears down account-scoped UI when the paired account changes", () => {
  assert.match(watchAccount, /private\(set\) var accountScope: String\?/);
  assert.match(watchAccount, /private static func scope\(email: String\)/);
  assert.match(watchAccount, /email\.trimmingCharacters[\s\S]*?\.lowercased\(\)/);
  assert.match(watchAccount, /func signOut\(\)[\s\S]*?accountScope = nil/);
  assert.match(watchRoot, /NavigationStack[\s\S]*?\.id\(watchSession\.accountScope\)/);
  assert.match(watchRoot, /\.onChange\(of: watchSession\.accountScope\)/);
});

test("the Watch voice page exposes settings and applies them to mints", () => {
  assert.match(
    watchRoot,
    /NavigationStack \{[\s\S]*?WatchVoiceView\(\)[\s\S]*?\.tag\(WatchPage\.voice\)/,
  );
  assert.match(watchVoice, /ToolbarItem\(placement: \.topBarLeading\) \{ settingsButton \}/);
  assert.match(watchVoice, /WatchVoiceSettingsView\([\s\S]*?VoiceToolAvailability\.report/);
  assert.doesNotMatch(watchVoiceSettings, /Button\("Done"\)/);
  assert.doesNotMatch(watchVoiceSettings, /placement: \.confirmationAction/);
  assert.match(watchVoiceSettings, /Picker\("Voice", selection: voiceChoice\)/);
  assert.match(watchVoiceSettings, /Picker\("Speed", selection: speedChoice\)/);
  assert.match(
    watchVoiceSettings,
    /events\.record\(\.settingUpdate\(setting: \.voice, value: \.set\)\)/,
  );
  assert.match(
    watchVoiceSettings,
    /events\.record\(\.settingUpdate\(setting: \.voiceSpeed, value: \.set\)\)/,
  );
  assert.match(watchVoiceModel, /let mintVoice = voice\.rawValue/);
  assert.match(watchVoiceModel, /let mintSpeed = speed\.multiplier/);
  assert.match(watchVoiceModel, /voice: mintVoice/);
  assert.match(watchVoiceModel, /speed: mintSpeed/);
  assert.match(
    watchVoiceModel,
    /func changeSpeed\(_ newSpeed: RealtimeVoiceSpeed\)[\s\S]*?session\?\.applySpeed\(newSpeed\.multiplier\)/,
  );
});

test("cancelled Watch roster reads do not become completed empty states", () => {
  assert.match(watchRosterStore, /var completedRequest = false/);
  assert.match(watchRosterStore, /if completedRequest \{[\s\S]*?hasLoaded = true[\s\S]*?\}/);
  assert.match(watchRosterStore, /guard !Task\.isCancelled else \{ return \}/);
});

test("the Watch requests replacement credentials after an expired token", () => {
  assert.match(watchAccount, /@ObservationIgnored var onCredentialsNeeded/);
  assert.match(
    watchAccount,
    /private func invalidateCredentialsAndRequestReplacement\(\)[\s\S]*?signOut\(\)[\s\S]*?onCredentialsNeeded\?\(\)/,
  );
  assert.equal(watchAccount.match(/invalidateCredentialsAndRequestReplacement\(\)/g)?.length, 3);
  assert.match(
    watchConnectivity,
    /watchSession\.onCredentialsNeeded = \{[\s\S]*?requestTokensIfNeeded\(\)/,
  );
});

test("empty Watch conversations leave the native composer interactive", () => {
  assert.match(
    watchRoster,
    /if centersConversationState \{[\s\S]*?conversationContent[\s\S]*?\.allowsHitTesting\(loadError != nil\)/,
  );
});

test("outgoing Watch messages remain visible without a readable transcript", () => {
  assert.match(
    watchRoster,
    /Conversation unavailable for this session\.[\s\S]*?ForEach\(outgoing\)[\s\S]*?if session\.canReceiveMessage/,
  );
});

const phonePrivacyManifest = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "Luke", "PrivacyInfo.xcprivacy"),
  "utf8",
);
const watchPrivacyManifest = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "PrivacyInfo.xcprivacy"),
  "utf8",
);
const exportOptions = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "ExportOptions.plist"),
  "utf8",
);

function swiftSources(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".swift"))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

const shippedSwift = [
  path.join(repoRoot, "apps", "ios", "Luke"),
  path.join(repoRoot, "apps", "ios", "LukeWatch"),
  path.join(repoRoot, "apps", "ios", "LukeKit", "Sources"),
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

test("the export options upload to App Store Connect without naming a team", () => {
  assert.match(exportOptions, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(exportOptions, /<key>destination<\/key>\s*<string>upload<\/string>/);
  assert.match(exportOptions, /<key>signingStyle<\/key>\s*<string>automatic<\/string>/);
  assert.doesNotMatch(exportOptions, /teamID/);
});
