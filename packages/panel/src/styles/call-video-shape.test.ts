// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_VIDEO_FIT, type CallVideoFit, CallVideoTile } from "@luke/ui";
import { AVATAR_STATUS } from "@luke/voice/avatar";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
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
 * height is zero. jsdom lays nothing out, so the sheets and the app's
 * utilities are laid (`testing/container-width.ts`) and `@luke/ui`'s
 * `CallVideoTile` is drawn with live video, at the fit each surface hands it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The browser's stream, which jsdom has none of: it holds the tracks it was made from. */
class StandInMediaStream {
  constructor(readonly tracks: readonly MediaStreamTrack[]) {}
}

// SAFETY: the tile only hands a track to a stream, never reads one, so a track's identity is all it needs.
const VIDEO = { kind: "video", id: "avatar-video" } as MediaStreamTrack;

let laid: HTMLStyleElement | undefined;
const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("MediaStream", StandInMediaStream);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** The tile with live video at `fit`, inside the parent given, answering the tile, its picture, and the blurred fill. */
function liveTile(parent: HTMLElement, fit: CallVideoFit) {
  const root = createRoot(parent);
  roots.push(root);
  act(() =>
    root.render(
      createElement(CallVideoTile, {
        video: VIDEO,
        status: AVATAR_STATUS.LIVE,
        fit,
        onSetVideo: () => undefined,
      }),
    ),
  );
  const tile = parent.querySelector<HTMLElement>("section") ?? assert.fail("the tile stands");
  const [frame, fill] = [...tile.querySelectorAll("video")];
  return {
    tile,
    frame: frame ?? assert.fail("its picture"),
    fill: fill ?? assert.fail("its fill"),
  };
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
  foot.className = "luke-composer-foot-bar";
  const strip = foot.appendChild(document.createElement("div"));
  strip.className = "luke-composer-foot-strip";
  strip.appendChild(document.createElement("div")).className = "dictation-strip";
  const controls = foot.appendChild(document.createElement("div"));
  controls.className = "luke-composer-foot-call";
  controls.appendChild(document.createElement("fieldset")).className = "agent-call-controls";
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
