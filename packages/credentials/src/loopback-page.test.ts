import assert from "node:assert/strict";
import test from "node:test";
import {
  accountLoopbackPage,
  LOOPBACK_CONNECTION_SOURCE,
  LOOPBACK_PAGE_TONE,
} from "./loopback-page.js";

test("loopback pages render the dark card and inline connection graphic", () => {
  const page = accountLoopbackPage({
    tone: LOOPBACK_PAGE_TONE.SETTLED,
    badge: "Connected",
    title: "Connected to Google Calendar",
    body: "You can close this tab and return to Luke.",
    source: LOOPBACK_CONNECTION_SOURCE.GOOGLE_CALENDAR,
  });

  assert.match(page, /<meta name="color-scheme" content="dark">/);
  assert.match(page, /class="connection"/);
  assert.match(page, /provider-mark-google-calendar/);
  assert.match(page, /class="mark mark-connection"/);
  assert.doesNotMatch(page, /logo-box/);
  assert.match(page, /data:image\/svg\+xml;utf8,/);
});

test("loopback pages stay self-contained", () => {
  const page = accountLoopbackPage({
    tone: LOOPBACK_PAGE_TONE.ATTENTION,
    badge: "Not connected",
    title: "Sign-in did not complete",
    body: "You can close this tab and try again from Luke.",
    source: LOOPBACK_CONNECTION_SOURCE.LINEAR,
  });

  assert.doesNotMatch(page, /<script\b/i);
  assert.doesNotMatch(page, /\b(?:src|href)=["']https?:\/\//i);
  assert.match(page, /provider-mark-linear/);
});
