import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppIcon } from "./app-icon.mjs";
import {
  addonCompilerArguments,
  appleCalendarHelperInfoPlist,
  swiftCompilerArguments,
} from "./package-config.mjs";
import { NATIVE_HELPERS } from "./package-layout.mjs";

if (process.platform !== "darwin") {
  process.stdout.write("Skipping the macOS helpers on this platform.\n");
  process.exit(0);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");
const outputDirectory = path.join(appRoot, ".build", "native");

fs.mkdirSync(outputDirectory, { recursive: true });

// A helper is rebuilt only when what produced it changed: its source, the
// scripts that compose the compiler arguments and bundle, the toolchain, and
// for the bundled helper its plist and icon. The record is a content hash
// rather than an mtime, because a cache restored on a CI runner and a fresh
// checkout both carry mtimes that say nothing about the bytes.
const toolchain = spawnSync("xcrun", ["--find", "swiftc"], { encoding: "utf8" });
const toolchainVersion = spawnSync("xcrun", ["swiftc", "--version"], { encoding: "utf8" });
const scriptSources = [
  "build-native.mjs",
  "package-config.mjs",
  "package-layout.mjs",
  "app-icon.mjs",
]
  .map((name) => fs.readFileSync(path.join(scriptDirectory, name)))
  .concat(Buffer.from(`${toolchain.stdout ?? ""}\n${toolchainVersion.stdout ?? ""}`));

function helperStamp(source, bundleInputs) {
  const hash = createHash("sha256");
  for (const part of scriptSources) hash.update(part);
  hash.update(fs.readFileSync(source));
  for (const part of bundleInputs) hash.update(part);
  return hash.digest("hex");
}

for (const helper of NATIVE_HELPERS) {
  const source = path.join(appRoot, "native", "macos", helper.source);
  let output = path.join(outputDirectory, helper.binary);
  const stampPath = path.join(outputDirectory, `${helper.binary}.stamp`);
  const bundleInputs = helper.bundle
    ? [
        Buffer.from(appleCalendarHelperInfoPlist()),
        fs.readFileSync(buildAppIcon(appRoot, repoRoot)),
      ]
    : [];
  const stamp = helperStamp(source, bundleInputs);
  const builtOutput = helper.bundle
    ? path.join(outputDirectory, helper.bundle, "Contents", "MacOS", helper.binary)
    : output;
  if (
    fs.existsSync(builtOutput) &&
    fs.existsSync(stampPath) &&
    fs.readFileSync(stampPath, "utf8") === stamp
  ) {
    process.stdout.write(`Kept macOS helper: ${builtOutput}\n`);
    continue;
  }
  fs.rmSync(stampPath, { force: true });
  if (helper.bundle) {
    // A bundled helper is compiled straight into its minimal app bundle: the
    // Info.plist is what the consent dialog is judged against and named
    // from, so it is written beside the binary rather than linked into it,
    // and the icon rides along because the System Settings consent row draws
    // the bundle's own.
    const contents = path.join(outputDirectory, helper.bundle, "Contents");
    fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
    fs.mkdirSync(path.join(contents, "Resources"), { recursive: true });
    fs.writeFileSync(path.join(contents, "Info.plist"), appleCalendarHelperInfoPlist());
    fs.copyFileSync(buildAppIcon(appRoot, repoRoot), path.join(contents, "Resources", "Luke.icns"));
    output = path.join(contents, "MacOS", helper.binary);
  }
  const compilerArguments = helper.source.endsWith(".swift")
    ? swiftCompilerArguments(source, output, helper.frameworks)
    : addonCompilerArguments(source, output, helper.frameworks);
  const result = spawnSync("xcrun", compilerArguments, {
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Could not build the macOS ${helper.binary} helper (${result.status})`);
  }

  if (helper.bundle) {
    // The bundle's seal covers the plist the dialog reads its name from. The
    // Developer ID packaging pass signs it again; this ad-hoc seal is what
    // stands everywhere else.
    const signed = spawnSync(
      "codesign",
      ["--force", "--deep", "--sign", "-", path.join(outputDirectory, helper.bundle)],
      { stdio: "inherit" },
    );
    if (signed.status !== 0) {
      throw new Error(`Could not sign the macOS ${helper.bundle} helper bundle`);
    }
  }

  fs.writeFileSync(stampPath, stamp);
  process.stdout.write(`Built macOS helper: ${output}\n`);
}
