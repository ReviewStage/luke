// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AVATAR_STATUS } from "@luke/voice/avatar";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { AvatarVoice, CALL_VIDEO_LABEL, CallVideoTile } from "./call-video-tile";

type TileProps = Parameters<typeof CallVideoTile>[0];
type VoiceProps = Parameters<typeof AvatarVoice>[0];

/** The browser's stream, which jsdom has none of: it holds the tracks it was made from. */
class FakeMediaStream {
  constructor(readonly tracks: readonly MediaStreamTrack[]) {}
}

// SAFETY: the tile only hands a track to a stream, never reads one, so a track's identity is all it needs.
const VIDEO = { kind: "video", id: "avatar-video" } as MediaStreamTrack;
// SAFETY: as above, the tile reads nothing of a track.
const AUDIO = { kind: "audio", id: "avatar-audio" } as MediaStreamTrack;

const mounted: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("MediaStream", FakeMediaStream);
});

afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function tile(props: Partial<TileProps> = {}): React.ReactElement<TileProps> {
  return createElement(CallVideoTile, {
    video: undefined,
    status: AVATAR_STATUS.STARTING,
    onSetVideo: () => undefined,
    ...props,
  });
}

function voice(props: Partial<VoiceProps> = {}): React.ReactElement<VoiceProps> {
  return createElement(AvatarVoice, {
    audio: AUDIO,
    speakerMuted: false,
    onAudioElement: () => undefined,
    ...props,
  });
}

function mountRoot(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(element));
  return { container, root };
}

function button(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name || each.textContent === name,
  );
}

/** The tracks a media element is playing, as the stream it was handed holds them. */
function playing(element: HTMLMediaElement | null): readonly MediaStreamTrack[] | undefined {
  // SAFETY: the stream global is stubbed with FakeMediaStream for every test, so the tile made this one.
  const source = element?.srcObject as FakeMediaStream | null | undefined;
  return source?.tracks;
}

test("no call in progress, or the experiment off, draws nothing", () => {
  const { container } = mountRoot(tile({ status: undefined }));
  assert.equal(container.querySelector("section"), null);
});

test("a connecting avatar says so and offers video off, not a restart", () => {
  const { container } = mountRoot(tile({ status: AVATAR_STATUS.STARTING }));
  assert.match(container.textContent ?? "", new RegExp(CALL_VIDEO_LABEL.CONNECTING));
  assert.ok(button(container, CALL_VIDEO_LABEL.VIDEO_OFF));
  assert.equal(button(container, CALL_VIDEO_LABEL.RESTART), undefined);
  assert.equal(container.querySelector("video"), null);
});

test("a live avatar plays its video track", () => {
  const { container } = mountRoot(tile({ status: AVATAR_STATUS.LIVE, video: VIDEO }));
  assert.deepEqual(playing(container.querySelector("video")), [VIDEO]);
  assert.doesNotMatch(container.textContent ?? "", new RegExp(CALL_VIDEO_LABEL.CONNECTING));
});

test("a live avatar with no video track draws Luke's face as a still frame", () => {
  const { container } = mountRoot(tile({ status: AVATAR_STATUS.LIVE }));
  assert.equal(container.querySelector("video"), null);
  assert.ok(container.querySelector(".call-video-still svg"));
  assert.equal(button(container, CALL_VIDEO_LABEL.RESTART), undefined);
});

test("an ended avatar offers Restart video, and the press puts video up again", () => {
  const onSetVideo = vi.fn();
  const { container } = mountRoot(tile({ status: AVATAR_STATUS.ENDED, onSetVideo }));
  assert.match(container.textContent ?? "", new RegExp(CALL_VIDEO_LABEL.ENDED));
  act(() => button(container, CALL_VIDEO_LABEL.RESTART)?.click());
  assert.deepEqual(onSetVideo.mock.calls, [[true]]);
});

test("the tile has no hang-up of its own, which the call bar already is", () => {
  for (const status of [AVATAR_STATUS.STARTING, AVATAR_STATUS.LIVE, AVATAR_STATUS.ENDED]) {
    const { container } = mountRoot(tile({ status, video: VIDEO }));
    const labels = [...container.querySelectorAll("button")].map((each) =>
      each.getAttribute("aria-label"),
    );
    assert.equal(labels.includes("End call"), false, status);
    assert.equal(container.querySelector(".call-end"), null, status);
  }
});

test("video off collapses the tile to a strip whose one button turns video on again", () => {
  const onSetVideo = vi.fn();
  const { container, root } = mountRoot(
    tile({ status: AVATAR_STATUS.LIVE, video: VIDEO, onSetVideo }),
  );
  act(() => button(container, CALL_VIDEO_LABEL.VIDEO_OFF)?.click());
  // Main answers the off with the avatar ended by the developer, which the model reads as OFF.
  act(() => root.render(tile({ status: AVATAR_STATUS.OFF, video: undefined, onSetVideo })));
  assert.equal(container.querySelector("video"), null);
  assert.equal(button(container, CALL_VIDEO_LABEL.VIDEO_OFF), undefined);
  assert.match(container.textContent ?? "", new RegExp(CALL_VIDEO_LABEL.TURNED_OFF));
  act(() => button(container, CALL_VIDEO_LABEL.VIDEO_ON)?.click());
  assert.deepEqual(onSetVideo.mock.calls, [[false], [true]]);
});

test("the tile draws no sound of its own, which the panel plays apart from it", () => {
  const { container } = mountRoot(tile({ status: AVATAR_STATUS.LIVE, video: VIDEO }));
  assert.equal(container.querySelector("audio"), null);
});

test("the avatar's voice plays, and follows the speaker toggle both ways", () => {
  const { container, root } = mountRoot(voice());
  const audio = container.querySelector("audio");
  assert.deepEqual(playing(audio), [AUDIO]);
  assert.equal(audio?.muted, false);
  act(() => root.render(voice({ speakerMuted: true })));
  assert.equal(audio?.muted, true);
  act(() => root.render(voice({ speakerMuted: false })));
  assert.equal(audio?.muted, false);
});

test("the avatar's voice is let go of once its track is", () => {
  const { container, root } = mountRoot(voice());
  const audio = container.querySelector("audio");
  act(() => root.render(voice({ audio: undefined })));
  assert.equal(container.querySelector("audio"), audio);
  assert.equal(playing(audio), undefined);
});
