import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DMG_WINDOW } from "@luke/brand/dmg-window";
import {
  finalizeElectronBuilderArtifacts,
  notarizeElectronBuilderApp,
} from "./electron-builder-hooks.mjs";
import { packageAssetPaths } from "./package-assets.mjs";
import {
  APP_UPDATE_CACHE_DIR_NAME,
  APP_UPDATE_FEED_URL,
  APPLE_EVENTS_USAGE_DESCRIPTION,
  MACOS_DEPLOYMENT_TARGET,
  MICROPHONE_USAGE_DESCRIPTION,
  resolveSigningMode,
  SIGNING_MODE,
} from "./package-config.mjs";
import { LIQUID_GLASS_ADDON, NATIVE_HELPERS, packagedAppPath } from "./package-layout.mjs";
import { builderReleaseArtifactDirectory, RELEASE_VOLUME_NAME } from "./release-config.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const packageAssets = packageAssetPaths({ appRoot });
const productName = desktopPackage.productName;
const electronBuilderMetadataName = "luke";
export const ELECTRON_BUILDER_UPDATE_PUBLISH_CONFIG = {
  provider: "generic",
  url: APP_UPDATE_FEED_URL,
  updaterCacheDirName: APP_UPDATE_CACHE_DIR_NAME,
};
export const ELECTRON_BUILDER_GITHUB_PUBLISH_CONFIG = {
  provider: "github",
  owner: "ReviewStage",
  repo: "luke",
};

function macBinaryPath(helper) {
  return path.join("Contents", "Resources", helper.binary);
}

export function createElectronBuilderConfig(env = process.env) {
  const signing = resolveSigningMode(env);
  const developerIdSigned = signing.mode === SIGNING_MODE.DEVELOPER_ID;

  return {
    appId: "dev.reviewstage.luke",
    productName,
    copyright: `Copyright (c) ${new Date().getFullYear()} Stage Inc.`,
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
    // Note that the packaged binary's Node switches are burnt off, because the
    // app holds the microphone and Apple Events: a process that could launch
    // it as Node (`ELECTRON_RUN_AS_NODE`), preload into it (`NODE_OPTIONS`), or
    // attach a debugger (`--inspect`) would run its own code under those
    // permissions. The app loads only from its asar, checked against the hash
    // in Info.plist, and its cookies are encrypted with the same Keychain key
    // `safeStorage` already uses. A development run (`electron .`) keeps
    // Electron's defaults.
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
    },
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
      {
        from: packageAssets.noticePath,
        to: path.basename(packageAssets.noticePath),
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
      binaries: [...NATIVE_HELPERS, LIQUID_GLASS_ADDON].map(macBinaryPath),
      // The app's own scheme, which a Luke link's "Open in Luke" page hands
      // the plan to (`src/main/services/window-service.ts`): written into the
      // bundle's CFBundleURLTypes, which macOS registers the app for.
      protocols: [{ name: "Luke link", schemes: ["tryluke"], role: "Viewer" }],
      extendInfo: {
        CFBundleName: productName,
        CFBundleDisplayName: productName,
        LSMinimumSystemVersion: MACOS_DEPLOYMENT_TARGET,
        NSAppleEventsUsageDescription: APPLE_EVENTS_USAGE_DESCRIPTION,
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
          path: packagedAppPath(repoRoot),
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
