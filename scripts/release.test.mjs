import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ICONSET_SOURCES } from "../apps/desktop/scripts/package-config.mjs";
import { PACKAGED_ARCHITECTURE } from "../apps/desktop/scripts/package-layout.mjs";
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
  NOTARY_CREDENTIAL_SOURCE,
  NOTARY_POLL_INTERVAL_MS,
  NOTARY_POLL_TIMEOUT_MS,
  NOTARY_SUBMISSION_STATUS,
  notaryInfoArguments,
  notaryLogArguments,
  notarySubmitArguments,
  parseHdiutilAttachPlist,
  RELEASE_LATEST_DMG_FILE_NAME,
  RELEASE_UPDATE_FEED_FILE_NAME,
  RELEASE_VOLUME_NAME,
  releaseArtifactDirectory,
  releaseDmgFileName,
  releaseSignatureMatchesIdentity,
  releaseUpdateManifest,
  releaseZipFileName,
  resolveNotaryCredentials,
  resolveReleaseSigning,
  stapleArguments,
  tiffutilHiDpiArguments,
  volumeCustomIconArguments,
  withMountedDmg,
} from "../apps/desktop/scripts/release-config.mjs";
import { DMG_WINDOW } from "../design/dmg-window.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manual releases install the locked dependencies before checking the workspace", () => {
  const releaseScript = fs.readFileSync(path.join(repoRoot, "scripts", "release-macos.sh"), "utf8");
  const bootstrapCall = releaseScript.indexOf('"$SCRIPT_DIRECTORY/bootstrap.sh"');
  const checkCall = releaseScript.indexOf('"$SCRIPT_DIRECTORY/check.sh"');

  assert.notEqual(bootstrapCall, -1);
  assert.ok(bootstrapCall < checkCall);
});

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
      "Luke Installer",
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
    "-mountpoint",
    "/Volumes/Luke Installer",
    "-plist",
  ]);
  // The layout writer does not need Finder, so keep Finder from creating a competing .DS_Store.
  assert.equal(attachArguments.includes("-nobrowse"), true);
  assert.equal(DMG_MOUNT_POINT, "/Volumes/Luke Installer");
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

test("release DMG attach parsing decodes each XML entity once", () => {
  const plist = `<plist><dict><key>system-entities</key><array>
  <dict><key>dev-entry</key><string>/dev/disk&amp;lt;5</string><key>mount-point</key><string>/Volumes/Luke &amp; Test</string></dict>
</array></dict></plist>`;

  assert.deepEqual(parseHdiutilAttachPlist(plist), {
    mountPoint: "/Volumes/Luke & Test",
    device: "/dev/disk&lt;5",
  });
});

test("release DMG attach cleanup runs when plist parsing fails", async () => {
  const detachedMountPoints = [];
  let usedMountPoint = false;

  await assert.rejects(
    withMountedDmg({
      attach: () => "<plist><dict></dict></plist>",
      detach: (mountPoint) => detachedMountPoints.push(mountPoint),
      use: () => {
        usedMountPoint = true;
      },
    }),
    /hdiutil did not report a mounted volume/,
  );

  assert.deepEqual(detachedMountPoints, [DMG_MOUNT_POINT]);
  assert.equal(usedMountPoint, false);
});

test("release DMG attach cleanup does not mask a plist parsing failure", async () => {
  const detachError = new Error("detach failed");
  let releaseError;

  try {
    await withMountedDmg({
      attach: () => "<plist><dict></dict></plist>",
      detach: () => {
        throw detachError;
      },
      use: () => assert.fail("an invalid attach response must not be used"),
    });
  } catch (error) {
    releaseError = error;
  }

  assert.match(releaseError.message, /hdiutil did not report a mounted volume/);
  assert.equal(releaseError.cause, detachError);
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

test("the DMG volume wears the installer icon, not the app's own", () => {
  // Finder reads a volume icon from this exact hidden name at the root, and
  // only once the root's custom-icon bit is set — so staging the file without
  // setting the bit, or the reverse, is a generic disk icon with no other sign.
  assert.equal(DMG_VOLUME_ICON_FILE_NAME, ".VolumeIcon.icns");
  assert.deepEqual(volumeCustomIconArguments("/Volumes/Luke Installer"), [
    "SetFile",
    "-a",
    "C",
    "/Volumes/Luke Installer",
  ]);

  // The volume is named and dressed as the installer, never as the app: a
  // volume called "Luke" wearing Luke's icon is indistinguishable from the
  // Luke.app beside it. Every iconset entry is a committed installer-icon
  // asset, cut from the dark set like the app's bundle icon.
  assert.equal(RELEASE_VOLUME_NAME, "Luke Installer");
  assert.deepEqual(Object.keys(INSTALLER_ICONSET_SOURCES), Object.keys(ICONSET_SOURCES));
  for (const sourceName of Object.values(INSTALLER_ICONSET_SOURCES)) {
    assert.match(sourceName, /^luke-installer-icon-dark-\d+\.png$/);
    assert.ok(fs.existsSync(path.join(repoRoot, "design", "brand", "icon", sourceName)));
  }

  const releaseScript = fs.readFileSync(
    path.join(repoRoot, "apps", "desktop", "scripts", "release.mjs"),
    "utf8",
  );
  assert.ok(releaseScript.includes("DMG_VOLUME_ICON_FILE_NAME"));
  assert.ok(releaseScript.includes("volumeCustomIconArguments(mountPoint)"));
  assert.ok(releaseScript.includes("INSTALLER_ICONSET_SOURCES"));
  assert.ok(releaseScript.includes("iconutilArguments"));
});

test("release zip names include the desktop version and packaged architecture", () => {
  assert.equal(releaseZipFileName("0.1.0"), "Luke-0.1.0-macos-arm64.zip");
});

test("the latest-DMG asset name carries no version, so its download URL never moves", () => {
  assert.equal(RELEASE_LATEST_DMG_FILE_NAME, "Luke.dmg");
  assert.ok(!RELEASE_LATEST_DMG_FILE_NAME.includes(PACKAGED_ARCHITECTURE));
});

test("the update manifest names the archive beside it, hashed whole", () => {
  // The manifest name carries no version — the app reads it through
  // releases/latest — and the archive URL inside is the bare file name, so
  // electron-updater resolves it against the same release the manifest came
  // from: yesterday's manifest can never hand it today's archive.
  assert.equal(RELEASE_UPDATE_FEED_FILE_NAME, "latest-mac.yml");
  const manifest = releaseUpdateManifest({
    version: "0.3.0",
    sha512: "c2hhLWZpdmUtdHdlbHZl",
    size: 12345,
    releaseDate: "2026-08-20T00:00:00.000Z",
  });
  const zipName = releaseZipFileName("0.3.0");
  assert.equal(
    manifest,
    [
      "version: 0.3.0",
      "files:",
      `  - url: ${zipName}`,
      "    sha512: c2hhLWZpdmUtdHdlbHZl",
      "    size: 12345",
      `path: ${zipName}`,
      "sha512: c2hhLWZpdmUtdHdlbHZl",
      "releaseDate: '2026-08-20T00:00:00.000Z'",
      "",
    ].join("\n"),
  );
});

test("notary credentials come from the keychain profile unless a key file is provided whole", () => {
  assert.deepEqual(resolveNotaryCredentials({}), {
    source: NOTARY_CREDENTIAL_SOURCE.KEYCHAIN_PROFILE,
  });
  assert.deepEqual(resolveNotaryCredentials({ APPLE_API_KEY_PATH: "  " }), {
    source: NOTARY_CREDENTIAL_SOURCE.KEYCHAIN_PROFILE,
  });
  assert.deepEqual(
    resolveNotaryCredentials({
      APPLE_API_KEY_PATH: "/tmp/AuthKey_KEYID.p8",
      APPLE_API_KEY_ID: "KEYID",
      APPLE_API_ISSUER_ID: "issuer-id",
    }),
    {
      source: NOTARY_CREDENTIAL_SOURCE.KEY_FILE,
      keyPath: "/tmp/AuthKey_KEYID.p8",
      keyId: "KEYID",
      issuerId: "issuer-id",
    },
  );
  assert.throws(() => resolveNotaryCredentials({ APPLE_API_KEY_ID: "KEYID" }), /together/);
  assert.throws(
    () =>
      resolveNotaryCredentials({
        APPLE_API_KEY_PATH: "/tmp/AuthKey_KEYID.p8",
        APPLE_API_ISSUER_ID: "issuer-id",
      }),
    /together/,
  );
});

test("release notarization commands carry key-file credentials", () => {
  const credentials = {
    source: NOTARY_CREDENTIAL_SOURCE.KEY_FILE,
    keyPath: "/tmp/AuthKey_KEYID.p8",
    keyId: "KEYID",
    issuerId: "issuer-id",
  };
  assert.deepEqual(notarySubmitArguments("/tmp/Luke.dmg", credentials), [
    "notarytool",
    "submit",
    "/tmp/Luke.dmg",
    "--key",
    "/tmp/AuthKey_KEYID.p8",
    "--key-id",
    "KEYID",
    "--issuer",
    "issuer-id",
    "--output-format",
    "json",
  ]);
  assert.deepEqual(notaryInfoArguments("submission-id", credentials), [
    "notarytool",
    "info",
    "submission-id",
    "--key",
    "/tmp/AuthKey_KEYID.p8",
    "--key-id",
    "KEYID",
    "--issuer",
    "issuer-id",
    "--output-format",
    "json",
  ]);
  assert.deepEqual(notaryLogArguments("submission-id", credentials), [
    "notarytool",
    "log",
    "submission-id",
    "--key",
    "/tmp/AuthKey_KEYID.p8",
    "--key-id",
    "KEYID",
    "--issuer",
    "issuer-id",
  ]);
});

test("release notarization commands use the local keychain profile", () => {
  const credentials = { source: NOTARY_CREDENTIAL_SOURCE.KEYCHAIN_PROFILE };
  assert.deepEqual(notarySubmitArguments("/tmp/Luke.dmg", credentials), [
    "notarytool",
    "submit",
    "/tmp/Luke.dmg",
    "--keychain-profile",
    "luke-notary",
    "--output-format",
    "json",
  ]);
  assert.deepEqual(notaryInfoArguments("submission-id", credentials), [
    "notarytool",
    "info",
    "submission-id",
    "--keychain-profile",
    "luke-notary",
    "--output-format",
    "json",
  ]);
  assert.deepEqual(notaryLogArguments("submission-id", credentials), [
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

test("neither notarization path asks notarytool to wait", () => {
  const credentials = { source: NOTARY_CREDENTIAL_SOURCE.KEYCHAIN_PROFILE };
  assert.ok(!notarySubmitArguments("/tmp/Luke.dmg", credentials).includes("--wait"));
  assert.ok(!notarySubmitArguments("/tmp/Luke.dmg", credentials).includes("--timeout"));

  const notarizeScript = fs.readFileSync(
    path.join(repoRoot, "scripts", "release", "notarize.sh"),
    "utf8",
  );
  // The rationale comment names the flag it removed, so only uncommented lines count.
  assert.ok(!/^[^#\n]*--wait\b/m.test(notarizeScript));
  assert.ok(!/^[^#\n]*--timeout\b/m.test(notarizeScript));
  assert.ok(notarizeScript.includes("notarytool info"));
});

test("the CI notarization path polls the submission id, not the submit exit status", () => {
  const notarizeScript = fs.readFileSync(
    path.join(repoRoot, "scripts", "release", "notarize.sh"),
    "utf8",
  );

  // notarytool can fail after the upload lands, so only a missing id may end
  // the run before the poll — the JS path continues from that stdout the same way.
  assert.ok(notarizeScript.includes('if [[ -z "$submission_id" ]]; then'));
  assert.ok(!/\$submit_exit"?\s+-ne\s+0\s*\|\|/.test(notarizeScript));
});

test("notarization polling settles on each status Apple reports", async () => {
  const acceptedAfter = async (statuses) => {
    const waits = [];
    const remaining = [...statuses];
    const settled = await awaitNotarizationDecision({
      readStatus: () => remaining.shift(),
      wait: (milliseconds) => waits.push(milliseconds),
    });
    return { settled, waits };
  };

  assert.deepEqual(await acceptedAfter([NOTARY_SUBMISSION_STATUS.ACCEPTED]), {
    settled: NOTARY_SUBMISSION_STATUS.ACCEPTED,
    waits: [],
  });
  assert.deepEqual(
    await acceptedAfter([
      NOTARY_SUBMISSION_STATUS.IN_PROGRESS,
      NOTARY_SUBMISSION_STATUS.IN_PROGRESS,
      NOTARY_SUBMISSION_STATUS.ACCEPTED,
    ]),
    {
      settled: NOTARY_SUBMISSION_STATUS.ACCEPTED,
      waits: [NOTARY_POLL_INTERVAL_MS, NOTARY_POLL_INTERVAL_MS],
    },
  );

  for (const status of [NOTARY_SUBMISSION_STATUS.INVALID, NOTARY_SUBMISSION_STATUS.REJECTED]) {
    await assert.rejects(
      awaitNotarizationDecision({
        readStatus: () => status,
        wait: () => assert.fail(`${status} is terminal and must not be polled again`),
      }),
      new RegExp(`Notarization failed with status: ${status}`),
    );
  }
});

test("an unrecognised notarization status is polled to the bound, never failed early", async () => {
  let polls = 0;

  await assert.rejects(
    awaitNotarizationDecision({
      readStatus: () => {
        polls += 1;
        return "Bewildered";
      },
      wait: () => {},
    }),
    /Apple did not finish notarization within 20 minutes; last status: Bewildered/,
  );

  assert.equal(polls, NOTARY_POLL_TIMEOUT_MS / NOTARY_POLL_INTERVAL_MS);
});

test("a notarization status Apple never returns is bounded like any other", async () => {
  await assert.rejects(
    awaitNotarizationDecision({
      readStatus: () => undefined,
      wait: () => {},
      intervalMs: 1,
      timeoutMs: 3,
    }),
    /last status: unknown/,
  );
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
