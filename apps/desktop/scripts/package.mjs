import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { packageAssetPaths, preparePackageAssets } from "./package-assets.mjs";
import {
  APP_UPDATE_CONFIG_FILE_NAME,
  createPackagerOptions,
  LICENSE_RESOURCE_NAME,
  resolveSigningMode,
  SIGNING_MODE,
} from "./package-config.mjs";

if (process.platform !== "darwin") {
  throw new Error("Packaging Luke requires macOS");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");
const outputRoot = path.join(appRoot, "out");
const packageAssets = packageAssetPaths({ appRoot, repoRoot });
const desktopPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const signing = resolveSigningMode(process.env);

preparePackageAssets({ repoRoot, paths: packageAssets });
fs.rmSync(outputRoot, { recursive: true, force: true });
const appPaths = await packager(
  createPackagerOptions({
    appRoot,
    outputRoot,
    helperPaths: packageAssets.helperPaths,
    iconPath: packageAssets.iconPath,
    licensePath: packageAssets.licensePath,
    appUpdateConfigPath: packageAssets.appUpdateConfigPath,
    entitlementsPath: packageAssets.entitlementsPath,
    signing,
    version: desktopPackage.version,
  }),
);

const packageRoot = appPaths[0];
if (!packageRoot) throw new Error("Electron Packager did not return an output path");
const appPath = path.join(packageRoot, "Luke.app");
if (!fs.existsSync(appPath)) throw new Error(`Packaged app was not found: ${appPath}`);
const packagedLicensePath = path.join(appPath, "Contents", "Resources", LICENSE_RESOURCE_NAME);
if (!fs.existsSync(packagedLicensePath)) {
  throw new Error(`Packaged app is missing the Luke license: ${packagedLicensePath}`);
}
// A bundle without this file updates itself to nothing: the failure surfaces
// only on a packaged build finding a newer release, which no test run does.
const packagedUpdateConfigPath = path.join(
  appPath,
  "Contents",
  "Resources",
  APP_UPDATE_CONFIG_FILE_NAME,
);
if (!fs.existsSync(packagedUpdateConfigPath)) {
  throw new Error(`Packaged app is missing its updater config: ${packagedUpdateConfigPath}`);
}
const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
const bundleIconFile = execFileSync(
  "plutil",
  ["-extract", "CFBundleIconFile", "raw", "-o", "-", infoPlistPath],
  { encoding: "utf8" },
).trim();
const packagedIconPath = path.join(appPath, "Contents", "Resources", bundleIconFile);
if (!fs.existsSync(packagedIconPath)) {
  throw new Error(`Packaged app is missing its declared icon: ${packagedIconPath}`);
}
if (!fs.readFileSync(packagedIconPath).equals(fs.readFileSync(packageAssets.iconPath))) {
  throw new Error(`Packaged app icon does not match the generated Luke icon: ${packagedIconPath}`);
}

if (signing.mode === SIGNING_MODE.AD_HOC) {
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
}
execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
  stdio: "inherit",
});
process.stdout.write(`Packaged macOS app: ${appPath}\n`);
