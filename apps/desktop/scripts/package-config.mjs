import { PACKAGED_ARCHITECTURE } from "./package-layout.mjs";

export const MACOS_DEPLOYMENT_TARGET = "14.0";
export const SWIFT_TARGET_TRIPLE = `${PACKAGED_ARCHITECTURE}-apple-macos${MACOS_DEPLOYMENT_TARGET}`;
export const LICENSE_RESOURCE_NAME = "VESPIN-LICENSE.txt";
export const NOTICE_RESOURCE_NAME = "VESPIN-NOTICE.txt";
export const APP_ID = "dev.vespin.app";
export const MICROPHONE_USAGE_DESCRIPTION =
  "Vespin uses the microphone for dictation. What you dictate is sent to OpenAI to be transcribed.";
export const APPLE_EVENTS_USAGE_DESCRIPTION =
  "Vespin asks before a command an agent runs on this Mac controls another app.";
export const ICONSET_SOURCES = Object.freeze({
  "icon_16x16.png": "icon-dark-16.png",
  "icon_16x16@2x.png": "icon-dark-32.png",
  "icon_32x32.png": "icon-dark-32.png",
  "icon_32x32@2x.png": "icon-dark-64.png",
  "icon_128x128.png": "icon-dark-128.png",
  "icon_128x128@2x.png": "icon-dark-256.png",
  "icon_256x256.png": "icon-dark-256.png",
  "icon_256x256@2x.png": "icon-dark-512.png",
  "icon_512x512.png": "icon-dark-512.png",
  "icon_512x512@2x.png": "icon-dark-1024.png",
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
  const rawIdentity = env.APP_CODESIGN_IDENTITY;
  const identity =
    Object.prototype.toString.call(rawIdentity) === "[object String]" ? rawIdentity.trim() : "";
  return identity ? { mode: SIGNING_MODE.DEVELOPER_ID, identity } : { mode: SIGNING_MODE.AD_HOC };
}

export function signingModeDefine(env) {
  return {
    PACKAGED_WITH_DEVELOPER_ID_SIGNING: JSON.stringify(
      resolveSigningMode(env).mode === SIGNING_MODE.DEVELOPER_ID,
    ),
  };
}

export function replayProjectKeyDefine(env) {
  const releaseBuild = resolveSigningMode(env).mode === SIGNING_MODE.DEVELOPER_ID;
  return {
    PACKAGED_POSTHOG_PROJECT_API_KEY: JSON.stringify(
      releaseBuild ? (env.POSTHOG_PROJECT_API_KEY ?? "") : "",
    ),
  };
}

export const APP_UPDATE_FEED_URL =
  "https://github.com/ReviewStage/vespin/releases/latest/download/";
export const APP_UPDATE_CACHE_DIR_NAME = `${APP_ID}.updater`;
