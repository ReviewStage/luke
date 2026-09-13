import assert from "node:assert/strict";
import { test } from "vitest";
import { sanitizeAnalyticsUrls } from "../src/analytics";

const SIGN_IN_URL =
  "https://tryluke.dev/sign-in.html?state=github.abc&code_challenge=xyz&redirect_uri=luke%3A%2F%2Fauth&expires_at=1700000000&signature=deadbeef";
const CONSENT_URL = "https://tryluke.dev/consent.html?oauth_query=signed.payload&state=github.abc";

test("a sign-in address keeps its path and drops the authorization query", () => {
  const clean = sanitizeAnalyticsUrls({ $current_url: SIGN_IN_URL });
  assert.equal(clean.$current_url, "https://tryluke.dev/sign-in.html");
  assert.doesNotMatch(clean.$current_url, /state|code_challenge|signature|redirect_uri|expires_at/);
});

test("the consent address drops its authorization query too", () => {
  const clean = sanitizeAnalyticsUrls({ $current_url: CONSENT_URL });
  assert.equal(clean.$current_url, "https://tryluke.dev/consent.html");
});

test("a referrer that is a sign-in address is cut to its path", () => {
  const clean = sanitizeAnalyticsUrls({ $referrer: SIGN_IN_URL });
  assert.equal(clean.$referrer, "https://tryluke.dev/sign-in.html");
});

test("the top-level $set_once first-seen pair the person keeps is cut, and a Date is left whole", () => {
  const timestamp = new Date(0);
  const capture = {
    uuid: "abc",
    event: "$pageview",
    properties: { $current_url: SIGN_IN_URL, $referrer: CONSENT_URL },
    $set_once: { $initial_current_url: SIGN_IN_URL, $initial_referrer: CONSENT_URL },
    timestamp,
  };
  const clean = sanitizeAnalyticsUrls(capture);
  assert.equal(clean.properties.$current_url, "https://tryluke.dev/sign-in.html");
  assert.equal(clean.$set_once.$initial_current_url, "https://tryluke.dev/sign-in.html");
  assert.equal(clean.$set_once.$initial_referrer, "https://tryluke.dev/consent.html");
  assert.equal(clean.timestamp, timestamp);
  assert.ok(clean.timestamp instanceof Date);
});

test("a marketing address keeps the campaign query that brought someone", () => {
  const landing = "https://tryluke.dev/?utm_source=news&utm_campaign=launch";
  const clean = sanitizeAnalyticsUrls({ $current_url: landing });
  assert.equal(clean.$current_url, landing);
});

test("values that are not addresses pass through untouched", () => {
  const properties = { $referrer: "$direct", $screen_height: 900, missing: null };
  assert.deepEqual(sanitizeAnalyticsUrls(properties), properties);
});

test("an array value is left whole, so a recording's snapshot is never walked", () => {
  const snapshot = { $snapshot_data: [{ href: SIGN_IN_URL }] };
  assert.deepEqual(sanitizeAnalyticsUrls(snapshot), snapshot);
});
