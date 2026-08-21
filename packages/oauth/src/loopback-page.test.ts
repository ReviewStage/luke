import assert from "node:assert/strict";
import test from "node:test";
import { accountLoopbackPage, LOOPBACK_PAGE_TONE } from "./loopback-page.js";

test("a success page asks the browser to close its tab after a pause", () => {
  const page = accountLoopbackPage({
    tone: LOOPBACK_PAGE_TONE.SETTLED,
    badge: "Connected",
    title: "Connected",
    body: "You can close this tab.",
    closesItself: true,
  });
  assert.match(
    page,
    /<script>setTimeout\(function \(\) \{ window\.close\(\); \}, 5000\);<\/script>/,
  );
});

test("a page not marked to close itself carries no script at all", () => {
  const page = accountLoopbackPage({
    tone: LOOPBACK_PAGE_TONE.ATTENTION,
    badge: "Not completed",
    title: "Sign-in was not completed",
    body: "Return and try again.",
  });
  assert.doesNotMatch(page, /<script/);
});
