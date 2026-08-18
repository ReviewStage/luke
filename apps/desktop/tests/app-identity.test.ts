import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  buildCarriesDeveloperIdSigning,
  DEVELOPMENT_APP_NAME,
  RELEASE_APP_NAME,
  resolveAppName,
} from "../src/app-identity";

test("only a packaged Developer ID build answers to the product name", () => {
  assert.equal(resolveAppName({ packaged: true, developerIdSigned: true }), RELEASE_APP_NAME);
});

test("a packaged build without the release identity answers to the development name", () => {
  // An ad-hoc signature changes with every build, so sharing the release's
  // Keychain entry would poison it for the released app.
  assert.equal(resolveAppName({ packaged: true, developerIdSigned: false }), DEVELOPMENT_APP_NAME);
});

test("an unpackaged run answers to the development name whatever it was built for", () => {
  // `electron .` runs under the Electron dev binary's signature even when the
  // bundle itself was built alongside Developer ID packaging.
  assert.equal(resolveAppName({ packaged: false, developerIdSigned: true }), DEVELOPMENT_APP_NAME);
  assert.equal(resolveAppName({ packaged: false, developerIdSigned: false }), DEVELOPMENT_APP_NAME);
});

test("sources run directly read as a development build", () => {
  // Under tsx the baked define does not exist, and that absence must land on
  // the development identity rather than throwing or claiming the release's.
  assert.equal(buildCarriesDeveloperIdSigning(), false);
});

test("the names hold to the manifest and to the shell derivation", async () => {
  const manifest: unknown = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const { productName } = manifest as { productName?: string };
  // The release name is Electron's own default — the manifest's product name —
  // so a release build setting it changes nothing about where released state
  // already lives.
  assert.equal(RELEASE_APP_NAME, productName);
  // scripts/lib/workspace.sh derives the development instance's lock directory
  // as "<product name> Dev"; this is the pin that keeps the two together.
  assert.equal(DEVELOPMENT_APP_NAME, `${productName} Dev`);
});

test("main.ts applies the identity before the lock that lives under it", async () => {
  const main = await fs.readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const named = main.indexOf("app.setName(appName)");
  assert.notEqual(named, -1, "main.ts must set the resolved app name");
  // `setName` alone leaves the state directory on the manifest name, so both
  // paths that hold state must be pointed at the chosen name too.
  assert.ok(main.includes('app.setPath("userData"'), "main.ts must repoint userData");
  assert.ok(main.includes('app.setPath("sessionData"'), "main.ts must repoint sessionData");
  // The single-instance lock is written into the state directory, so taking it
  // before the identity is applied would guard the wrong instance.
  const locked = main.indexOf("app.requestSingleInstanceLock()");
  assert.notEqual(locked, -1, "main.ts must take the single-instance lock");
  assert.ok(named < locked, "the identity must be applied before the lock is taken");
});
