// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PictureSet, PictureSetTile, PictureStandIn } from "../../index.js";
import { PICTURE_STATE } from "../../picture-cache.js";

/**
 * picture-set.test.ts -- a set of pictures is a list its caller names; a
 * few stand captioned, each opening at a press, while many say how many
 * they hold, the last tile drawn saying how many more; a gone picture says
 * so in its words, or why where its place says, and opens nothing, as does
 * one whose place gives nothing to open; a picture whose read did not land
 * offers Retry in its press's place; and a picture still read is said as
 * reading it.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container on the page. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

const READY = { kind: PICTURE_STATE.READY, url: "data:image/png;base64,iVBORw==" } as const;

test("a few pictures stand captioned in the list their caller names, each opening at a press", () => {
  const opened: string[] = [];
  const container = mount(
    createElement(
      PictureSet,
      { label: "Pictures the agent showed", count: 2, children: undefined },
      ["Before", "After"].map((words) =>
        createElement(PictureSetTile, {
          key: words,
          state: READY,
          width: 1200,
          height: 720,
          words,
          caption: words,
          onOpen: () => opened.push(words),
        }),
      ),
    ),
  );
  const list = container.querySelector('ul[aria-label="Pictures the agent showed"]');
  const presses = [...(list?.querySelectorAll("li button") ?? [])];

  expect(presses.map((press) => press.getAttribute("aria-label"))).toEqual([
    "Enlarge Before",
    "Enlarge After",
  ]);
  expect(presses.map((press) => press.textContent)).toEqual(["Before", "After"]);
  act(() => (presses[1] as HTMLButtonElement).click());
  expect(opened).toEqual(["After"]);
  expect(container.querySelector("figcaption")).toBeNull();
});

test("many pictures say how many they hold, the last tile drawn saying how many more, with no caption under each", () => {
  const container = mount(
    createElement(
      PictureSet,
      { label: "Pictures", count: 9, children: undefined },
      Array.from({ length: 6 }, (_, at) =>
        createElement(PictureSetTile, {
          key: String(at),
          state: READY,
          words: `Screen ${String(at + 1)}`,
          caption: `Screen ${String(at + 1)}`,
          onOpen: () => undefined,
        }),
      ),
    ),
  );
  const presses = [...container.querySelectorAll("li button")];

  expect(presses).toHaveLength(6);
  expect(presses.map((press) => press.textContent)).toEqual(["", "", "", "", "", "+3"]);
  expect(container.querySelector("figcaption")?.textContent).toBe("9 pictures");
});

test("a gone picture says so, or why where its place says, and opens nothing, nor does one with nothing to open", () => {
  const opened: string[] = [];
  const container = mount(
    createElement(
      PictureSet,
      { label: "Pictures the call answered", count: 3, thumbnails: true, children: undefined },
      createElement(PictureSetTile, {
        key: "gone",
        state: { kind: PICTURE_STATE.MISSING },
        words: "Members",
        onOpen: () => opened.push("gone"),
      }),
      createElement(PictureSetTile, {
        key: "not-kept",
        state: { kind: PICTURE_STATE.MISSING },
        words: "screenshot-2",
        why: "not kept · 6.4 MB",
      }),
      createElement(PictureSetTile, {
        key: "waiting",
        state: { kind: PICTURE_STATE.READING },
        words: "Settings",
      }),
    ),
  );
  const tiles = [...container.querySelectorAll("li")];

  expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(
    tiles.map((tile) => tile.querySelector('[role="img"]')?.getAttribute("aria-label")),
  ).toEqual(["Members · not available", "screenshot-2 · not kept · 6.4 MB", undefined]);
  expect(tiles[2]?.querySelector('[role="status"]')?.textContent).toContain("Reading the picture");
  expect(opened).toEqual([]);
});

test("a gone picture with no words of its own says the picture is not available", () => {
  const container = mount(
    createElement(PictureStandIn, { state: PICTURE_STATE.MISSING, words: "" }),
  );

  expect(container.textContent).toBe("This picture is not available");
});

test("a picture whose read did not land says it could not be read, and its Retry reads it again rather than opening it", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(
      PictureSet,
      { label: "Pictures the call answered", count: 1, thumbnails: true, children: undefined },
      createElement(PictureSetTile, {
        key: "failed",
        state: { kind: PICTURE_STATE.FAILED, retry: () => pressed.push("retry") },
        words: "Members",
        onOpen: () => pressed.push("open"),
      }),
    ),
  );
  const presses = [...container.querySelectorAll("button")];

  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Members could not be read.",
  );
  expect(presses.map((press) => press.textContent)).toEqual(["Retry"]);
  act(() => (presses[0] as HTMLButtonElement).click());
  expect(pressed).toEqual(["retry"]);
});

test("the last tile drawn, failed, keeps its Retry in reach rather than under how many more there are", () => {
  const retried: string[] = [];
  const container = mount(
    createElement(
      PictureSet,
      { label: "Pictures", count: 7, children: undefined },
      Array.from({ length: 6 }, (_, at) =>
        createElement(PictureSetTile, {
          key: String(at),
          state:
            at === 5 ? { kind: PICTURE_STATE.FAILED, retry: () => retried.push("sixth") } : READY,
          words: `Screen ${String(at + 1)}`,
          onOpen: () => undefined,
        }),
      ),
    ),
  );
  const sixth = container.querySelectorAll("li")[5];

  expect(sixth?.textContent).not.toContain("+1");
  act(() => sixth?.querySelector("button")?.click());
  expect(retried).toEqual(["sixth"]);
  expect(container.querySelector("figcaption")?.textContent).toBe("7 pictures");
});
