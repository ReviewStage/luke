import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import test from "node:test";
import {
  AD_HOC_APP_NAME,
  APP_CHANNEL,
  buildCarriesDeveloperIdSigning,
  DEVELOPMENT_APP_NAME,
  HOOK_ARTIFACT_QUALIFIER_BY_CHANNEL,
  RELEASE_APP_NAME,
  resolveAppChannel,
  resolveAppName,
} from "./app-identity";

test("only a packaged Developer ID build answers to the product name", () => {
  assert.equal(resolveAppName({ packaged: true, developerIdSigned: true }), RELEASE_APP_NAME);
});

test("an ad-hoc package is isolated from unpackaged development credentials", () => {
  assert.equal(resolveAppName({ packaged: true, developerIdSigned: false }), AD_HOC_APP_NAME);
});

test("an unpackaged run answers to the development name whatever it was built for", () => {
  // `electron .` runs under the Electron dev binary's signature even when the
  // bundle itself was built alongside Developer ID packaging.
  assert.equal(resolveAppName({ packaged: false, developerIdSigned: true }), DEVELOPMENT_APP_NAME);
  assert.equal(resolveAppName({ packaged: false, developerIdSigned: false }), DEVELOPMENT_APP_NAME);
});

test("channel resolution mirrors the name resolution", () => {
  assert.equal(resolveAppChannel({ packaged: true, developerIdSigned: true }), APP_CHANNEL.RELEASE);
  assert.equal(resolveAppChannel({ packaged: true, developerIdSigned: false }), APP_CHANNEL.AD_HOC);
  assert.equal(
    resolveAppChannel({ packaged: false, developerIdSigned: true }),
    APP_CHANNEL.DEVELOPMENT,
  );
  assert.equal(
    resolveAppChannel({ packaged: false, developerIdSigned: false }),
    APP_CHANNEL.DEVELOPMENT,
  );
});

test("only the development channels qualify their hook artifacts", () => {
  // The release channel keeps the bare names the installed base already
  // carries, so entries written before channels existed stay the release's to
  // reconcile; the qualified names must never contain each other or the bare
  // name's extension boundary, or one channel would reconcile another's
  // entries away.
  assert.equal(HOOK_ARTIFACT_QUALIFIER_BY_CHANNEL[APP_CHANNEL.RELEASE], undefined);
  assert.equal(HOOK_ARTIFACT_QUALIFIER_BY_CHANNEL[APP_CHANNEL.DEVELOPMENT], "dev");
  assert.equal(HOOK_ARTIFACT_QUALIFIER_BY_CHANNEL[APP_CHANNEL.AD_HOC], "test");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("sources run directly read as a development build", () => {
  // Under tsx the baked define does not exist, and that absence must land on
  // the development identity rather than throwing or claiming the release's.
  assert.equal(buildCarriesDeveloperIdSigning(), false);
});

test("the names hold to the manifest and to the shell derivation", async () => {
  const manifest: unknown = JSON.parse(
    await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const { productName } = manifest as { productName?: string };
  // The release name is Electron's own default — the manifest's product name —
  // so a release build setting it changes nothing about where released state
  // already lives.
  assert.equal(RELEASE_APP_NAME, productName);
  // scripts/lib/workspace.sh derives the development instance's lock directory
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // as "<product name> Dev"; this is the pin that keeps the two together.
  assert.equal(DEVELOPMENT_APP_NAME, `${productName} Dev`);
  assert.equal(AD_HOC_APP_NAME, `${productName} Test`);
  const shellNames = execFileSync(
    "bash",
    ["-c", "source scripts/lib/workspace.sh; sidecar_development_channel_app_names"],
    { cwd: new URL("../../../..", import.meta.url), encoding: "utf8" },
  );
  // The names the launcher may stop are exactly the development channels': the
  // release name must never appear here, because the released instance is the
  // always-on production channel a development launch runs beside.
  assert.deepEqual(shellNames.trim().split("\n"), [DEVELOPMENT_APP_NAME, AD_HOC_APP_NAME]);
});

test("the desktop composition applies identity before taking its lock", async () => {
  const composition = await fs.readFile(new URL("./desktop-app.ts", import.meta.url), "utf8");
  const named = composition.indexOf("app.setName(appName)");
  assert.notEqual(named, -1, "the composition must set the resolved app name");
  // `setName` alone leaves the state directory on the manifest name, so both
  // paths that hold state must be pointed at the chosen name too.
  assert.ok(
    composition.includes('app.setPath("userData"'),
    "the composition must repoint userData",
  );
  assert.ok(
    composition.includes('app.setPath("sessionData"'),
    "the composition must repoint sessionData",
  );
  // The single-instance lock is written into the state directory, so taking it
  // before the identity is applied would guard the wrong instance.
  const locked = composition.indexOf("app.requestSingleInstanceLock()");
  assert.notEqual(locked, -1, "the composition must take the single-instance lock");
  assert.ok(named < locked, "the identity must be applied before the lock is taken");
});
