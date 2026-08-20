import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  awaitNotarizationDecision,
  NOTARY_POLL_INTERVAL_MS,
  NOTARY_POLL_TIMEOUT_MS,
  notaryInfoArguments,
  notaryLogArguments,
  notarySubmitArguments,
  releaseDmgFileName,
  releaseZipFileName,
  resolveNotaryCredentials,
  stapleArguments,
} from "./release-config.mjs";

export const ELECTRON_BUILDER_NOTARIZE_ENV = "LUKE_ELECTRON_BUILDER_NOTARIZE";

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

async function submitForNotarization(artifactPath, credentials) {
  let notaryOutput;
  try {
    notaryOutput = execFileSync("xcrun", notarySubmitArguments(artifactPath, credentials), {
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
    throw new Error("Could not parse the notarization response");
  }

  if (!submission.id) {
    process.stderr.write(notaryOutput);
    throw new Error("Apple did not return a notarization submission ID");
  }

  const readStatus = () => {
    try {
      return JSON.parse(
        execFileSync("xcrun", notaryInfoArguments(submission.id, credentials), {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
        }),
      ).status;
    } catch {
      return undefined;
    }
  };

  try {
    await awaitNotarizationDecision({
      readStatus,
      wait: sleep,
      intervalMs: NOTARY_POLL_INTERVAL_MS,
      timeoutMs: NOTARY_POLL_TIMEOUT_MS,
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    execFileSync("xcrun", notaryLogArguments(submission.id, credentials), {
      stdio: "inherit",
    });
    throw new Error(`Apple did not accept ${artifactPath} for notarization`, { cause: error });
  }
}

function shouldNotarize(env = process.env) {
  return env[ELECTRON_BUILDER_NOTARIZE_ENV] === "1";
}

export async function notarizeElectronBuilderApp(context) {
  if (!shouldNotarize()) return;
  const credentials = resolveNotaryCredentials(process.env);
  const appPath = path.join(context.appOutDir, "Luke.app");
  const submissionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-builder-notary-"));
  try {
    const submissionPath = path.join(submissionDirectory, "Luke.app.zip");
    execFileSync("ditto", ["-c", "-k", "--keepParent", appPath, submissionPath], {
      stdio: "inherit",
    });
    await submitForNotarization(submissionPath, credentials);
    execFileSync("xcrun", stapleArguments(appPath), { stdio: "inherit" });
  } finally {
    fs.rmSync(submissionDirectory, { recursive: true, force: true });
  }
}

function writeSha256(artifactPath) {
  const output = execFileSync("shasum", ["-a", "256", path.basename(artifactPath)], {
    cwd: path.dirname(artifactPath),
    encoding: "utf8",
  });
  fs.writeFileSync(`${artifactPath}.sha256`, output);
  return `${artifactPath}.sha256`;
}

export async function finalizeElectronBuilderArtifacts(buildResult) {
  const artifacts = [...buildResult.artifactPaths];
  const { version } = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const outputDirectory = buildResult.outDir;
  const dmgPath = path.join(outputDirectory, releaseDmgFileName(version));
  const zipPath = path.join(outputDirectory, releaseZipFileName(version));
  if (!fs.existsSync(dmgPath)) throw new Error(`electron-builder did not write ${dmgPath}`);
  if (!fs.existsSync(zipPath)) throw new Error(`electron-builder did not write ${zipPath}`);

  if (shouldNotarize()) {
    const credentials = resolveNotaryCredentials(process.env);
    await submitForNotarization(dmgPath, credentials);
    execFileSync("xcrun", stapleArguments(dmgPath), { stdio: "inherit" });
  }

  const latestDmgPath = path.join(outputDirectory, "Luke.dmg");
  fs.copyFileSync(dmgPath, latestDmgPath);
  artifacts.push(latestDmgPath, writeSha256(dmgPath), writeSha256(zipPath));
  return artifacts;
}
