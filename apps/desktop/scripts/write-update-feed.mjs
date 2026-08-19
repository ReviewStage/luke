import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  releaseArtifactDirectory,
  releaseUpdateManifest,
  releaseZipFileName,
} from "./release-config.mjs";

// Writes the electron-updater manifest for the version about to be published,
// hashed from the very archive the release uploads, so both publish paths —
// the manual script and the tag-push workflow — upload the same document they
// could never hand-compose consistently.

const outputPath = process.argv[2];
if (!outputPath) {
  process.stderr.write("usage: node write-update-feed.mjs <output-path>\n");
  process.exit(1);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..", "..", "..");
const require = createRequire(import.meta.url);
const desktopPackage = require(path.join(scriptDirectory, "..", "package.json"));

const zipPath = path.join(
  releaseArtifactDirectory(repoRoot),
  releaseZipFileName(desktopPackage.version),
);
if (!fs.existsSync(zipPath)) {
  process.stderr.write(`error: ${zipPath} does not exist. Build the release archive first.\n`);
  process.exit(1);
}

const archive = fs.readFileSync(zipPath);
const manifest = releaseUpdateManifest({
  version: desktopPackage.version,
  sha512: crypto.createHash("sha512").update(archive).digest("base64"),
  size: archive.byteLength,
  releaseDate: new Date().toISOString(),
});
fs.writeFileSync(outputPath, manifest);
process.stdout.write(`Wrote update manifest for ${desktopPackage.version}: ${outputPath}\n`);
