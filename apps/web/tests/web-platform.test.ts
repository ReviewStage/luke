// @vitest-environment jsdom
import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { LINK_PLATFORM } from "@luke/features/link-open";
import { afterEach, test, vi } from "vitest";
import { downloadText, webPlatform } from "../src/app/web-platform";

/**
 * What a browser tab answers the panel: a link opens in a tab of its own
 * only where its address is on the web, never as script or another app's
 * scheme; a download's file stays readable after its press returns, for a
 * browser that reads it only then, and is let go of as the next download
 * starts; and the way to the Mac app is offered only on a Mac.
 */

/** The platform as the tab builds it, counting nothing. */
const COUNTING = { recordSurfaceEvent: () => undefined };

/** Addresses a link must never open. */
const OFF_THE_WEB = [
  "javascript:alert(document.cookie)",
  "JavaScript:alert(document.cookie)",
  "data:text/html,<script>alert(document.cookie)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "tryluke://acme/plan/3f6c1b2a",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

test("a link opens in a tab of its own only where its address is an http or https one", () => {
  const opened: (string | URL | undefined)[] = [];
  vi.spyOn(window, "open").mockImplementation((url) => {
    opened.push(url);
    return null;
  });
  const platform = webPlatform(COUNTING);

  platform.openWeb("https://example.com/docs");
  platform.openGitHub("https://github.com/acme/app/pull/7");
  for (const address of OFF_THE_WEB) {
    platform.openWeb(address);
    platform.openGitHub(address);
  }

  assert.deepEqual(opened, ["https://example.com/docs", "https://github.com/acme/app/pull/7"]);
});

test("a download's file stays readable once its press returns, and is let go of as the next download starts", async () => {
  const pressed: { readonly name: string; readonly url: string }[] = [];
  // The browser downloads from the link pressed; jsdom downloads nothing, so each press is only kept.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    pressed.push({ name: this.download, url: this.href });
  });
  // Note that only whether a file can still be read is asked, because jsdom's Blob reaches Node's blob store without its words.
  const readable = (url: string) => resolveObjectURL(url) !== undefined;

  assert.equal(await downloadText({ name: "first.patch", text: "one" }), true);
  const first = pressed.at(-1);
  assert.ok(first !== undefined, "the first file is downloaded");
  assert.equal(first.name, "first.patch");
  assert.ok(readable(first.url), "the first file can be read once its press returns");

  await downloadText({ name: "second.patch", text: "two" });
  const second = pressed.at(-1);
  assert.ok(second !== undefined, "the second file is downloaded");
  assert.equal(second.name, "second.patch");
  assert.equal(readable(first.url), false, "the first file is let go of");
  assert.ok(readable(second.url), "the second file can be read");
});

test("the way to the Mac app is offered on a Mac, and on no other platform", () => {
  window.history.replaceState(null, "", "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b");

  assert.match(webPlatform(COUNTING, LINK_PLATFORM.MAC).macAppLink?.() ?? "", /^tryluke:/u);
  assert.equal(webPlatform(COUNTING, LINK_PLATFORM.OTHER).macAppLink, undefined);
  // jsdom's browser says it runs on Linux, where the Mac app cannot open.
  assert.equal(webPlatform(COUNTING).macAppLink, undefined);
});
