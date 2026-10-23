import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BRAND_ASSETS_DIRECTORY } from "@luke/brand/assets-directory";
import { DMG_WINDOW } from "@luke/brand/dmg-window";
import { buildAppIcon } from "./app-icon.mjs";
import { LICENSE_RESOURCE_NAME, NOTICE_RESOURCE_NAME } from "./package-config.mjs";
import { NATIVE_HELPERS } from "./package-layout.mjs";

export function packageAssetPaths({ appRoot }) {
  const helperPaths = NATIVE_HELPERS.map((helper) =>
    path.join(appRoot, ".build", "native", helper.binary),
  );
  const iconPath = path.join(appRoot, ".build", "Luke.icns");
  const licensePath = path.join(appRoot, ".build", LICENSE_RESOURCE_NAME);
  const noticePath = path.join(appRoot, ".build", NOTICE_RESOURCE_NAME);
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
    noticePath,
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
  fs.copyFileSync(path.join(repoRoot, "NOTICE"), paths.noticePath);
  buildAppIcon(paths.appRoot);
}

export function prepareElectronBuilderDmgAssets({ paths }) {
  const dmgBackgroundDirectory = path.join(BRAND_ASSETS_DIRECTORY, "dmg");
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
