// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_VIDEO_FIT, type CallVideoFit } from "@luke/ui";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * call-video-shape.test.ts -- Luke's video tile draws the avatar's whole
 * picture in a shape that follows the room. The stock avatars stream a
 * square picture: on the call card the tile stays 16:9; in an agent's tab
 * it stands at the picture's own aspect, which the picture fills. The picture
 * is never cut, and where the tile is wider a blurred copy of it fills what
 * it leaves. A box drawn at a
 * ratio takes its content's height as its least height unless told
 * otherwise, which grew the tile square around the video, so that least
 * height is zero. jsdom lays nothing out, so the sheets are laid
 * (`testing/container-width.ts`) and the tile is built in the markup
 * `@luke/ui`'s `CallVideoTile` draws, at the fit each surface hands it.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** The tile with live video at `fit`, inside the parent given, answering the tile and its frame. */
function liveTile(parent: HTMLElement, fit: CallVideoFit) {
  const tile = parent.appendChild(document.createElement("section"));
  tile.className = "luke-call-video-tile";
  tile.dataset.status = "live";
  tile.dataset.fit = fit;
  const frame = tile.appendChild(document.createElement("video"));
  frame.className = "luke-call-video-frame";
  const fill = tile.appendChild(document.createElement("video"));
  fill.className = "luke-call-video-fill";
  return { tile, frame, fill };
}

/** A call card in the sidebar, holding a live tile. */
function cardTile() {
  laid = layContainersAt({});
  document.documentElement.dataset.lukeProfile = "desktop";
  const card = document.body.appendChild(document.createElement("section"));
  card.className = "call-card";
  card.dataset.surface = "sidebar";
  return liveTile(card, CALL_VIDEO_FIT.CARD);
}

test("the card's tile takes no least height from the square stream inside it", () => {
  assert.equal(getComputedStyle(cardTile().tile).minHeight, "0px");
});

test("the call card's tile stays 16:9 at the card's width", () => {
  const drawn = getComputedStyle(cardTile().tile);
  assert.equal(drawn.aspectRatio, "16 / 9");
  assert.equal(drawn.width, "100%");
});

test("the picture is drawn whole, and a blurred copy fills the tile under it", () => {
  const { tile, frame, fill } = cardTile();
  assert.equal(getComputedStyle(frame).objectFit, "contain");
  const under = getComputedStyle(fill);
  assert.equal(under.objectFit, "cover");
  assert.equal(under.position, "absolute");
  assert.equal(under.zIndex, "-1");
  assert.match(under.filter, /blur\(/u);
  assert.equal(
    getComputedStyle(tile).isolation,
    "isolate",
    "the fill stands over the tile's ground",
  );
});

/** An agent's tab's video room, holding its live tile in its frame, as `panel-avatar.tsx` draws them. */
function videoRoom() {
  laid = layContainersAt({});
  document.documentElement.dataset.lukeProfile = "desktop";
  const room = document.body.appendChild(document.createElement("div"));
  room.className = "agent-call-video";
  const frame = room.appendChild(document.createElement("div"));
  frame.className = "agent-call-video-frame";
  return { box: frame, ...liveTile(frame, CALL_VIDEO_FIT.PICTURE) };
}

test("an agent's tab's video is a rectangle at its picture's own aspect, as tall as the developer left it, which the picture fills with no blurred fill beside it", () => {
  const { box, tile, frame, fill } = videoRoom();
  const room = getComputedStyle(box);
  assert.equal(room.aspectRatio, "var(--call-video-aspect)");
  assert.match(room.width, /var\(--call-video-height\) \* var\(--call-video-aspect\)/u);
  assert.match(room.width, /^min\(\s*100%,/u, "never wider than the tab");
  const drawn = getComputedStyle(tile);
  assert.equal(drawn.width, "100%");
  assert.equal(drawn.height, "100%");
  assert.equal(getComputedStyle(frame).objectFit, "cover");
  assert.equal(getComputedStyle(fill).display, "none");
});

test("a clip still being read beside a call's controls wraps them onto a line of their own where the card is too narrow for both", () => {
  laid = layContainersAt({});
  const foot = document.body.appendChild(document.createElement("div"));
  foot.className = "prompt-input-footer";
  const strip = foot.appendChild(document.createElement("div"));
  strip.className = "dictation-strip";
  const controls = foot.appendChild(document.createElement("fieldset"));
  controls.className = "agent-call-controls";
  assert.equal(getComputedStyle(foot).flexWrap, "wrap");
  assert.equal(
    getComputedStyle(strip).flexBasis,
    "160px",
    "the strip keeps room for its word and Cancel",
  );
  controls.remove();
  assert.equal(
    getComputedStyle(foot).flexWrap,
    "nowrap",
    "a dictation off a call keeps its one row",
  );
});
