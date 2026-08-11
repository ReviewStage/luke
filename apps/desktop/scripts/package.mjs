import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

if (process.platform !== "darwin") {
  throw new Error("Packaging Luke requires macOS");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(appRoot, "out");
const helperPath = path.join(appRoot, ".build", "native", "mac-screen-geometry");
const escapedAppRoot = appRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

if (!fs.existsSync(helperPath)) {
  throw new Error(`macOS screen-geometry helper is missing: ${helperPath}`);
}

fs.rmSync(outputRoot, { recursive: true, force: true });
const appPaths = await packager({
  dir: appRoot,
  out: outputRoot,
  name: "Luke",
  executableName: "Luke",
  appBundleId: "dev.reviewstage.luke",
  appCategoryType: "public.app-category.developer-tools",
  platform: "darwin",
  arch: process.arch,
  asar: true,
  overwrite: true,
  prune: false,
  extraResource: [helperPath],
  extendInfo: {
    CFBundleDisplayName: "Luke",
    LSUIElement: true,
    NSMicrophoneUsageDescription:
      "Luke uses microphone input when you press to talk. Audio processing stays in the active voice session.",
    NSPrefersDisplaySafeAreaCompatibilityMode: false,
  },
  ignore: [
    new RegExp(`^${escapedAppRoot}/(?:\\.build|native|node_modules|scripts|src|tests)(?:$|/)`),
    /\.map$/,
  ],
});

const packageRoot = appPaths[0];
if (!packageRoot) throw new Error("Electron Packager did not return an output path");
const appPath = path.join(packageRoot, "Luke.app");
if (!fs.existsSync(appPath)) throw new Error(`Packaged app was not found: ${appPath}`);

execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
  stdio: "inherit",
});
execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
  stdio: "inherit",
});
process.stdout.write(`Packaged macOS app: ${appPath}\n`);
