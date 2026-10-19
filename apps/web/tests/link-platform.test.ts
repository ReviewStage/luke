// @vitest-environment jsdom
import assert from "node:assert/strict";
import { LINK_PLATFORM } from "@luke/features/link-open";
import { afterEach, test, vi } from "vitest";
import { browserLinkPlatform } from "../src/app/mac-app-handoff";

/**
 * Which browsers the hand-off counts as on a Mac, by what each says of
 * itself: a Mac's Safari, Chrome, or Firefox is one; an iPad asking for the
 * desktop site says "Macintosh" too but has a touch screen, and stays on
 * the web, as Windows, Linux, and a phone do.
 */

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** The browser saying the user agent and touch points given. */
function browserSaying(userAgent: string, maxTouchPoints: number): void {
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a Mac's browser is on a Mac", () => {
  for (const userAgent of [MAC_SAFARI, MAC_CHROME]) {
    browserSaying(userAgent, 0);
    assert.equal(browserLinkPlatform(), LINK_PLATFORM.MAC, userAgent);
  }
});

test("an iPad asking for the desktop site is not on a Mac, though it says Macintosh", () => {
  browserSaying(MAC_SAFARI, 5);
  assert.equal(browserLinkPlatform(), LINK_PLATFORM.OTHER);
});

test("Windows and a phone are not on a Mac", () => {
  browserSaying(WINDOWS_CHROME, 0);
  assert.equal(browserLinkPlatform(), LINK_PLATFORM.OTHER);
  browserSaying(IPHONE_SAFARI, 5);
  assert.equal(browserLinkPlatform(), LINK_PLATFORM.OTHER);
});
