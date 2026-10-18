/**
 * sentry-options.test.ts -- which requests a window traces, and which environment each build reports under.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { SENTRY_ENVIRONMENT, sentryEnvironment, sentryTracesRequest } from "./sentry-options.js";

test("a renderer's report to main is never traced", () => {
  assert.equal(sentryTracesRequest("sentry-ipc://envelope/sentry_key"), false);
  assert.equal(sentryTracesRequest("sentry-ipc://scope/sentry_key"), false);
});

test("the scheme is matched whatever its case", () => {
  assert.equal(sentryTracesRequest("SENTRY-IPC://envelope/sentry_key"), false);
});

test("every other request is traced", () => {
  assert.equal(sentryTracesRequest("https://luke-avatar.livekit.cloud/rtc/v1/validate"), true);
  assert.equal(sentryTracesRequest("/fonts/excalidraw.woff2"), true);
});

test("a request that only names the scheme elsewhere is still traced", () => {
  assert.equal(sentryTracesRequest("https://example.com/?next=sentry-ipc://envelope"), true);
});

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
