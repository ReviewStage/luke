import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PACKAGED_ARCHITECTURE } from "../apps/desktop/scripts/package-layout.mjs";
import {
  codesignDisplayArguments,
  DMG_STAGING_ENTRIES,
  dmgCodesignArguments,
  dmgVerificationCommands,
  hdiutilCreateArguments,
  notaryLogArguments,
  notarySubmitArguments,
  releaseArtifactDirectory,
  releaseDmgFileName,
  releaseSignatureMatchesIdentity,
  resolveReleaseSigning,
  stapleArguments,
} from "../apps/desktop/scripts/release-config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("release DMG names include the desktop version and packaged architecture", () => {
  const desktopPackage = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "apps", "desktop", "package.json"), "utf8"),
  );

  assert.equal(releaseDmgFileName("0.1.0"), "Luke-0.1.0-arm64.dmg");
  assert.equal(
    releaseDmgFileName(desktopPackage.version),
    `Luke-${desktopPackage.version}-${PACKAGED_ARCHITECTURE}.dmg`,
  );
});

test("release signing requires a Developer ID identity", () => {
  assert.throws(() => resolveReleaseSigning({}), /LUKE_CODESIGN_IDENTITY/);
  assert.throws(
    () => resolveReleaseSigning({ LUKE_CODESIGN_IDENTITY: "  " }),
    /LUKE_CODESIGN_IDENTITY/,
  );
  assert.deepEqual(
    resolveReleaseSigning({ LUKE_CODESIGN_IDENTITY: "Developer ID Application: Example" }),
    {
      identity: "Developer ID Application: Example",
    },
  );
});

test("release signing accepts readable identities and SHA-1 certificate hashes", () => {
  assert.equal(
    releaseSignatureMatchesIdentity({
      identity: "Developer ID Application: Example (TEAMID)",
      authority: "Developer ID Application: Example (TEAMID)",
      certificateSha1: "unused",
    }),
    true,
  );
  assert.equal(
    releaseSignatureMatchesIdentity({
      identity: "3E4A41C54E100FFC57BC2C6AA19409467994D4B5",
      authority: "Developer ID Application: Example (TEAMID)",
      certificateSha1: "3e4a41c54e100ffc57bc2c6aa19409467994d4b5",
    }),
    true,
  );
  assert.equal(
    releaseSignatureMatchesIdentity({
      identity: "3E4A41C54E100FFC57BC2C6AA19409467994D4B5",
      authority: "Developer ID Application: Example (TEAMID)",
      certificateSha1: "0000000000000000000000000000000000000000",
    }),
    false,
  );
  assert.equal(
    releaseSignatureMatchesIdentity({
      identity: "3E4A41C54E100FFC57BC2C6AA19409467994D4B5",
      authority: "Developer ID Application: Example (TEAMID)",
    }),
    false,
  );
});

test("release certificate extraction attaches the output prefix to the codesign flag", () => {
  assert.deepEqual(codesignDisplayArguments("/tmp/certificate", "/tmp/Luke.app"), [
    "--display",
    "--verbose=2",
    "--extract-certificates=/tmp/certificate",
    "/tmp/Luke.app",
  ]);
});

test("release DMG layout and hdiutil arguments are deterministic", () => {
  assert.deepEqual(DMG_STAGING_ENTRIES, [
    { name: "Luke.app", kind: "application" },
    { name: "Applications", kind: "symlink", target: "/Applications" },
  ]);
  assert.deepEqual(
    hdiutilCreateArguments({
      stagingDirectory: "/tmp/staging",
      dmgPath: "/repo/artifacts/Luke.dmg",
    }),
    [
      "create",
      "-volname",
      "Luke",
      "-srcfolder",
      "/tmp/staging",
      "-fs",
      "APFS",
      "-format",
      "UDZO",
      "-ov",
      "/repo/artifacts/Luke.dmg",
    ],
  );
});

test("release notarization commands use the local keychain profile", () => {
  assert.deepEqual(notarySubmitArguments("/tmp/Luke.dmg"), [
    "notarytool",
    "submit",
    "/tmp/Luke.dmg",
    "--keychain-profile",
    "luke-notary",
    "--wait",
    "--timeout",
    "20m",
    "--output-format",
    "json",
  ]);
  assert.deepEqual(notaryLogArguments("submission-id"), [
    "notarytool",
    "log",
    "submission-id",
    "--keychain-profile",
    "luke-notary",
  ]);
  assert.deepEqual(stapleArguments("/tmp/Luke.dmg"), ["stapler", "staple", "/tmp/Luke.dmg"]);
  assert.deepEqual(dmgCodesignArguments("Developer ID Application: Example", "/tmp/Luke.dmg"), [
    "--sign",
    "Developer ID Application: Example",
    "--timestamp",
    "/tmp/Luke.dmg",
  ]);
});

test("release artifacts stay under the repository artifacts directory", () => {
  assert.equal(releaseArtifactDirectory("/repo"), path.join("/repo", "artifacts", "release"));
});

test("release verification covers signing, Gatekeeper, stapling, and disk image integrity", () => {
  assert.deepEqual(dmgVerificationCommands("/tmp/Luke.dmg"), [
    { command: "codesign", arguments: ["--verify", "--strict", "/tmp/Luke.dmg"] },
    {
      command: "spctl",
      arguments: [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        "-vv",
        "/tmp/Luke.dmg",
      ],
    },
    { command: "xcrun", arguments: ["stapler", "validate", "/tmp/Luke.dmg"] },
    { command: "hdiutil", arguments: ["verify", "/tmp/Luke.dmg"] },
  ]);
});
