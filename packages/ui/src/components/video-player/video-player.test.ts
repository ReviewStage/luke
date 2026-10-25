// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { VIDEO_PLAYER_PLACE, VideoPlayer } from "../../index.js";

/**
 * video-player.test.ts -- while focus is in a video's player, Space or K
 * plays and pauses it and the arrows seek five seconds within its length,
 * none of them reaching the place around it, whose arrows may walk files; a
 * button's own Space is left to the button. In the viewer it starts at
 * once, unless motion is held still. The browser's media element is
 * the boundary, so a stand-in plays, pauses, and seeks as one does, telling
 * its events, and the player is read by what its bar shows.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  document.documentElement.style.removeProperty(DURATION_FAST);
  vi.restoreAllMocks();
});

/** The motion token reduced motion zeroes, which says motion is held still. */
const DURATION_FAST = "--luke-duration-fast";

/** A WebM's bytes as a picture read answers them; the stand-in element never decodes them. */
const WEBM_URL = "data:video/webm;base64,GkXfow==";

/** How long the stand-in runs, in seconds. */
const LENGTH_S = 20;

/** Makes the page's video a stand-in that plays, pauses, and seeks as a browser's does, telling its events. */
function standInMedia(video: HTMLVideoElement): void {
  let paused = true;
  let at = 0;
  Object.defineProperties(video, {
    paused: { get: () => paused },
    duration: { get: () => LENGTH_S },
    currentTime: {
      get: () => at,
      set: (next: number) => {
        at = next;
        video.dispatchEvent(new Event("timeupdate"));
      },
    },
    play: {
      value: () => {
        paused = false;
        video.dispatchEvent(new Event("play"));
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        paused = true;
        video.dispatchEvent(new Event("pause"));
      },
    },
  });
  act(() => video.dispatchEvent(new Event("loadedmetadata")));
}

/** Draws a player inside a box that records every key reaching it, its video a stand-in. */
function mountPlayer(onExpand?: () => void) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recording");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  const reached: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // Note that the place around listens as the viewer's walk does, through React, which the player's keys stop short of.
  act(() =>
    root.render(
      createElement(
        "div",
        { onKeyDown: (event: React.KeyboardEvent) => reached.push(event.key) },
        createElement(VideoPlayer, {
          dataUrl: WEBM_URL,
          label: "Inviting a member",
          place: VIDEO_PLAYER_PLACE.INLINE,
          onExpand,
        }),
      ),
    ),
  );
  const video = container.querySelector("video");
  if (video === null) throw new Error("the player draws its video");
  standInMedia(video);
  const frame = video.parentElement;
  if (frame === null) throw new Error("the video stands in a frame");
  const press = (key: string, on: HTMLElement = frame, repeat = false) =>
    act(() =>
      on.dispatchEvent(
        new KeyboardEvent("keydown", { key, repeat, bubbles: true, cancelable: true }),
      ),
    );
  const toggleLabel = () =>
    container
      .querySelector('button[aria-label="Play"], button[aria-label="Pause"]')
      ?.getAttribute("aria-label");
  const seekAt = () => container.querySelector<HTMLInputElement>('input[aria-label="Seek"]')?.value;
  return { container, press, toggleLabel, seekAt, reached };
}

test("Space and K play and pause the video while focus is in its player, and neither reaches the place around it", () => {
  const { press, toggleLabel, reached } = mountPlayer();
  expect(toggleLabel()).toBe("Play");
  press(" ");
  expect(toggleLabel()).toBe("Pause");
  press("k");
  expect(toggleLabel()).toBe("Play");
  press("K");
  expect(toggleLabel()).toBe("Pause");
  expect(reached).toEqual([]);
});

test("the arrows seek five seconds within the video's length, from its scrubber too, and never reach the place around it", () => {
  const { container, press, seekAt, reached } = mountPlayer();
  press("ArrowRight");
  expect(seekAt()).toBe("5");
  press("ArrowLeft");
  press("ArrowLeft");
  expect(seekAt()).toBe("0");
  const seek = container.querySelector<HTMLInputElement>('input[aria-label="Seek"]');
  if (seek === null) throw new Error("the bar has a scrubber");
  for (const _ of [1, 2, 3, 4, 5]) press("ArrowRight", seek);
  expect(seekAt()).toBe(String(LENGTH_S));
  expect(reached).toEqual([]);
});

test("Space on one of the bar's buttons is the button's, and other keys pass on to the place around the player", () => {
  const { container, press, toggleLabel, reached } = mountPlayer(() => undefined);
  const expand = container.querySelector<HTMLButtonElement>('button[aria-label="Expand"]');
  if (expand === null) throw new Error("the bar has an Expand");
  press(" ", expand);
  expect(toggleLabel()).toBe("Play");
  press("Escape");
  press("Tab");
  expect(reached).toEqual([" ", "Escape", "Tab"]);
});

test("a held Space or K plays or pauses once, while a held arrow goes on seeking", () => {
  const { press, toggleLabel, seekAt } = mountPlayer();
  press("k");
  for (const _ of [1, 2, 3]) press("k", undefined, true);
  expect(toggleLabel()).toBe("Pause");
  press(" ");
  for (const _ of [1, 2, 3, 4]) press(" ", undefined, true);
  expect(toggleLabel()).toBe("Play");
  press("ArrowRight");
  press("ArrowRight", undefined, true);
  expect(seekAt()).toBe("10");
});

/** Draws a player in the viewer, as the file viewer an Expand opens does, and answers its video. */
function mountInViewer(): HTMLVideoElement {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recording");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(VideoPlayer, {
        dataUrl: WEBM_URL,
        label: "Inviting a member",
        place: VIDEO_PLAYER_PLACE.VIEWER,
      }),
    ),
  );
  return container.querySelector("video") ?? expect.unreachable("the player draws its video");
}

test("in the viewer the video starts at once", () => {
  expect(mountInViewer().autoplay).toBe(true);
});

test("in the viewer the video waits for Play where motion is held still", () => {
  // Note that reduced motion holds motion at the tokens, which the setting's stylesheet would zero.
  document.documentElement.style.setProperty(DURATION_FAST, "1ms");
  expect(mountInViewer().autoplay).toBe(false);
});
