import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DMG_WINDOW } from "../../../design/dmg-window.mjs";
import { iconutilArguments } from "./package-config.mjs";
import { packagedAppExecutable } from "./package-layout.mjs";
import {
  awaitNotarizationDecision,
  codesignDisplayArguments,
  DMG_MOUNT_POINT,
  DMG_STAGING_ENTRIES,
  DMG_VOLUME_ICON_FILE_NAME,
  dmgCodesignArguments,
  dmgStoreLayout,
  dmgVerificationCommands,
  hdiutilAttachArguments,
  hdiutilConvertArguments,
  hdiutilCreateArguments,
  hdiutilDetachArguments,
  INSTALLER_ICONSET_SOURCES,
  notaryInfoArguments,
  notaryLogArguments,
  notarySubmitArguments,
  releaseArtifactDirectory,
  releaseDmgFileName,
  releaseSignatureMatchesIdentity,
  releaseZipFileName,
  resolveNotaryCredentials,
  resolveReleaseSigning,
  stapleArguments,
  tiffutilHiDpiArguments,
  volumeCustomIconArguments,
  withMountedDmg,
} from "./release-config.mjs";

if (process.platform !== "darwin") {
  throw new Error("Releasing Luke requires macOS");
}

const { default: DSStore } = await import("ds-store");

const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--skip-notarization");
if (unknownArguments.length > 0) {
  throw new Error(`Unknown release argument: ${unknownArguments[0]}`);
}

const skipNotarization = process.argv.includes("--skip-notarization");
const signing = resolveReleaseSigning(process.env);
const notaryCredentials = skipNotarization ? undefined : resolveNotaryCredentials(process.env);
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
let certificateSha1;
try {
  const signatureOutputPath = path.join(signatureCaptureDirectory, "codesign.txt");
  const certificatePrefix = path.join(signatureCaptureDirectory, "certificate");
  const signatureOutputDescriptor = fs.openSync(signatureOutputPath, "w");
  try {
    execFileSync("codesign", codesignDisplayArguments(certificatePrefix, appPath), {
      stdio: ["ignore", "inherit", signatureOutputDescriptor],
    });
  } finally {
    fs.closeSync(signatureOutputDescriptor);
  }
  signatureOutput = fs.readFileSync(signatureOutputPath, "utf8");
  certificateSha1 = createHash("sha1")
    .update(fs.readFileSync(`${certificatePrefix}0`))
    .digest("hex");
} finally {
  fs.rmSync(signatureCaptureDirectory, { recursive: true, force: true });
}
process.stdout.write(signatureOutput);
const authority = signatureOutput.match(/^Authority=(.+)$/m)?.[1];
if (
  !releaseSignatureMatchesIdentity({
    identity: signing.identity,
    authority,
    certificateSha1,
  })
) {
  throw new Error(`Packaged app is not signed by ${signing.identity}. Run pnpm package first.`);
}

const artifactDirectory = releaseArtifactDirectory(repoRoot);
const dmgPath = path.join(artifactDirectory, releaseDmgFileName(desktopPackage.version));
const stagingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-dmg-"));
const dmgBackgroundDirectory = path.join(repoRoot, "design", "brand", "dmg");

function runVerificationCommands(commands) {
  for (const { command, arguments: commandArguments } of commands) {
    execFileSync(command, commandArguments, { stdio: "inherit" });
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function detachMountedImage(mountPoint) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      execFileSync("hdiutil", hdiutilDetachArguments(mountPoint), { stdio: "inherit" });
      return;
    } catch {
      sleep(1_000);
    }
  }
  execFileSync("hdiutil", hdiutilDetachArguments(mountPoint, { force: true }), {
    stdio: "inherit",
  });
}

function writeDmgStore(storePath, layout) {
  const store = new DSStore();
  store.vSrn(layout.version);
  store.setIconSize(layout.iconSize);
  store.setBackgroundPath(layout.backgroundPath);
  store.setWindowPos(layout.window.x, layout.window.y);
  store.setWindowSize(layout.window.width, layout.window.height);
  for (const icon of layout.icons) store.setIconPos(icon.name, icon.X, icon.Y);
  return new Promise((resolve, reject) => {
    store.write(storePath, (error) => (error ? reject(error) : resolve()));
  });
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

  // The volume wears the installer icon — the face on a drive silhouette,
  // deliberately not the app's own squircle, so the mounted volume cannot
  // pass for the Luke.app beside it — cut here from the same generated brand
  // assets the app icon is cut from.
  const brandIconDirectory = path.join(repoRoot, "design", "brand", "icon");
  const iconsetScratch = fs.mkdtempSync(path.join(os.tmpdir(), "luke-installer-icon-"));
  try {
    const iconsetPath = path.join(iconsetScratch, "installer.iconset");
    fs.mkdirSync(iconsetPath);
    for (const [iconsetName, sourceName] of Object.entries(INSTALLER_ICONSET_SOURCES)) {
      fs.copyFileSync(
        path.join(brandIconDirectory, sourceName),
        path.join(iconsetPath, iconsetName),
      );
    }
    execFileSync(
      "iconutil",
      iconutilArguments(iconsetPath, path.join(stagingDirectory, DMG_VOLUME_ICON_FILE_NAME)),
      { stdio: "inherit" },
    );
  } finally {
    fs.rmSync(iconsetScratch, { recursive: true, force: true });
  }

  const stagingBackgroundDirectory = path.join(stagingDirectory, DMG_WINDOW.BACKGROUND.DIRECTORY);
  fs.mkdirSync(stagingBackgroundDirectory);
  execFileSync(
    "tiffutil",
    tiffutilHiDpiArguments({
      pngPath: path.join(dmgBackgroundDirectory, "luke-dmg-background.png"),
      png2xPath: path.join(dmgBackgroundDirectory, "luke-dmg-background@2x.png"),
      tiffPath: path.join(stagingBackgroundDirectory, DMG_WINDOW.BACKGROUND.FILE_NAME),
    }),
    { stdio: "inherit" },
  );

  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.rmSync(dmgPath, { force: true });
  const imageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "luke-dmg-image-"));
  try {
    const imagePath = path.join(imageDirectory, "Luke-rw.dmg");
    execFileSync("hdiutil", hdiutilCreateArguments({ stagingDirectory, imagePath }), {
      stdio: "inherit",
    });

    if (fs.existsSync(DMG_MOUNT_POINT)) {
      throw new Error(`${DMG_MOUNT_POINT} is already mounted. Eject it and re-run.`);
    }

    await withMountedDmg({
      attach: () =>
        execFileSync("hdiutil", hdiutilAttachArguments(imagePath), {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
        }),
      detach: detachMountedImage,
      use: async (mountPoint) => {
        if (mountPoint !== DMG_MOUNT_POINT) {
          throw new Error(
            `Expected the DMG at ${DMG_MOUNT_POINT}, but hdiutil mounted ${mountPoint}`,
          );
        }
        const storePath = path.join(mountPoint, ".DS_Store");
        fs.rmSync(storePath, { force: true });
        await writeDmgStore(storePath, dmgStoreLayout(mountPoint));
        execFileSync("xcrun", volumeCustomIconArguments(mountPoint), { stdio: "inherit" });
        execFileSync("sync", [], { stdio: "inherit" });
      },
    });

    execFileSync("hdiutil", hdiutilConvertArguments({ imagePath, dmgPath }), {
      stdio: "inherit",
    });
  } finally {
    fs.rmSync(imageDirectory, { recursive: true, force: true });
  }
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
      notaryOutput = execFileSync("xcrun", notarySubmitArguments(dmgPath, notaryCredentials), {
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
        "Could not parse the notarization response. Configure credentials with: xcrun notarytool store-credentials luke-notary, or set APPLE_API_KEY_PATH, APPLE_API_KEY_ID, and APPLE_API_ISSUER_ID",
      );
    }

    if (!submission.id) {
      process.stderr.write(notaryOutput);
      throw new Error("Apple did not return a notarization submission ID");
    }

    // A lookup that fails or answers unreadably is a blip in the poll, not a
    // verdict on a submission Apple already holds: reporting no status leaves
    // the loop waiting, and notarytool's own complaint has reached stderr.
    const readNotarizationStatus = () => {
      try {
        return JSON.parse(
          execFileSync("xcrun", notaryInfoArguments(submission.id, notaryCredentials), {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "inherit"],
          }),
        ).status;
      } catch {
        return undefined;
      }
    };

    try {
      await awaitNotarizationDecision({ readStatus: readNotarizationStatus, wait: sleep });
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      execFileSync("xcrun", notaryLogArguments(submission.id, notaryCredentials), {
        stdio: "inherit",
      });
      throw new Error("Apple did not accept the DMG for notarization", { cause: error });
    }

    execFileSync("xcrun", stapleArguments(dmgPath), { stdio: "inherit" });
    runVerificationCommands(verificationCommands);

    // The DMG's notarization covers the app inside it, so the app can carry
    // its own ticket too — and the zip archived from it is what Squirrel.Mac
    // will one day update from, so it exists only on the notarized path: an
    // archive that Gatekeeper would refuse is not a release asset.
    execFileSync("xcrun", stapleArguments(appPath), { stdio: "inherit" });
    const zipPath = path.join(artifactDirectory, releaseZipFileName(desktopPackage.version));
    fs.rmSync(zipPath, { force: true });
    execFileSync("ditto", ["-c", "-k", "--keepParent", appPath, zipPath], { stdio: "inherit" });
    process.stdout.write(`Released macOS archive: ${zipPath}\n`);
  }

  const sizeInMegabytes = (fs.statSync(dmgPath).size / 1_000_000).toFixed(1);
  process.stdout.write(`Released macOS DMG: ${dmgPath} (${sizeInMegabytes} MB)\n`);
} finally {
  fs.rmSync(stagingDirectory, { recursive: true, force: true });
}
