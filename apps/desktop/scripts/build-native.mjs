import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { swiftCompilerArguments } from "./package-config.mjs";
import { NATIVE_HELPERS } from "./package-layout.mjs";

if (process.platform !== "darwin") {
  process.stdout.write("Skipping the macOS helpers on this platform.\n");
  process.exit(0);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(appRoot, ".build", "native");

fs.mkdirSync(outputDirectory, { recursive: true });

for (const helper of NATIVE_HELPERS) {
  const source = path.join(appRoot, "native", "macos", helper.source);
  const output = path.join(outputDirectory, helper.binary);
  const result = spawnSync("xcrun", swiftCompilerArguments(source, output, helper.frameworks), {
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Could not build the macOS ${helper.binary} helper (${result.status})`);
  }

  process.stdout.write(`Built macOS helper: ${output}\n`);
}
