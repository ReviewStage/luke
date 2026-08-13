import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packagedAppExecutable } from "./package-layout.mjs";
import {
  DMG_STAGING_ENTRIES,
  dmgCodesignArguments,
  dmgVerificationCommands,
  hdiutilCreateArguments,
  notaryLogArguments,
  notarySubmitArguments,
  releaseArtifactDirectory,
  releaseDmgFileName,
  resolveReleaseSigning,
  stapleArguments,
} from "./release-config.mjs";

if (process.platform !== "darwin") {
  throw new Error("Releasing Luke requires macOS");
}

const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--skip-notarization");
if (unknownArguments.length > 0) {
  throw new Error(`Unknown release argument: ${unknownArguments[0]}`);
}

const skipNotarization = process.argv.includes("--skip-notarization");
const signing = resolveReleaseSigning(process.env);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const appExecutable = packagedAppExecutable(repoRoot);
const appPath = path.dirname(path.dirname(path.dirname(appExecutable)));

if (!fs.existsSync(appExecutable)) {
  throw new Error(`Packaged app was not found: ${appPath}. Run pnpm package first.`);
}

execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });

const signatureCaptureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-signature-"));
let signatureOutput;
try {
  const signatureOutputPath = path.join(signatureCaptureDirectory, "codesign.txt");
  const signatureOutputDescriptor = fs.openSync(signatureOutputPath, "w");
  try {
    execFileSync("codesign", ["--display", "--verbose=2", appPath], {
      stdio: ["ignore", "inherit", signatureOutputDescriptor],
    });
  } finally {
    fs.closeSync(signatureOutputDescriptor);
  }
  signatureOutput = fs.readFileSync(signatureOutputPath, "utf8");
} finally {
  fs.rmSync(signatureCaptureDirectory, { recursive: true, force: true });
}
process.stdout.write(signatureOutput);
if (!signatureOutput.includes(`Authority=${signing.identity}`)) {
  throw new Error(`Packaged app is not signed by ${signing.identity}. Run pnpm package first.`);
}

const artifactDirectory = releaseArtifactDirectory(repoRoot);
const dmgPath = path.join(artifactDirectory, releaseDmgFileName(desktopPackage.version));
const stagingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-dmg-"));

function runVerificationCommands(commands) {
  for (const { command, arguments: commandArguments } of commands) {
    execFileSync(command, commandArguments, { stdio: "inherit" });
  }
}

try {
  for (const entry of DMG_STAGING_ENTRIES) {
    const destination = path.join(stagingDirectory, entry.name);
    if (entry.kind === "application") {
      execFileSync("ditto", [appPath, destination], { stdio: "inherit" });
    } else {
      fs.symlinkSync(entry.target, destination);
    }
  }

  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.rmSync(dmgPath, { force: true });
  execFileSync("hdiutil", hdiutilCreateArguments({ stagingDirectory, dmgPath }), {
    stdio: "inherit",
  });
  execFileSync("codesign", dmgCodesignArguments(signing.identity, dmgPath), { stdio: "inherit" });

  const verificationCommands = dmgVerificationCommands(dmgPath);
  if (skipNotarization) {
    runVerificationCommands([verificationCommands[0], verificationCommands[3]]);
    process.stdout.write(
      "Notarization SKIPPED: this DMG is signed but not ready for distribution.\n",
    );
  } else {
    let notaryOutput;
    try {
      notaryOutput = execFileSync("xcrun", notarySubmitArguments(dmgPath), {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      });
    } catch (error) {
      notaryOutput = error.stdout?.toString() ?? "";
      if (!notaryOutput) throw error;
    }

    let submission;
    try {
      submission = JSON.parse(notaryOutput);
    } catch {
      process.stderr.write(notaryOutput);
      throw new Error(
        "Could not parse the notarization response. Configure credentials with: xcrun notarytool store-credentials luke-notary",
      );
    }

    if (submission.status !== "Accepted") {
      process.stderr.write(`Notarization failed with status: ${submission.status ?? "unknown"}\n`);
      if (submission.id) {
        execFileSync("xcrun", notaryLogArguments(submission.id), { stdio: "inherit" });
      }
      throw new Error("Apple did not accept the DMG for notarization");
    }

    execFileSync("xcrun", stapleArguments(dmgPath), { stdio: "inherit" });
    runVerificationCommands(verificationCommands);
  }

  const sizeInMegabytes = (fs.statSync(dmgPath).size / 1_000_000).toFixed(1);
  process.stdout.write(`Released macOS DMG: ${dmgPath} (${sizeInMegabytes} MB)\n`);
} finally {
  fs.rmSync(stagingDirectory, { recursive: true, force: true });
}
