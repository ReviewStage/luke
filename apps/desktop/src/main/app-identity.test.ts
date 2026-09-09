import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import test from "node:test";
import {
  AD_HOC_APP_NAME,
  buildCarriesDeveloperIdSigning,
  DEVELOPMENT_APP_NAME,
  RELEASE_APP_NAME,
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
    ["-c", "source scripts/lib/workspace.sh; sidecar_app_names"],
    { cwd: new URL("../../../..", import.meta.url), encoding: "utf8" },
  );
  assert.deepEqual(shellNames.trim().split("\n"), [
    DEVELOPMENT_APP_NAME,
    AD_HOC_APP_NAME,
    RELEASE_APP_NAME,
  ]);
});
