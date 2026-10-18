/**
 * sentry-tracing.test.ts -- which requests a window traces: every one but its own reports to main.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { sentryTracesRequest } from "./sentry-tracing.js";

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
