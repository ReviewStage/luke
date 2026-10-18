/**
 * sentry-environment.test.ts -- which environment each build reports under.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { SENTRY_ENVIRONMENT, sentryEnvironment } from "./sentry-environment.js";

test("a Developer ID package reports as production", () => {
  assert.equal(
    sentryEnvironment({ packaged: true, developerIdSigned: true }),
    SENTRY_ENVIRONMENT.PRODUCTION,
  );
});

test("an ad-hoc package reports as a test build, never as production", () => {
  assert.equal(
    sentryEnvironment({ packaged: true, developerIdSigned: false }),
    SENTRY_ENVIRONMENT.TEST,
  );
});

test("an unpackaged run reports as development, even from a release bundle", () => {
  assert.equal(
    sentryEnvironment({ packaged: false, developerIdSigned: true }),
    SENTRY_ENVIRONMENT.DEVELOPMENT,
  );
});
