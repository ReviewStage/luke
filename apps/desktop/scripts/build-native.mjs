import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { swiftCompilerArguments } from "./package-config.mjs";
import { LIQUID_GLASS_ADDON, NATIVE_HELPERS, NODE_PTY } from "./package-layout.mjs";

if (process.platform !== "darwin") {
  process.stdout.write("Skipping the macOS helpers on this platform.\n");
  process.exit(0);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(appRoot, ".build", "native");

fs.mkdirSync(outputDirectory, { recursive: true });

const toolchain = spawnSync("xcrun", ["--find", "swiftc"], { encoding: "utf8" });
const toolchainVersion = spawnSync("xcrun", ["swiftc", "--version"], { encoding: "utf8" });
const scriptSources = ["build-native.mjs", "package-config.mjs", "package-layout.mjs"]
  .map((name) => fs.readFileSync(path.join(scriptDirectory, name)))
  .concat(Buffer.from(`${toolchain.stdout ?? ""}\n${toolchainVersion.stdout ?? ""}`));

function helperStamp(source) {
  const hash = createHash("sha256");
  for (const part of scriptSources) hash.update(part);
  hash.update(fs.readFileSync(source));
  return hash.digest("hex");
}

for (const helper of NATIVE_HELPERS) {
  const source = path.join(appRoot, "native", "macos", helper.source);
  const output = path.join(outputDirectory, helper.binary);
  const stampPath = path.join(outputDirectory, `${helper.binary}.stamp`);
  const stamp = helperStamp(source);
  if (
    fs.existsSync(output) &&
    fs.existsSync(stampPath) &&
    fs.readFileSync(stampPath, "utf8") === stamp
  ) {
    process.stdout.write(`Kept macOS helper: ${output}\n`);
    continue;
  }
  fs.rmSync(stampPath, { force: true });
  const result = spawnSync("xcrun", swiftCompilerArguments(source, output, helper.frameworks), {
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Could not build the macOS ${helper.binary} helper (${result.status})`);
  }

  fs.writeFileSync(stampPath, stamp);
  process.stdout.write(`Built macOS helper: ${output}\n`);
}

const liquidGlassSource = path.join(
  appRoot,
  "node_modules",
  LIQUID_GLASS_ADDON.packageName,
  LIQUID_GLASS_ADDON.prebuild,
);
if (!fs.existsSync(liquidGlassSource)) {
  throw new Error(
    `The Liquid Glass addon is missing (${liquidGlassSource}): ${LIQUID_GLASS_ADDON.packageName} did not install. Run ./scripts/bootstrap.sh and read its output.`,
  );
}
fs.copyFileSync(liquidGlassSource, path.join(outputDirectory, LIQUID_GLASS_ADDON.binary));
process.stdout.write(`Copied the Liquid Glass addon: ${LIQUID_GLASS_ADDON.binary}\n`);

const nodePtySource = path.join(appRoot, "node_modules", NODE_PTY.packageName);
const nodePtyOutput = path.join(outputDirectory, NODE_PTY.folder);
const nodePtyPrebuilds = path.join(nodePtySource, NODE_PTY.prebuilds);
if (!fs.existsSync(nodePtyPrebuilds)) {
  throw new Error(
    `node-pty's prebuilds are missing (${nodePtyPrebuilds}): ${NODE_PTY.packageName} did not install. Run ./scripts/bootstrap.sh and read its output.`,
  );
}
fs.rmSync(nodePtyOutput, { recursive: true, force: true });
fs.mkdirSync(nodePtyOutput, { recursive: true });
fs.copyFileSync(path.join(nodePtySource, "package.json"), path.join(nodePtyOutput, "package.json"));
fs.cpSync(path.join(nodePtySource, "lib"), path.join(nodePtyOutput, "lib"), {
  recursive: true,
  filter: (source) => !source.endsWith(".map") && !source.endsWith(".test.js"),
});
fs.cpSync(nodePtyPrebuilds, path.join(nodePtyOutput, NODE_PTY.prebuilds), { recursive: true });
fs.chmodSync(path.join(nodePtyOutput, NODE_PTY.prebuilds, "spawn-helper"), 0o755);
process.stdout.write(`Copied node-pty: ${NODE_PTY.folder}\n`);
