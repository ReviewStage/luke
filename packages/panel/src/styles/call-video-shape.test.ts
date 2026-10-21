// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * call-video-shape.test.ts -- Luke's video tile draws the avatar's whole
 * picture in a shape that follows the room. The stock avatars stream a
 * square picture: in the Call tab the tile is square at its width and held
 * to two fifths of the stage's height, so a short window draws it wider,
 * never past 16:9; on the call card it stays 16:9. The picture is never
 * cut, and a blurred copy of it fills what it leaves. A box drawn at a
 * ratio takes its content's height as its least height unless told
 * otherwise, which grew the tile square around the video, so that least
 * height is zero. jsdom lays nothing out, so the sheets are laid
 * (`testing/container-width.ts`) and the tile is built in the markup
 * `call-video-tile.tsx` draws, on each surface it stands on.
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
  const fill = tile.appendChild(document.createElement("video"));
  fill.className = "call-video-fill";
  return { tile, frame, fill };
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

test("no tile takes its least height from the square stream inside it", () => {
  for (const { tile } of Object.values(surfaces())) {
    assert.equal(getComputedStyle(tile).minHeight, "0px");
  }
});

test("the Call tab's tile is square at its width, held to two fifths of the stage, and never wider than 16:9 at that height", () => {
  const { tab } = surfaces();
  const drawn = getComputedStyle(tab.tile);
  assert.equal(drawn.aspectRatio, "1 / 1");
  assert.match(drawn.maxHeight, /--luke-stage-height\) \* 0\.4\)\)$/u);
  assert.match(
    drawn.maxHeight,
    /^max\(135px, /u,
    "a stage too short for the narrowest tile's 16:9 keeps that height rather than flattening it",
  );
  assert.match(
    drawn.width,
    /^min\(/u,
    "the tile follows the tab rather than standing at one width",
  );
  assert.match(drawn.width, /\b560px\b/u);
  assert.match(drawn.width, /--luke-stage-height\) \* 0\.4 \* 16 \/ 9\)/u);
});

test("the call card's tile stays 16:9 at the card's width", () => {
  const { card } = surfaces();
  const drawn = getComputedStyle(card.tile);
  assert.equal(drawn.aspectRatio, "16 / 9");
  assert.equal(drawn.maxHeight, "none");
});

test("the picture is drawn whole, and a blurred copy fills the tile under it", () => {
  for (const { tile, frame, fill } of Object.values(surfaces())) {
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
  }
});

/** An agent's tab's call row: its captions, then its tile, as `agent-call.tsx` draws them. */
function callRow() {
  laid = layContainersAt({});
  document.documentElement.dataset.lukeProfile = "desktop";
  const row = document.body
    .appendChild(document.createElement("div"))
    .appendChild(document.createElement("div"));
  row.parentElement?.classList.add("agent-call-foot");
  row.className = "agent-call-float";
  const caption = row.appendChild(document.createElement("div"));
  caption.className = "voice-caption";
  const { tile } = liveTile(row);
  return { row, caption, tile };
}

test("an agent's tab's tile is small, square, and as wide as the developer left it, never wider than its row", () => {
  const { tile } = callRow();
  const drawn = getComputedStyle(tile);
  assert.equal(drawn.aspectRatio, "1 / 1");
  assert.equal(drawn.width, "min(var(--call-tile-width), 100%)");
  assert.equal(drawn.maxHeight, "none");
});

test("an agent's tab's captions stand beside its tile while the row has room for a readable line, and wrap onto a line of their own over it where it has not", () => {
  const { row, caption } = callRow();
  assert.equal(getComputedStyle(row).flexWrap, "wrap");
  const drawn = getComputedStyle(caption);
  assert.equal(drawn.position, "relative", "in the row's flow, not over the window");
  assert.equal(drawn.flexBasis, "var(--caption-width-min)");
  assert.equal(drawn.maxWidth, "var(--caption-width-max)");
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
