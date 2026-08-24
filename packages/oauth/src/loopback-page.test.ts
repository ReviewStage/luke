import assert from "node:assert/strict";
import test from "node:test";
import { accountLoopbackPage, LOOPBACK_PAGE_TONE, loopbackContinuePage } from "./loopback-page.js";

test("a success page says it will close itself and asks the browser to", () => {
  const page = accountLoopbackPage({
    tone: LOOPBACK_PAGE_TONE.SETTLED,
    badge: "Connected",
    title: "Connected",
    body: "You can close this tab.",
    closesItself: true,
  });
  assert.match(page, /<p class="close-note" id="close-note"><\/p>/);
  assert.match(page, /This tab will close itself in/);
  assert.match(page, /window\.close\(\)/);
});

test("a page not marked to close itself carries no script and no note", () => {
  const page = accountLoopbackPage({
    tone: LOOPBACK_PAGE_TONE.ATTENTION,
    badge: "Not completed",
    title: "Sign-in was not completed",
    body: "Return and try again.",
  });
  assert.doesNotMatch(page, /<script/);
  assert.doesNotMatch(page, /id="close-note"/);
});

test("the continue page opens the consent in a tab a script may close", () => {
  const page = loopbackContinuePage({
    title: "Connect Google Calendar",
    body: "Google asks for consent in a tab of its own.",
    action: "Continue to Google",
    authorizationUrl: "https://accounts.example/authorize?client_id=abc&state=s-1",
  });
  // `target="_blank"` makes the consent tab web-created — the one kind whose
  // landing page may close it — while its implicit `noopener` keeps the
  // provider from receiving a handle to the continue page.
  assert.match(
    page,
    /<a class="continue" id="continue" href="https:\/\/accounts\.example\/authorize\?client_id=abc&amp;state=s-1" target="_blank">Continue to Google<\/a>/,
  );
  assert.doesNotMatch(page, /rel="opener"/);
  // This page closes itself once the click has done its work.
  assert.match(page, /window\.close\(\)/);
});

test("the continue page promises a close only where scripting can keep it", () => {
  const page = loopbackContinuePage({
    title: "Connect Linear",
    body: "Linear asks for consent in a tab of its own.",
    action: "Continue to Linear",
    authorizationUrl: "https://linear.example/authorize",
  });
  // The note is empty in the document; only the script gives it words.
  assert.match(page, /<p class="close-note" id="close-note"><\/p>/);
  assert.doesNotMatch(page, /close themselves[^"]*<\/p>/);
});
