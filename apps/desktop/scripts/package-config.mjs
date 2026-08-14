import { PACKAGED_ARCHITECTURE, packageIgnorePatterns } from "./package-layout.mjs";

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
export const ICONSET_SOURCES = Object.freeze({
  "icon_16x16.png": "luke-icon-16.png",
  "icon_16x16@2x.png": "luke-icon-32.png",
  "icon_32x32.png": "luke-icon-32.png",
  "icon_32x32@2x.png": "luke-icon-64.png",
  "icon_128x128.png": "luke-icon-128.png",
  "icon_128x128@2x.png": "luke-icon-256.png",
  "icon_256x256.png": "luke-icon-256.png",
  "icon_256x256@2x.png": "luke-icon-512.png",
  "icon_512x512.png": "luke-icon-512.png",
  "icon_512x512@2x.png": "luke-icon-1024.png",
});
export const SIGNING_MODE = {
  AD_HOC: "ad-hoc",
  DEVELOPER_ID: "developer-id",
};

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
  const identity =
    typeof env.LUKE_CODESIGN_IDENTITY === "string" ? env.LUKE_CODESIGN_IDENTITY.trim() : "";
  return identity ? { mode: SIGNING_MODE.DEVELOPER_ID, identity } : { mode: SIGNING_MODE.AD_HOC };
}

export function createPackagerOptions({
  appRoot,
  outputRoot,
  helperPaths,
  iconPath,
  licensePath,
  entitlementsPath,
  signing,
  version,
}) {
  const options = {
    dir: appRoot,
    out: outputRoot,
    name: "Luke",
    executableName: "Luke",
    appBundleId: "dev.reviewstage.luke",
    appCategoryType: "public.app-category.developer-tools",
    platform: "darwin",
    arch: PACKAGED_ARCHITECTURE,
    appVersion: version,
    asar: true,
    overwrite: true,
    prune: false,
    icon: iconPath,
    extraResource: [...helperPaths, licensePath],
    extendInfo: {
      CFBundleDisplayName: "Luke",
      LSMinimumSystemVersion: MACOS_DEPLOYMENT_TARGET,
      LSUIElement: true,
      NSAppleEventsUsageDescription: APPLE_EVENTS_USAGE_DESCRIPTION,
      NSMicrophoneUsageDescription: MICROPHONE_USAGE_DESCRIPTION,
      NSPrefersDisplaySafeAreaCompatibilityMode: false,
    },
    ignore: packageIgnorePatterns,
  };

  if (signing.mode === SIGNING_MODE.DEVELOPER_ID) {
    return {
      ...options,
      osxSign: {
        identity: signing.identity,
        optionsForFile: () => ({
          hardenedRuntime: true,
          entitlements: entitlementsPath,
        }),
      },
    };
  }

  return options;
}
