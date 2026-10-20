import assert from "node:assert/strict";
import { test } from "vitest";
import {
  eventWithoutAccessTokens,
  transactionWithoutAccessTokens,
  withoutAccessTokens,
} from "./sentry-breadcrumbs.js";

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

test("an error whose message carries a failed join's validate URL is dropped", () => {
  const event = {
    type: undefined,
    exception: {
      values: [
        {
          type: "ConnectionError",
          value: `could not establish signal connection: https://x.livekit.cloud/rtc/v1/validate?access_token=${TOKEN}`,
        },
      ],
    },
  };
  assert.equal(eventWithoutAccessTokens(event), null);
});

test("an event whose request or message names the token is dropped", () => {
  const url = `https://x.livekit.cloud/rtc/v1/validate?access_token=${TOKEN}`;
  assert.equal(eventWithoutAccessTokens({ type: undefined, request: { url } }), null);
  assert.equal(eventWithoutAccessTokens({ type: undefined, message: `join failed: ${url}` }), null);
});

test("an event carrying no token is sent as it was", () => {
  const event = {
    type: undefined,
    exception: { values: [{ type: "TypeError", value: "x is undefined" }] },
    request: { url: "app://renderer/call.html" },
  };
  assert.equal(eventWithoutAccessTokens(event), event);
});

test("a trace whose request span carries a failed join's validate URL is dropped", () => {
  const url = `https://x.livekit.cloud/rtc/v1/validate?access_token=${TOKEN}`;
  const trace = {
    type: "transaction" as const,
    transaction: "/panel.html",
    spans: [
      {
        span_id: "a1",
        trace_id: "b2",
        start_timestamp: 1,
        op: "http.client",
        description: `GET ${url}`,
        data: { url },
      },
    ],
  };
  assert.equal(transactionWithoutAccessTokens(trace), null);
});

test("a trace carrying no token is sent as it was", () => {
  const trace = { type: "transaction" as const, transaction: "/panel.html", spans: [] };
  assert.equal(transactionWithoutAccessTokens(trace), trace);
});
