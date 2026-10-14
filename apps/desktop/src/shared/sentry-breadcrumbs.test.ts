import assert from "node:assert/strict";
import { test } from "vitest";
import { withoutAccessTokens } from "./sentry-breadcrumbs";

/**
 * sentry-breadcrumbs.test.ts -- a renderer's breadcrumbs as Sentry would carry them: LiveKit's token never among them.
 */

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.participant-token-never-reported";

test("a failed join's validate fetch, its token in the query, is dropped", () => {
  const breadcrumb = {
    category: "fetch",
    type: "http",
    level: "error" as const,
    data: {
      method: "GET",
      url: `https://luke-avatar.livekit.cloud/rtc/v1/validate?access_token=${TOKEN}&auto_subscribe=1`,
    },
  };
  assert.equal(withoutAccessTokens(breadcrumb), null);
});

test("the same request over XHR is dropped too", () => {
  const breadcrumb = {
    category: "xhr",
    type: "http",
    data: {
      method: "GET",
      url: `https://x.livekit.cloud/rtc/validate?access_token=${TOKEN}`,
      status_code: 401,
    },
  };
  assert.equal(withoutAccessTokens(breadcrumb), null);
});

test("a console line that prints the URL is dropped", () => {
  const breadcrumb = {
    category: "console",
    level: "warning" as const,
    message: `could not connect to wss://x.livekit.cloud/rtc?access_token=${TOKEN}`,
  };
  assert.equal(withoutAccessTokens(breadcrumb), null);
});

test("a breadcrumb carrying no token is kept as it was", () => {
  const breadcrumb = {
    category: "fetch",
    type: "http",
    data: { method: "GET", url: "https://luke.example.test/status", status_code: 200 },
  };
  assert.equal(withoutAccessTokens(breadcrumb), breadcrumb);
});
