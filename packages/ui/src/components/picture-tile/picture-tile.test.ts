// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PictureTile } from "../../index.js";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

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

test("a tile a pointer's press does not open lets that press pass to its place, and a key's press still opens it", () => {
  const opened: string[] = [];
  const reached: string[] = [];
  const container = mount(
    createElement(
      "div",
      { onClick: () => reached.push("section") },
      createElement(PictureTile, {
        name: "A diagram",
        pointerOpens: false,
        onOpen: () => opened.push("diagram"),
        children: shot("A diagram"),
      }),
    ),
  );
  const tile = container.querySelector("button") ?? expect.unreachable("the tile is drawn");

  act(() => tile.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  expect(opened).toEqual([]);
  expect(reached).toEqual(["section"]);

  act(() => tile.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
  expect(opened).toEqual(["diagram"]);
});
