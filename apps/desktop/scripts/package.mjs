import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { buildAppIcon } from "./app-icon.mjs";
import {
  APP_UPDATE_CONFIG_FILE_NAME,
  appUpdateConfig,
  createPackagerOptions,
  LICENSE_RESOURCE_NAME,
  resolveSigningMode,
  SIGNING_MODE,
} from "./package-config.mjs";
import { NATIVE_HELPERS } from "./package-layout.mjs";

if (process.platform !== "darwin") {
  throw new Error("Packaging Luke requires macOS");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");
const outputRoot = path.join(appRoot, "out");
// A bundled helper ships as its whole bundle; the rest ship as bare binaries.
const helperPaths = NATIVE_HELPERS.map((helper) =>
  path.join(appRoot, ".build", "native", helper.bundle ?? helper.binary),
);
const licensePath = path.join(appRoot, ".build", LICENSE_RESOURCE_NAME);
const appUpdateConfigPath = path.join(appRoot, ".build", APP_UPDATE_CONFIG_FILE_NAME);
const entitlementsPath = path.join(appRoot, "native", "macos", "entitlements.plist");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const signing = resolveSigningMode(process.env);

for (const helperPath of helperPaths) {
  // A helper missing here is a feature missing at runtime with no other sign of
  // it, so the package fails rather than shipping without one.
  if (!fs.existsSync(helperPath)) {
    throw new Error(`macOS helper is missing: ${helperPath}`);
  }
}

fs.mkdirSync(path.dirname(licensePath), { recursive: true });
fs.copyFileSync(path.join(repoRoot, "LICENSE"), licensePath);
fs.writeFileSync(appUpdateConfigPath, appUpdateConfig());
const iconPath = buildAppIcon(appRoot, repoRoot);
fs.rmSync(outputRoot, { recursive: true, force: true });
const appPaths = await packager(
  createPackagerOptions({
    appRoot,
    outputRoot,
    helperPaths,
    iconPath,
    licensePath,
    appUpdateConfigPath,
    entitlementsPath,
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
if (!fs.readFileSync(packagedIconPath).equals(fs.readFileSync(iconPath))) {
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
