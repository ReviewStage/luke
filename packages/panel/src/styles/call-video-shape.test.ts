// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * call-video-shape.test.ts -- Luke's video tile stays a 16:9 picture
 * whatever its stream's shape. The stock avatars stream a square picture,
 * and a box drawn at a ratio takes its content's height as its least
 * height unless told otherwise, so the tile in the Call tab and on the
 * call card grew square around the video. jsdom lays nothing out, so the
 * sheets are laid (`testing/container-width.ts`) and the tile is built in
 * the markup `call-video-tile.tsx` draws, on each surface it stands on.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** The tile with live video, inside the parent given, answering the tile and its frame. */
function liveTile(parent: HTMLElement) {
  const tile = parent.appendChild(document.createElement("section"));
  tile.className = "call-video-tile";
  tile.dataset.status = "live";
  const frame = tile.appendChild(document.createElement("video"));
  frame.className = "call-video-frame";
  return { tile, frame };
}

/** The Call tab's column and a call card in the sidebar, each holding a live tile. */
function surfaces() {
  laid = layContainersAt({});
  document.documentElement.dataset.lukeProfile = "desktop";
  const tab = document.body.appendChild(document.createElement("section"));
  tab.className = "task-call";
  const card = document.body.appendChild(document.createElement("section"));
  card.className = "call-card";
  card.dataset.surface = "sidebar";
  return { tab: liveTile(tab), card: liveTile(card) };
}

test("the tile is a 16:9 picture whose least height is not its square stream's", () => {
  for (const { tile } of Object.values(surfaces())) {
    const drawn = getComputedStyle(tile);
    assert.equal(drawn.aspectRatio, "16 / 9");
    assert.equal(drawn.minHeight, "0px");
  }
});

test("the square stream is cut to the tile, held above its middle where the avatar's face is", () => {
  for (const { frame } of Object.values(surfaces())) {
    const drawn = getComputedStyle(frame);
    assert.equal(drawn.objectFit, "cover");
    assert.equal(drawn.objectPosition, "50% 35%");
  }
});

test("the Call tab's tile follows the tab's width up to a widest of its own", () => {
  const { tab } = surfaces();
  const width = getComputedStyle(tab.tile).width;
  assert.match(width, /^min\(/u, "the tile follows the tab rather than standing at one width");
  assert.match(width, /\b560px\b/u);
});
