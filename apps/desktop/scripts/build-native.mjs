import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { swiftCompilerArguments } from "./package-config.mjs";

if (process.platform !== "darwin") {
  process.stdout.write("Skipping the macOS screen-geometry helper on this platform.\n");
  process.exit(0);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const source = path.join(appRoot, "native", "macos", "ScreenGeometry.swift");
const outputDirectory = path.join(appRoot, ".build", "native");
const output = path.join(outputDirectory, "mac-screen-geometry");

fs.mkdirSync(outputDirectory, { recursive: true });
const result = spawnSync("xcrun", swiftCompilerArguments(source, output), { stdio: "inherit" });

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Could not build the macOS screen-geometry helper (${result.status})`);
}

process.stdout.write(`Built macOS screen-geometry helper: ${output}\n`);
