import assert from "node:assert/strict";
import test from "node:test";
import { accountLoopbackPage, LOOPBACK_PAGE_TONE } from "./loopback-page.js";

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
