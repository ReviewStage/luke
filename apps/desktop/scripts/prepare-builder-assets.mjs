import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  packageAssetPaths,
  prepareElectronBuilderDmgAssets,
  preparePackageAssets,
} from "./package-assets.mjs";

if (process.platform !== "darwin") {
  throw new Error("Preparing electron-builder assets for Luke requires macOS");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");
const packageAssets = packageAssetPaths({ appRoot });

preparePackageAssets({ repoRoot, paths: packageAssets });
prepareElectronBuilderDmgAssets({ repoRoot, paths: packageAssets });
