import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import {
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
const helperPath = path.join(appRoot, ".build", "native", "mac-screen-geometry");
const licensePath = path.join(appRoot, ".build", LICENSE_RESOURCE_NAME);
const entitlementsPath = path.join(appRoot, "native", "macos", "entitlements.plist");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const signing = resolveSigningMode(process.env);

if (!fs.existsSync(helperPath)) {
  throw new Error(`macOS screen-geometry helper is missing: ${helperPath}`);
}

fs.mkdirSync(path.dirname(licensePath), { recursive: true });
fs.copyFileSync(path.join(repoRoot, "LICENSE"), licensePath);
fs.rmSync(outputRoot, { recursive: true, force: true });
const appPaths = await packager(
  createPackagerOptions({
    appRoot,
    outputRoot,
    helperPath,
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

if (signing.mode === SIGNING_MODE.AD_HOC) {
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
}
execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
  stdio: "inherit",
});
process.stdout.write(`Packaged macOS app: ${appPath}\n`);
