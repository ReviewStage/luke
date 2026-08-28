import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DMG_WINDOW } from "../../../design/dmg-window.mjs";
import {
  finalizeElectronBuilderArtifacts,
  notarizeElectronBuilderApp,
} from "./electron-builder-hooks.mjs";
import { packageAssetPaths } from "./package-assets.mjs";
import {
  APP_UPDATE_CACHE_DIR_NAME,
  APP_UPDATE_FEED_URL,
  APPLE_EVENTS_USAGE_DESCRIPTION,
  CALENDARS_USAGE_DESCRIPTION,
  CALENDARS_USAGE_KEYS,
  MACOS_DEPLOYMENT_TARGET,
  MICROPHONE_USAGE_DESCRIPTION,
  resolveSigningMode,
  SIGNING_MODE,
} from "./package-config.mjs";
import { NATIVE_HELPERS, PACKAGED_ARCHITECTURE } from "./package-layout.mjs";
import { builderReleaseArtifactDirectory, RELEASE_VOLUME_NAME } from "./release-config.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const packageAssets = packageAssetPaths({ appRoot });
const productName = desktopPackage.productName;
const electronBuilderMetadataName = "luke";
const electronBuilderMacAppPath = path.join(
  builderReleaseArtifactDirectory(repoRoot),
  `mac-${PACKAGED_ARCHITECTURE}`,
  `${productName}.app`,
);

export const ELECTRON_BUILDER_UPDATE_CACHE_DIR_NAME = APP_UPDATE_CACHE_DIR_NAME;
export const ELECTRON_BUILDER_UPDATE_FEED_URL = APP_UPDATE_FEED_URL;
export const ELECTRON_BUILDER_UPDATE_PUBLISH_CONFIG = {
  provider: "generic",
  url: ELECTRON_BUILDER_UPDATE_FEED_URL,
  updaterCacheDirName: ELECTRON_BUILDER_UPDATE_CACHE_DIR_NAME,
};
export const ELECTRON_BUILDER_GITHUB_PUBLISH_CONFIG = {
  provider: "github",
  owner: "ReviewStage",
  repo: "luke",
};

function macBinaryPath(helper) {
  if (helper.bundle) {
    return path.join("Contents", "Resources", helper.bundle, "Contents", "MacOS", helper.binary);
  }
  return path.join("Contents", "Resources", helper.binary);
}

export function createElectronBuilderConfig(env = process.env) {
  const signing = resolveSigningMode(env);
  const developerIdSigned = signing.mode === SIGNING_MODE.DEVELOPER_ID;

  return {
    // The release bundle identifier belongs to the installed production app
    // alone. An ad-hoc test package is a separate channel meant to run beside
    // it, and LaunchServices keys on the bundle identifier, so a test bundle
    // wearing the release's would shadow or be shadowed by the installed app.
    appId: developerIdSigned ? "dev.reviewstage.luke" : "dev.reviewstage.luke.test",
    productName,
    copyright: `Copyright (c) ${new Date().getFullYear()} ReviewStage`,
    electronVersion: desktopPackage.devDependencies.electron,
    generateUpdatesFilesForAllChannels: true,
    extraMetadata: {
      name: electronBuilderMetadataName,
    },
    publish: [
      { ...ELECTRON_BUILDER_UPDATE_PUBLISH_CONFIG },
      { ...ELECTRON_BUILDER_GITHUB_PUBLISH_CONFIG },
    ],
    directories: {
      output: builderReleaseArtifactDirectory(repoRoot),
    },
    asar: true,
    npmRebuild: false,
    files: ["dist/**/*", "package.json", "!dist/**/*.map"],
    extraResources: [
      ...packageAssets.helperPaths.map((helperPath) => ({
        from: helperPath,
        to: path.basename(helperPath),
      })),
      {
        from: packageAssets.licensePath,
        to: path.basename(packageAssets.licensePath),
      },
    ],
    afterSign: notarizeElectronBuilderApp,
    afterAllArtifactBuild: finalizeElectronBuilderArtifacts,
    mac: {
      category: "public.app-category.developer-tools",
      target: "default",
      artifactName: `Luke-\${version}-macos-\${arch}.\${ext}`,
      executableName: productName,
      icon: packageAssets.iconPath,
      identity: developerIdSigned ? signing.identity : "-",
      hardenedRuntime: developerIdSigned,
      gatekeeperAssess: false,
      notarize: false,
      entitlements: packageAssets.entitlementsPath,
      entitlementsInherit: packageAssets.entitlementsPath,
      minimumSystemVersion: MACOS_DEPLOYMENT_TARGET,
      binaries: NATIVE_HELPERS.filter((helper) => !helper.bundle).map(macBinaryPath),
      extendInfo: {
        CFBundleName: productName,
        CFBundleDisplayName: productName,
        LSMinimumSystemVersion: MACOS_DEPLOYMENT_TARGET,
        LSUIElement: true,
        NSAppleEventsUsageDescription: APPLE_EVENTS_USAGE_DESCRIPTION,
        ...Object.fromEntries(
          CALENDARS_USAGE_KEYS.map((key) => [key, CALENDARS_USAGE_DESCRIPTION]),
        ),
        NSMicrophoneUsageDescription: MICROPHONE_USAGE_DESCRIPTION,
        NSPrefersDisplaySafeAreaCompatibilityMode: false,
      },
    },
    dmg: {
      artifactName: `Luke-\${version}-\${arch}.\${ext}`,
      title: RELEASE_VOLUME_NAME,
      background: packageAssets.dmgBackgroundPath,
      iconSize: DMG_WINDOW.ICON_SIZE,
      iconTextSize: DMG_WINDOW.TEXT_SIZE,
      sign: true,
      window: {
        x: DMG_WINDOW.BOUNDS.LEFT,
        y: DMG_WINDOW.BOUNDS.BOTTOM,
        width: DMG_WINDOW.BOUNDS.WIDTH,
        height: DMG_WINDOW.BOUNDS.HEIGHT,
      },
      contents: [
        {
          x: DMG_WINDOW.POSITIONS.APP.X,
          y: DMG_WINDOW.POSITIONS.APP.Y,
          type: "file",
          path: electronBuilderMacAppPath,
          name: `${productName}.app`,
        },
        {
          x: DMG_WINDOW.POSITIONS.APPLICATIONS.X,
          y: DMG_WINDOW.POSITIONS.APPLICATIONS.Y,
          type: "link",
          path: "/Applications",
        },
      ],
    },
  };
}
