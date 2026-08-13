import { PACKAGED_ARCHITECTURE, packageIgnorePatterns } from "./package-layout.mjs";

export { PACKAGED_ARCHITECTURE };

export const MACOS_DEPLOYMENT_TARGET = "14.0";
export const SWIFT_TARGET_TRIPLE = `${PACKAGED_ARCHITECTURE}-apple-macos${MACOS_DEPLOYMENT_TARGET}`;
export const LICENSE_RESOURCE_NAME = "LUKE-LICENSE.txt";
export const MICROPHONE_USAGE_DESCRIPTION =
  "Luke uses microphone input to display live audio activity. Audio is processed locally and is not recorded or uploaded.";
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

export function resolveSigningMode(env) {
  const identity =
    typeof env.LUKE_CODESIGN_IDENTITY === "string" ? env.LUKE_CODESIGN_IDENTITY.trim() : "";
  return identity ? { mode: SIGNING_MODE.DEVELOPER_ID, identity } : { mode: SIGNING_MODE.AD_HOC };
}

export function createPackagerOptions({
  appRoot,
  outputRoot,
  helperPath,
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
