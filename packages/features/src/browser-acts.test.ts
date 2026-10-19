import assert from "node:assert/strict";
import { test } from "vitest";
import { browserAddressOf, isBrowserAddress } from "./browser-acts.js";

/**
 * What a line typed into a Browser tab's bar opens, as a browser's address
 * bar reads it.
 */

test("an http or https address opens as written", () => {
  assert.equal(
    browserAddressOf("https://github.com/ReviewStage"),
    "https://github.com/ReviewStage",
  );
  assert.equal(browserAddressOf("  http://example.com/a?b=c  "), "http://example.com/a?b=c");
});

test("a dev server on the Mac or its network opens over plain http", () => {
  assert.equal(browserAddressOf("localhost"), "http://localhost/");
  assert.equal(browserAddressOf("localhost:3000"), "http://localhost:3000/");
  assert.equal(browserAddressOf("localhost:5173/settings"), "http://localhost:5173/settings");
  assert.equal(browserAddressOf("127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(browserAddressOf("app.localhost"), "http://app.localhost/");
  assert.equal(browserAddressOf("192.168.1.20:3000"), "http://192.168.1.20:3000/");
  assert.equal(browserAddressOf("[::1]:4000"), "http://[::1]:4000/");
});

test("any other host opens over https", () => {
  assert.equal(browserAddressOf("example.com"), "https://example.com/");
  assert.equal(browserAddressOf("example.com."), "https://example.com./");
  assert.equal(browserAddressOf("vercel.com/docs?x=1"), "https://vercel.com/docs?x=1");
});

test("words that are not an address are searched for", () => {
  assert.equal(
    browserAddressOf("electron web contents view"),
    "https://www.google.com/search?q=electron%20web%20contents%20view",
  );
});

test("an empty line, or an address of another scheme, opens nothing", () => {
  assert.equal(browserAddressOf("   "), undefined);
  assert.equal(browserAddressOf("file:///etc/passwd"), undefined);
  assert.equal(browserAddressOf("vscode://file/x"), undefined);
  assert.equal(
    browserAddressOf("javascript:alert(1)"),
    "https://www.google.com/search?q=javascript%3Aalert(1)",
  );
});

test("only an absolute http or https address the bar can hold is loaded", () => {
  assert.equal(isBrowserAddress("https://example.com/"), true);
  assert.equal(isBrowserAddress("file:///etc/passwd"), false);
  assert.equal(isBrowserAddress("javascript:alert(1)"), false);
  assert.equal(isBrowserAddress("example.com"), false);
  assert.equal(isBrowserAddress(`https://example.com/${"a".repeat(2_048)}`), false);
});
