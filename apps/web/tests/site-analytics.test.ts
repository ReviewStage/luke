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
