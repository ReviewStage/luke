import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PACKAGED_ARCHITECTURE } from "../apps/desktop/scripts/package-layout.mjs";
import {
  codesignDisplayArguments,
  DMG_MOUNT_POINT,
  DMG_STAGING_ENTRIES,
  dmgCodesignArguments,
  dmgStoreLayout,
  dmgVerificationCommands,
  hdiutilAttachArguments,
  hdiutilConvertArguments,
  hdiutilCreateArguments,
  hdiutilDetachArguments,
  notaryLogArguments,
  notarySubmitArguments,
  parseHdiutilAttachPlist,
  releaseArtifactDirectory,
  releaseDmgFileName,
  releaseSignatureMatchesIdentity,
  resolveReleaseSigning,
  stapleArguments,
  tiffutilHiDpiArguments,
} from "../apps/desktop/scripts/release-config.mjs";
import { DMG_WINDOW } from "../design/dmg-window.mjs";

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
      imagePath: "/tmp/Luke-rw.dmg",
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
      "UDRW",
      "-ov",
      "/tmp/Luke-rw.dmg",
    ],
  );
});

test("release DMG mount, conversion, and background arguments are deterministic", () => {
  const attachArguments = hdiutilAttachArguments("/tmp/Luke-rw.dmg");
  assert.deepEqual(attachArguments, [
    "attach",
    "/tmp/Luke-rw.dmg",
    "-readwrite",
    "-noverify",
    "-noautoopen",
    "-nobrowse",
    "-plist",
  ]);
  // The layout writer does not need Finder, so keep Finder from creating a competing .DS_Store.
  assert.equal(attachArguments.includes("-nobrowse"), true);
  assert.equal(DMG_MOUNT_POINT, "/Volumes/Luke");
  assert.deepEqual(hdiutilDetachArguments("/Volumes/Luke"), ["detach", "/Volumes/Luke"]);
  assert.deepEqual(hdiutilDetachArguments("/Volumes/Luke", { force: true }), [
    "detach",
    "/Volumes/Luke",
    "-force",
  ]);
  assert.deepEqual(
    hdiutilConvertArguments({
      imagePath: "/tmp/Luke-rw.dmg",
      dmgPath: "/repo/artifacts/Luke.dmg",
    }),
    [
      "convert",
      "/tmp/Luke-rw.dmg",
      "-format",
      "UDZO",
      "-imagekey",
      "zlib-level=9",
      "-ov",
      "-o",
      "/repo/artifacts/Luke.dmg",
    ],
  );
  assert.deepEqual(
    tiffutilHiDpiArguments({
      pngPath: "/repo/background.png",
      png2xPath: "/repo/background@2x.png",
      tiffPath: "/tmp/background.tiff",
    }),
    [
      "-cathidpicheck",
      "/repo/background.png",
      "/repo/background@2x.png",
      "-out",
      "/tmp/background.tiff",
    ],
  );
});

test("release DMG attach parsing selects the mounted system entity", () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>system-entities</key><array>
  <dict><key>dev-entry</key><string>/dev/disk4</string><key>content-hint</key><string>GUID_partition_scheme</string></dict>
  <dict><key>dev-entry</key><string>/dev/disk4s1</string><key>content-hint</key><string>Apple_APFS</string></dict>
  <dict><key>dev-entry</key><string>/dev/disk5s1</string><key>mount-point</key><string>/Volumes/Luke</string></dict>
</array></dict></plist>`;
  assert.deepEqual(parseHdiutilAttachPlist(plist), {
    mountPoint: "/Volumes/Luke",
    device: "/dev/disk5s1",
  });
  assert.throws(
    () => parseHdiutilAttachPlist("<plist><dict></dict></plist>"),
    /<plist><dict><\/dict><\/plist>/,
  );
});

test("release DMG store layout is branded and bounded", () => {
  assert.deepEqual(dmgStoreLayout("/Volumes/Luke"), {
    version: 1,
    backgroundPath: "/Volumes/Luke/.background/background.tiff",
    iconSize: 128,
    textSize: 12,
    window: { x: 200, y: 120, width: 660, height: 400 },
    icons: [
      { name: "Luke.app", X: 165, Y: 185 },
      { name: "Applications", X: 495, Y: 185 },
    ],
  });

  assert.ok(DMG_WINDOW.POSITIONS.APP.X < DMG_WINDOW.POSITIONS.APPLICATIONS.X);
  for (const position of Object.values(DMG_WINDOW.POSITIONS)) {
    assert.ok(position.X > 0 && position.X < DMG_WINDOW.BACKGROUND.PNG.WIDTH);
    assert.ok(position.Y > 0 && position.Y < DMG_WINDOW.BACKGROUND.PNG.HEIGHT);
  }
  assert.ok(
    DMG_WINDOW.POSITIONS.APPLICATIONS.X - DMG_WINDOW.POSITIONS.APP.X > DMG_WINDOW.ICON_SIZE,
  );
  assert.equal(DMG_WINDOW.BOUNDS.WIDTH, DMG_WINDOW.BACKGROUND.PNG.WIDTH);
  assert.equal(DMG_WINDOW.BOUNDS.HEIGHT, DMG_WINDOW.BACKGROUND.PNG.HEIGHT);
  assert.ok(DMG_WINDOW.BACKGROUND.DIRECTORY.startsWith("."));
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
  // release.mjs intentionally uses entries [0] and [3] when notarization is skipped.
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
