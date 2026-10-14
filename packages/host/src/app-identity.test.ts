import assert from "node:assert/strict";
import { test } from "vitest";
import { AD_HOC_APP_NAME, resolveAppName } from "./app-identity.js";

test("an ad-hoc package is isolated from unpackaged development credentials", () => {
  assert.equal(resolveAppName({ packaged: true, developerIdSigned: false }), AD_HOC_APP_NAME);
});
