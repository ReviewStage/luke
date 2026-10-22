// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PictureTile } from "../../index.js";

/**
 * picture-tile.test.ts -- a picture tile is a button named for what its
 * press does, "Enlarge" and the picture's words, or "Enlarge" alone for a
 * picture with none; a press opens the picture without submitting the form
 * it stands in, and is handed to the place drawing it, which may keep it
 * from the element around. Words under the picture are part of the press,
 * and a hint that hears the press leaves the tile's own opening in place.
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

/** A stand-in picture, as a place frames it. */
function shot(alt: string): React.ReactElement {
  return createElement("img", { src: "data:image/png;base64,iVBORw==", alt });
}

test("a picture tile is named Enlarge and its words, opens at a press without submitting its form, and its place may keep the press", () => {
  const opened: string[] = [];
  const reached: string[] = [];
  const submitted: string[] = [];
  const container = mount(
    createElement(
      "form",
      {
        onClick: () => reached.push("form"),
        onSubmit: (event: SubmitEvent) => {
          event.preventDefault();
          submitted.push("form");
        },
      },
      createElement(PictureTile, {
        name: "The settings page",
        onOpen: () => opened.push("settings"),
        caption: createElement("span", null, "After"),
        children: shot("The settings page"),
      }),
      createElement(PictureTile, {
        name: "",
        onOpen: (event) => {
          event.stopPropagation();
          opened.push("unnamed");
        },
        children: shot(""),
      }),
    ),
  );
  const tiles = Array.from(container.querySelectorAll("button"));

  expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
    "Enlarge The settings page",
    "Enlarge",
  ]);
  expect(tiles[0]?.textContent).toBe("After");
  for (const tile of tiles) act(() => tile.click());
  expect(opened).toEqual(["settings", "unnamed"]);
  expect(reached).toEqual(["form"]);
  expect(submitted).toEqual([]);
});

test("a hint wrapping a picture tile hears its press, and the tile still opens", () => {
  const heard: string[] = [];
  const container = mount(
    createElement(PictureTile, {
      name: "Before",
      onClick: () => heard.push("hint"),
      onOpen: () => heard.push("open"),
      children: shot("Before"),
    }),
  );

  act(() => container.querySelector("button")?.click());

  expect(heard).toEqual(["hint", "open"]);
});
