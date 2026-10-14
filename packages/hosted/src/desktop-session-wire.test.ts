import assert from "node:assert/strict";
import { test } from "vitest";
import {
  DESKTOP_SESSION_CLIENT_ID,
  desktopSessionPageQuery,
  desktopSessionPageUrl,
  desktopSessionReturnUrl,
} from "./desktop-session-wire.js";

const REQUEST = {
  state: "state-1",
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  returnTo: "http://127.0.0.1:54698/session",
};

function pageSearch(returnTo: string): string {
  return new URL(desktopSessionPageUrl("https://tryluke.dev", { ...REQUEST, returnTo })).search;
}

test("the hand-off page reads back the transfer the Mac asked for and the loopback it listens on", () => {
  const page = new URL(desktopSessionPageUrl("https://tryluke.dev", REQUEST));
  const query = desktopSessionPageQuery(page.search);

  assert.equal(page.origin + page.pathname, "https://tryluke.dev/desktop-session.html");
  assert.deepEqual(query?.transfer, {
    client_id: DESKTOP_SESSION_CLIENT_ID,
    state: "state-1",
    code_challenge: REQUEST.codeChallenge,
  });
  assert.equal(query?.returnTo.href, REQUEST.returnTo);
});

test("a return address anywhere but a loopback port is no return address", () => {
  for (const returnTo of [
    "https://evil.example/session",
    "http://evil.example:54698/session",
    "http://localhost:54698/session",
    "https://127.0.0.1:54698/session",
    "http://127.0.0.1/session",
    "http://user:pass@127.0.0.1:54698/session",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(desktopSessionPageQuery(pageSearch(returnTo)), undefined, returnTo);
  }
});

test("a hand-off without its state or challenge is no hand-off", () => {
  assert.equal(
    desktopSessionPageQuery("?code_challenge=c&return_to=http://127.0.0.1:1/session"),
    undefined,
  );
  assert.equal(desktopSessionPageQuery("?state=s&return_to=http://127.0.0.1:1/session"), undefined);
});

test("the code returns to the loopback beside the Mac's own state, on the path it named", () => {
  const back = new URL(desktopSessionReturnUrl(new URL(REQUEST.returnTo), "code+1&", "state-1"));

  assert.equal(back.origin + back.pathname, REQUEST.returnTo);
  assert.equal(back.searchParams.get("code"), "code+1&");
  assert.equal(back.searchParams.get("state"), "state-1");
});
