import { PACKAGED_ARCHITECTURE } from "./package-layout.mjs";

export { PACKAGED_ARCHITECTURE };

export const MACOS_DEPLOYMENT_TARGET = "14.0";
export const SWIFT_TARGET_TRIPLE = `${PACKAGED_ARCHITECTURE}-apple-macos${MACOS_DEPLOYMENT_TARGET}`;
export const LICENSE_RESOURCE_NAME = "LUKE-LICENSE.txt";
// This is the sentence macOS shows when it asks for the microphone, so it is
// what consent is given against. It has to say where the audio goes.
export const MICROPHONE_USAGE_DESCRIPTION =
  "Luke uses the microphone for spoken conversation. Audio from a turn you start is sent to OpenAI to answer it, and is never recorded or written to disk.";
// The sentence macOS shows when it asks whether Luke may speak to Music or
// Spotify, so it is what consent is given against. It has to say what is done
// to them, and what is not.
export const APPLE_EVENTS_USAGE_DESCRIPTION =
  "Luke turns Music and Spotify down while you are having a spoken conversation, and back up afterwards. He never pauses them, and reads nothing beyond whether each is playing and how loud.";
// The sentence macOS shows when it asks for full calendar access — the only
// access EventKit reads under — so it is what consent is given against: one
// sentence naming exactly what is read.
export const CALENDARS_USAGE_DESCRIPTION =
  "This app requires access to your calendar to read event start and end times.";

/**
 * Every key macOS may look the calendar sentence up under: the full-access
 * and write-only keys EventKit's macOS 14 access levels document, and the
 * legacy key TCC's own prompt machinery has always used. All carry the same
 * sentence, in both bundles that can be asked — the app's Info.plist and the
 * helper bundle's — so the dialog can never say two different things
 * depending on which binary asked.
 */
export const CALENDARS_USAGE_KEYS = [
  "NSCalendarsFullAccessUsageDescription",
  "NSCalendarsWriteOnlyAccessUsageDescription",
  "NSCalendarsUsageDescription",
];

/**
 * The Info.plist of the calendar helper's own minimal bundle. The helper
 * answers to TCC as itself, so this plist is what the consent dialog is
 * judged against and drawn from: EventKit looks the usage sentence up here
 * before TCC ever hears the question, and the dialog and System Settings
 * name the asker by the display name here — "Luke", where a bare binary
 * would be named by its filename. The sentence is the same constant the
 * app's Info.plist carries, so the dialog can never say two different
 * things depending on which binary asked.
 */
export function appleCalendarHelperInfoPlist() {
  const usageEntries = CALENDARS_USAGE_KEYS.map(
    (key) => `\t<key>${key}</key>\n\t<string>${CALENDARS_USAGE_DESCRIPTION}</string>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleExecutable</key>
\t<string>Luke</string>
\t<key>CFBundleIdentifier</key>
\t<string>dev.reviewstage.luke.apple-calendar</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>Luke</string>
\t<key>CFBundleDisplayName</key>
\t<string>Luke</string>
\t<key>CFBundleIconFile</key>
\t<string>Luke.icns</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>LSMinimumSystemVersion</key>
\t<string>${MACOS_DEPLOYMENT_TARGET}</string>
\t<key>LSUIElement</key>
\t<true/>
${usageEntries}
</dict>
</plist>
`;
}
// The bundle carries one icon for every mode, so the icns is cut from the dark
// tile — space black reads on either desktop. The running app swaps the Dock
// image between the light and dark tiles itself; see applyDockIcon in main.ts.
export const ICONSET_SOURCES = Object.freeze({
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
export const SIGNING_MODE = {
  AD_HOC: "ad-hoc",
  DEVELOPER_ID: "developer-id",
};

export function addonCompilerArguments(source, output, frameworks = ["AppKit"]) {
  return [
    "clang",
    "-target",
    SWIFT_TARGET_TRIPLE,
    "-fobjc-arc",
    "-Wall",
    "-dynamiclib",
    // Node-API symbols have no library to link against at build time; they
    // resolve from the Electron binary the addon is loaded into.
    "-Wl,-undefined,dynamic_lookup",
    ...frameworks.flatMap((framework) => ["-framework", framework]),
    source,
    "-o",
    output,
  ];
}

export function swiftCompilerArguments(source, output, frameworks = ["AppKit"]) {
  return [
    "swiftc",
    "-parse-as-library",
    "-target",
    SWIFT_TARGET_TRIPLE,
    ...frameworks.flatMap((framework) => ["-framework", framework]),
    source,
    "-o",
    output,
  ];
}

export function iconutilArguments(iconsetPath, icnsPath) {
  return ["-c", "icns", iconsetPath, "-o", icnsPath];
}

export function resolveSigningMode(env) {
  const rawIdentity = env.LUKE_CODESIGN_IDENTITY;
  const identity =
    Object.prototype.toString.call(rawIdentity) === "[object String]" ? rawIdentity.trim() : "";
  return identity ? { mode: SIGNING_MODE.DEVELOPER_ID, identity } : { mode: SIGNING_MODE.AD_HOC };
}

/**
 * The esbuild define telling the bundle whether it was built alongside
 * Developer ID packaging, read by app-identity.ts to decide which name — and
 * so which state directory and Keychain entry — the run answers to. Derived
 * from the same environment `resolveSigningMode` reads so the flag and the
 * signature it stands for come from one place; only the fact travels, never
 * the identity's name.
 */
export function signingModeDefine(env) {
  return {
    PACKAGED_WITH_DEVELOPER_ID_SIGNING: JSON.stringify(
      resolveSigningMode(env).mode === SIGNING_MODE.DEVELOPER_ID,
    ),
  };
}

/**
 * The updater config electron-updater reads from the bundle's own Resources.
 * Setting the feed at runtime does not spare the file: before every download
 * the updater reads `updaterCacheDirName` from it (AppUpdater's
 * downloadUpdate path), so a bundle without one fails with ENOENT the moment
 * a newer build is found. electron-builder writes this file from the generic
 * publish config. The URL must equal `UPDATE_ENDPOINT.UPDATE_FEED_URL` in
 * src/update-service.ts, and the cache directory must stay `luke-updater` so
 * downloaded updates from the pre-builder transition are not orphaned.
 */
export const APP_UPDATE_CONFIG_FILE_NAME = "app-update.yml";
export const APP_UPDATE_FEED_URL = "https://github.com/ReviewStage/luke/releases/latest/download/";
export const APP_UPDATE_CACHE_DIR_NAME = "luke-updater";
