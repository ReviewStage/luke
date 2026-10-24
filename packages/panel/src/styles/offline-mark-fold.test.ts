// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * The offline pill draws its word beside the account's name only where both fit, and its glyph alone below that, so "Not signed in" ends whole at the default sidebar rather than cut short beside the word. jsdom lays nothing out, so the foot's width is the one the stylesheet is resolved for. Synthetic throughout.
 */

/** What the foot's container measures at the default sidebar's 264px, less its inset. */
const DEFAULT_FOOT = 240;

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

/** Whether the pill's word is drawn in a foot `width` pixels wide. */
function wordShownAt(width: number): boolean {
  layContainersAt({ "sidebar-foot": width }, { only: ["@luke/ui/tokens.css", "./desktop.css"] });
  document.body.innerHTML =
    '<div class="sidebar-account-row"><span class="offline-mark"><span class="offline-mark-word">Offline</span></span></div>';
  return shown(document.querySelector(".offline-mark-word") ?? assert.fail("the word stands"));
}

test("at the default sidebar's width the pill is its glyph alone, leaving the name its room", () => {
  assert.equal(wordShownAt(DEFAULT_FOOT), false);
});

test("a sidebar drawn wider than the default has room for the pill's word", () => {
  assert.equal(wordShownAt(320), true);
});
