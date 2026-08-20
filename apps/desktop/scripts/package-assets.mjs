import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DMG_WINDOW } from "../../../design/dmg-window.mjs";
import { buildAppIcon } from "./app-icon.mjs";
import {
  APP_UPDATE_CONFIG_FILE_NAME,
  appUpdateConfig,
  LICENSE_RESOURCE_NAME,
} from "./package-config.mjs";
import { NATIVE_HELPERS } from "./package-layout.mjs";

export function packageAssetPaths({ appRoot }) {
  const helperPaths = NATIVE_HELPERS.map((helper) =>
    path.join(appRoot, ".build", "native", helper.bundle ?? helper.binary),
  );
  const iconPath = path.join(appRoot, ".build", "Luke.icns");
  const licensePath = path.join(appRoot, ".build", LICENSE_RESOURCE_NAME);
  const appUpdateConfigPath = path.join(appRoot, ".build", APP_UPDATE_CONFIG_FILE_NAME);
  const entitlementsPath = path.join(appRoot, "native", "macos", "entitlements.plist");
  const dmgBackgroundPath = path.join(
    appRoot,
    ".build",
    "electron-builder",
    DMG_WINDOW.BACKGROUND.FILE_NAME,
  );
  return {
    appRoot,
    helperPaths,
    iconPath,
    licensePath,
    appUpdateConfigPath,
    entitlementsPath,
    dmgBackgroundPath,
  };
}

export function preparePackageAssets({ repoRoot, paths }) {
  for (const helperPath of paths.helperPaths) {
    // A helper missing here is a feature missing at runtime with no other sign of
    // it, so the package fails rather than shipping without one.
    if (!fs.existsSync(helperPath)) {
      throw new Error(`macOS helper is missing: ${helperPath}`);
    }
  }

  fs.mkdirSync(path.dirname(paths.licensePath), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "LICENSE"), paths.licensePath);
  fs.writeFileSync(paths.appUpdateConfigPath, appUpdateConfig());
  buildAppIcon(paths.appRoot, repoRoot);
}

export function prepareElectronBuilderDmgAssets({ repoRoot, paths }) {
  const dmgBackgroundDirectory = path.join(repoRoot, "design", "brand", "dmg");
  fs.mkdirSync(path.dirname(paths.dmgBackgroundPath), { recursive: true });
  execFileSync(
    "tiffutil",
    [
      "-cathidpicheck",
      path.join(dmgBackgroundDirectory, "luke-dmg-background.png"),
      path.join(dmgBackgroundDirectory, "luke-dmg-background@2x.png"),
      "-out",
      paths.dmgBackgroundPath,
    ],
    { stdio: "inherit" },
  );
}
