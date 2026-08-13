import { PACKAGED_ARCHITECTURE, packageIgnorePatterns } from "./package-layout.mjs";

export { PACKAGED_ARCHITECTURE };

export const MACOS_DEPLOYMENT_TARGET = "14.0";
export const SWIFT_TARGET_TRIPLE = `${PACKAGED_ARCHITECTURE}-apple-macos${MACOS_DEPLOYMENT_TARGET}`;
export const LICENSE_RESOURCE_NAME = "LUKE-LICENSE.txt";
export const MICROPHONE_USAGE_DESCRIPTION =
  "Luke uses microphone input to display live audio activity. Audio is processed locally and is not recorded or uploaded.";
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

export function swiftCompilerArguments(source, output) {
  return [
    "swiftc",
    "-parse-as-library",
    "-target",
    SWIFT_TARGET_TRIPLE,
    "-framework",
    "AppKit",
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
  helperPath,
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
    extraResource: [helperPath, licensePath],
    extendInfo: {
      CFBundleDisplayName: "Luke",
      LSMinimumSystemVersion: MACOS_DEPLOYMENT_TARGET,
      LSUIElement: true,
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
