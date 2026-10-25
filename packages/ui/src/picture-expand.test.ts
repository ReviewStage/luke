// @vitest-environment jsdom

import { act, createElement, useId, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { DIALOG_SIZE, Dialog, PictureTile, usePictureExpand } from "./index.js";

/**
 * picture-expand.test.ts -- a picture opened from its tile is put away
 * only once its flight back into the tile ends. A tile gone by the close,
 * reduced motion, and a viewer opened from no tile close at once, as every
 * dialog does.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** One flight a card or the dimmed window played: what moved and through which poses, and how it ends. */
interface Played {
  readonly element: Element;
  readonly frames: Keyframe[];
  readonly animation: { onfinish: (() => void) | null };
}

/** Where each part stands on the page, as the browser would lay it out. */
const RECT = {
  TILE: { left: 40, top: 300, width: 120, height: 80 },
  CARD: { left: 200, top: 100, width: 600, height: 440 },
  PICTURE: { left: 200, top: 140, width: 600, height: 400 },
} as const;

const roots: Root[] = [];
let played: Played[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  played = [];
  document.documentElement.style.setProperty("--luke-duration-fast", "280ms");
  document.documentElement.style.setProperty("--luke-spring-fast", "ease-out");
  // Note that jsdom lays nothing out and plays no animation, so the browser's
  // layout and its animation are what stand in here, at that boundary.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const rect = this.classList.contains("luke-picture-tile-face")
      ? RECT.TILE
      : this.classList.contains("luke-dialog")
        ? RECT.CARD
        : this.classList.contains("luke-zoom-image")
          ? RECT.PICTURE
          : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    return DOMRect.fromRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  });
  HTMLElement.prototype.animate = function (this: HTMLElement, frames: Keyframe[] | null) {
    const animation = { onfinish: null, cancel: () => undefined };
    played.push({ element: this, frames: frames ?? [], animation });
    return animation as unknown as Animation;
  };
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.restoreAllMocks();
});

/** A picture shown over the window as the viewer shows it, put away through its flight. */
function Viewer({ onClosed }: { onClosed: () => void }): React.JSX.Element {
  const titleId = useId();
  const expand = usePictureExpand(true);
  return createElement(Dialog, {
    open: true,
    size: DIALOG_SIZE.MEDIA,
    labelledBy: titleId,
    onDismiss: () => expand.close(onClosed),
    expand,
    children: [
      createElement("h2", { key: "title", id: titleId }, "The settings page"),
      createElement("img", {
        key: "picture",
        className: "luke-zoom-image",
        alt: "The settings page",
      }),
    ],
  });
}

/** A tile that opens the viewer, which a button withdraws, and the viewer while it stands. */
function Page({ closed }: { closed: string[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [tiled, setTiled] = useState(true);
  return createElement(
    "div",
    null,
    tiled
      ? createElement(PictureTile, {
          name: "The settings page",
          onOpen: () => setOpen(true),
          children: createElement("img", { alt: "The settings page" }),
        })
      : null,
    createElement("button", { type: "button", onClick: () => setTiled(false) }, "Withdraw"),
    open
      ? createElement(Viewer, {
          onClosed: () => {
            closed.push("closed");
            setOpen(false);
          },
        })
      : null,
  );
}

/** Draws the page and answers its tile, its viewer's card, and a way to press Escape in it. */
function mountPage(closed: string[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Page, { closed })));
  const tile = container.querySelector<HTMLButtonElement>(".luke-picture-tile");
  if (tile === null) throw new Error("the tile is drawn");
  return {
    tile,
    card: () => document.querySelector<HTMLElement>(".luke-dialog"),
    withdraw: () => {
      const button = [...container.querySelectorAll("button")].find(
        (each) => each.textContent === "Withdraw",
      );
      act(() => button?.click());
    },
    escape: () => {
      const card = document.querySelector(".luke-dialog");
      act(() =>
        card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      );
    },
  };
}

/** The flights the card played. */
function cardFlights(): Played[] {
  return played.filter((each) => each.element.classList.contains("luke-dialog"));
}

test("a picture opened from its tile is put away only once its flight back into the tile ends", () => {
  const closed: string[] = [];
  const page = mountPage(closed);

  act(() => page.tile.click());

  page.escape();
  expect(closed).toEqual([]);
  const shrink = cardFlights()[1];
  act(() => shrink?.animation.onfinish?.());

  expect(closed).toEqual(["closed"]);
  expect(page.card()).toBeNull();
});

test("a viewer whose tile is gone by the close is put away at once", () => {
  const closed: string[] = [];
  const page = mountPage(closed);
  act(() => page.tile.click());

  page.withdraw();
  page.escape();

  expect(closed).toEqual(["closed"]);
  expect(page.card()).toBeNull();
});

test("under reduced motion a picture closes at once, as every dialog does", () => {
  document.documentElement.style.setProperty("--luke-duration-fast", "0ms");
  const closed: string[] = [];
  const page = mountPage(closed);

  act(() => page.tile.click());
  page.escape();

  expect(closed).toEqual(["closed"]);
});

test("a viewer opened from no tile keeps the dialog's own entrance and closes at once", () => {
  const closed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Viewer, { onClosed: () => closed.push("closed") })));

  const card = document.querySelector(".luke-dialog");
  act(() => card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  expect(closed).toEqual(["closed"]);
});
