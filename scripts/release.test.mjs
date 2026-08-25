import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createElectronBuilderConfig,
  ELECTRON_BUILDER_GITHUB_PUBLISH_CONFIG,
  ELECTRON_BUILDER_UPDATE_PUBLISH_CONFIG,
} from "../apps/desktop/scripts/electron-builder-config.mjs";
import { PACKAGED_ARCHITECTURE } from "../apps/desktop/scripts/package-layout.mjs";
import {
  awaitNotarizationDecision,
  builderReleaseArtifactDirectory,
  NOTARY_CREDENTIAL_SOURCE,
  NOTARY_POLL_INTERVAL_MS,
  NOTARY_POLL_TIMEOUT_MS,
  NOTARY_SUBMISSION_STATUS,
  notaryInfoArguments,
  notaryLogArguments,
  notarySubmitArguments,
  RELEASE_LATEST_DMG_FILE_NAME,
  RELEASE_UPDATE_FEED_FILE_NAME,
  RELEASE_VOLUME_NAME,
  releaseDmgFileName,
  releaseZipFileName,
  resetBuilderReleaseArtifactDirectory,
  resolveNotaryCredentials,
  stapleArguments,
} from "../apps/desktop/scripts/release-config.mjs";
import { DMG_WINDOW } from "../design/dmg-window.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manual releases install the locked dependencies before checking the workspace", () => {
  const releaseScript = fs.readFileSync(path.join(repoRoot, "scripts", "release-macos.sh"), "utf8");
  const bootstrapCall = releaseScript.indexOf('"$SCRIPT_DIRECTORY/bootstrap.sh"');
  const checkCall = releaseScript.indexOf('"$SCRIPT_DIRECTORY/check.sh"');
  const desktopReleaseCall = releaseScript.indexOf("pnpm --filter @luke/desktop release");

  assert.notEqual(bootstrapCall, -1);
  assert.ok(bootstrapCall < checkCall);
  assert.ok(checkCall < desktopReleaseCall);
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

test("release zip names include the desktop version and packaged architecture", () => {
  assert.equal(releaseZipFileName("0.1.0"), "Luke-0.1.0-macos-arm64.zip");
});

test("the latest-DMG asset name carries no version, so its download URL never moves", () => {
  assert.equal(RELEASE_LATEST_DMG_FILE_NAME, "Luke.dmg");
  assert.ok(!RELEASE_LATEST_DMG_FILE_NAME.includes(PACKAGED_ARCHITECTURE));
});

test("electron-builder owns the branded DMG layout", () => {
  const config = createElectronBuilderConfig();

  assert.equal(RELEASE_VOLUME_NAME, "Luke Installer");
  assert.equal(config.dmg.title, RELEASE_VOLUME_NAME);
  assert.equal(config.dmg.background.endsWith("background.tiff"), true);
  assert.equal(config.dmg.iconSize, DMG_WINDOW.ICON_SIZE);
  assert.equal(config.dmg.iconTextSize, DMG_WINDOW.TEXT_SIZE);
  assert.equal(config.dmg.sign, true);
  assert.deepEqual(config.dmg.window, {
    x: DMG_WINDOW.BOUNDS.LEFT,
    y: DMG_WINDOW.BOUNDS.BOTTOM,
    width: DMG_WINDOW.BOUNDS.WIDTH,
    height: DMG_WINDOW.BOUNDS.HEIGHT,
  });
  assert.deepEqual(config.dmg.contents, [
    {
      x: DMG_WINDOW.POSITIONS.APP.X,
      y: DMG_WINDOW.POSITIONS.APP.Y,
      type: "file",
      path: path.join(
        builderReleaseArtifactDirectory(repoRoot),
        `mac-${PACKAGED_ARCHITECTURE}`,
        "Luke.app",
      ),
      name: "Luke.app",
    },
    {
      x: DMG_WINDOW.POSITIONS.APPLICATIONS.X,
      y: DMG_WINDOW.POSITIONS.APPLICATIONS.Y,
      type: "link",
      path: "/Applications",
    },
  ]);
});

test("the update manifest asset name stays fixed while electron-builder writes its contents", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );
  const archiveMacro = "$" + "{archive}";

  assert.equal(RELEASE_UPDATE_FEED_FILE_NAME, "latest-mac.yml");
  assert.ok(workflow.includes(`if (!manifest.includes(\`url: ${archiveMacro}\`))`));
  assert.ok(workflow.includes(`if (!manifest.includes(\`path: ${archiveMacro}\`))`));
  assert.ok(workflow.includes("if (/https?:\\/\\//.test(manifest))"));
  assert.ok(workflow.includes("if (!/sha512: \\S+/.test(manifest))"));
  assert.ok(workflow.includes("if (!/size: \\d+/.test(manifest))"));
});

test("hosted releases require and package every desktop integration credential", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );
  const credentialCheck = workflow.slice(
    workflow.indexOf("- name: Check release secrets"),
    workflow.indexOf("- name: Resolve release version"),
  );
  const releaseBuild = workflow.slice(
    workflow.indexOf("- name: Build signed, notarized release artifacts"),
    workflow.indexOf("- name: Verify signed application"),
  );

  for (const credential of ["GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET", "POSTHOG_PROJECT_API_KEY"]) {
    const secretMapping = new RegExp(`${credential}: \\\${{ secrets\\.${credential} }}`);
    assert.match(credentialCheck, secretMapping);
    assert.match(releaseBuild, secretMapping);
    const trimmedLines = credentialCheck.split("\n").map((line) => line.trim());
    assert.ok(
      trimmedLines.includes(`${credential}; do`) || trimmedLines.includes(`${credential} \\`),
    );
  }
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
    "--no-s3-acceleration",
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
    "--no-s3-acceleration",
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
});

test("notarization uses the stable upload path without asking notarytool to wait", () => {
  const credentials = { source: NOTARY_CREDENTIAL_SOURCE.KEYCHAIN_PROFILE };
  const builderConfig = createElectronBuilderConfig();
  const hooks = fs.readFileSync(
    path.join(repoRoot, "apps", "desktop", "scripts", "electron-builder-hooks.mjs"),
    "utf8",
  );

  assert.ok(!notarySubmitArguments("/tmp/Luke.dmg", credentials).includes("--wait"));
  assert.ok(!notarySubmitArguments("/tmp/Luke.dmg", credentials).includes("--timeout"));
  assert.ok(notarySubmitArguments("/tmp/Luke.dmg", credentials).includes("--no-s3-acceleration"));
  assert.equal(builderConfig.mac.notarize, false);
  assert.ok(hooks.includes("notaryInfoArguments(submission.id, credentials)"));
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
  assert.equal(
    builderReleaseArtifactDirectory("/repo"),
    path.join("/repo", "artifacts", "release-builder"),
  );
});

test("every builder run starts without artifacts or signatures from an earlier run", () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "luke-builder-reset-"));
  try {
    const outputDirectory = builderReleaseArtifactDirectory(testRoot);
    const staleFramework = path.join(outputDirectory, "mac-arm64", "Luke.app", "stale-signature");
    fs.mkdirSync(path.dirname(staleFramework), { recursive: true });
    fs.writeFileSync(staleFramework, "old build");

    resetBuilderReleaseArtifactDirectory(testRoot);

    assert.equal(fs.existsSync(outputDirectory), false);
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test("electron-builder release output is stable and publishable by GitHub", () => {
  const config = createElectronBuilderConfig();

  assert.equal(config.directories.output, builderReleaseArtifactDirectory(repoRoot));
  assert.deepEqual(config.publish, [
    ELECTRON_BUILDER_UPDATE_PUBLISH_CONFIG,
    ELECTRON_BUILDER_GITHUB_PUBLISH_CONFIG,
  ]);
  assert.equal(config.generateUpdatesFilesForAllChannels, true);
  assert.equal(config.afterSign.name, "notarizeElectronBuilderApp");
  assert.equal(config.afterAllArtifactBuild.name, "finalizeElectronBuilderArtifacts");
});

test("manual publishing uploads only electron-builder's release asset set", () => {
  const publishScript = fs.readFileSync(
    path.join(repoRoot, "scripts", "release", "publish-github.sh"),
    "utf8",
  );

  assert.ok(publishScript.includes("builderReleaseArtifactDirectory"));
  assert.ok(publishScript.includes("$LATEST_DMG_PATH"));
  assert.ok(publishScript.includes("$UPDATE_FEED_PATH"));
  assert.ok(publishScript.includes("$DMG_PATH.sha256"));
  assert.ok(publishScript.includes("$ZIP_PATH.sha256"));
  assert.equal(publishScript.includes(`--${"legacy"}-${"packager"}`), false);
  assert.equal(publishScript.includes(`write-${"update"}-feed`), false);
});

test("release verification covers signing, Gatekeeper, stapling, and disk image integrity", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.ok(workflow.includes('codesign --verify --deep --strict --verbose=2 "$APP_PATH"'));
  assert.ok(workflow.includes('grep -q "Authority=Developer ID Application"'));
  assert.ok(workflow.includes("spctl --assess --type execute -vv"));
  assert.ok(workflow.includes('xcrun stapler validate "$APP_PATH"'));
  assert.ok(workflow.includes('codesign --verify --strict "$DIST_DIR/$DMG_ASSET_NAME"'));
  assert.ok(workflow.includes("spctl --assess --type open --context context:primary-signature"));
  assert.ok(workflow.includes('xcrun stapler validate "$DIST_DIR/$DMG_ASSET_NAME"'));
  assert.ok(workflow.includes('hdiutil verify "$DIST_DIR/$DMG_ASSET_NAME"'));
  assert.ok(workflow.includes('shasum -a 256 -c "$CHECKSUM_NAME"'));
  assert.ok(workflow.includes('shasum -a 256 -c "$DMG_CHECKSUM_NAME"'));
  assert.ok(
    workflow.includes('cmp "$DIST_DIR/$DMG_ASSET_NAME" "$DIST_DIR/$LATEST_DMG_ASSET_NAME"'),
  );
});
