// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { VIDEO_PLAYER_PLACE, VideoPlayer } from "../../index.js";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  document.documentElement.style.removeProperty(DURATION_FAST);
  vi.restoreAllMocks();
});

const DURATION_FAST = "--ui-duration-fast";

const WEBM_URL = "data:video/webm;base64,GkXfow==";

const TENTH_FRAME_URL = "data:video/webm;base64,GkXfoyPjg4QF9eEAH0O2dQ==";

const LENGTH_S = 20;

function standInMedia(video: HTMLVideoElement): () => number {
  let paused = true;
  let at = 0;
  let displayingFullscreen = false;
  Object.defineProperties(video, {
    webkitDisplayingFullscreen: { get: () => displayingFullscreen },
    webkitEnterFullscreen: {
      value: () => {
        displayingFullscreen = true;
      },
    },
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
  return () => at;
}

function mountPlayer(onExpand?: () => void, dataUrl = WEBM_URL) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recording");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  const reached: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "div",
        { onKeyDown: (event: React.KeyboardEvent) => reached.push(event.key) },
        createElement(VideoPlayer, {
          dataUrl,
          label: "Inviting a member",
          place: VIDEO_PLAYER_PLACE.INLINE,
          onExpand,
        }),
      ),
    ),
  );
  const video = container.querySelector("video");
  if (video === null) throw new Error("the player draws its video");
  const playhead = standInMedia(video);
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
  const pressButton = (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (button === null) throw new Error(`the bar has a ${label}`);
    act(() => button.click());
  };
  return { container, video, press, pressButton, toggleLabel, seekAt, playhead, reached };
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

test("the arrows seek five seconds within the video's length, flashing how far, from its scrubber too, and never reach the place around it", () => {
  const { container, press, seekAt, reached } = mountPlayer();
  const flash = () => container.querySelector(".ui-video-player-flash")?.textContent;
  press("ArrowRight");
  press("ArrowRight");
  expect(seekAt()).toBe("10");
  expect(flash()).toBe("10 seconds");
  press("ArrowLeft");
  press("ArrowLeft");
  press("ArrowLeft");
  expect(seekAt()).toBe("0");
  expect(flash()).toBe("10 seconds");
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

test("comma and period, like the frame buttons, pause the video and step one frame of the length its header states", () => {
  const { press, pressButton, toggleLabel, playhead, reached } = mountPlayer(
    undefined,
    TENTH_FRAME_URL,
  );
  press("k");
  press(".");
  expect(toggleLabel()).toBe("Play");
  expect(playhead()).toBeCloseTo(0.15);
  press(".", undefined, true);
  expect(playhead()).toBeCloseTo(0.25);
  press(",");
  expect(playhead()).toBeCloseTo(0.15);
  pressButton("Previous frame");
  pressButton("Previous frame");
  expect(playhead()).toBeCloseTo(0.05);
  pressButton("Next frame");
  expect(playhead()).toBeCloseTo(0.15);
  press("End");
  press(",");
  expect(playhead()).toBeCloseTo(LENGTH_S - 0.15);
  expect(reached).toEqual([]);
});

test("Full screen opens the video in the browser's own player where the browser fills the screen with no element", () => {
  const { video, pressButton } = mountPlayer();
  pressButton("Full screen");
  expect(Reflect.get(video, "webkitDisplayingFullscreen")).toBe(true);
});

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
  document.documentElement.style.setProperty(DURATION_FAST, "1ms");
  expect(mountInViewer().autoplay).toBe(false);
});
