import { spawnSync } from "node:child_process";
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

for (const helper of NATIVE_HELPERS) {
  const source = path.join(appRoot, "native", "macos", helper.source);
  let output = path.join(outputDirectory, helper.binary);
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

  process.stdout.write(`Built macOS helper: ${output}\n`);
}
