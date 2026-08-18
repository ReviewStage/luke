import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import {
  createPackagerOptions,
  developmentSigningIdentity,
  ICONSET_SOURCES,
  iconutilArguments,
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
const helperPaths = NATIVE_HELPERS.map((helper) =>
  path.join(appRoot, ".build", "native", helper.binary),
);
const iconsetPath = path.join(appRoot, ".build", "luke.iconset");
const iconPath = path.join(appRoot, ".build", "Luke.icns");
const licensePath = path.join(appRoot, ".build", LICENSE_RESOURCE_NAME);
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
const brandIconDirectory = path.join(repoRoot, "design", "brand", "icon");
fs.rmSync(iconsetPath, { recursive: true, force: true });
fs.mkdirSync(iconsetPath, { recursive: true });
for (const [iconsetName, sourceName] of Object.entries(ICONSET_SOURCES)) {
  const sourcePath = path.join(brandIconDirectory, sourceName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Luke brand icon source is missing: ${sourcePath}`);
  }
  fs.copyFileSync(sourcePath, path.join(iconsetPath, iconsetName));
}
execFileSync("iconutil", iconutilArguments(iconsetPath, iconPath), {
  stdio: "inherit",
});
fs.rmSync(outputRoot, { recursive: true, force: true });
const appPaths = await packager(
  createPackagerOptions({
    appRoot,
    outputRoot,
    helperPaths,
    iconPath,
    licensePath,
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
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", developmentSigningIdentity(process.env), appPath],
    { stdio: "inherit" },
  );
}
execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
  stdio: "inherit",
});
process.stdout.write(`Packaged macOS app: ${appPath}\n`);
