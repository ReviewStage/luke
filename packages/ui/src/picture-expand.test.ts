// @vitest-environment jsdom

import { act, createElement, useId, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { DIALOG_SIZE, Dialog, PictureTile, usePictureExpand } from "./index.js";

/**
 * picture-expand.test.ts -- a picture opened from its tile grows from the
 * tile's own rect into the viewer, its card's own entrance stood down and
 * the tile's picture hidden while its own flies, and closing shrinks it back
 * into the tile before the viewer is taken away. A tile gone by the close,
 * reduced motion, and a viewer opened from no tile open and close as every
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
function Viewer({
  onClosed,
  onOpened = true,
}: {
  onClosed: () => void;
  onOpened?: boolean;
}): React.JSX.Element {
  const titleId = useId();
  const expand = usePictureExpand(onOpened);
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
  const [walked, setWalked] = useState(false);
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
    createElement("button", { type: "button", onClick: () => setWalked(true) }, "Walk"),
    open
      ? createElement(Viewer, {
          onOpened: !walked,
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
  const face = container.querySelector<HTMLElement>(".luke-picture-tile-face");
  if (tile === null || face === null) throw new Error("the tile is drawn");
  return {
    tile,
    face,
    card: () => document.querySelector<HTMLElement>(".luke-dialog"),
    walk: () => {
      const button = [...container.querySelectorAll("button")].find(
        (each) => each.textContent === "Walk",
      );
      act(() => button?.click());
    },
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

test("a picture opened from its tile grows from the tile's rect and shrinks back into it before it is put away", () => {
  const closed: string[] = [];
  const page = mountPage(closed);

  act(() => page.tile.click());

  const card = page.card();
  expect(card?.getAttribute("data-expanding")).toBe("true");
  expect(page.face.style.visibility).toBe("hidden");
  const [grow] = cardFlights();
  // The picture, 600 wide at the card's left and 40 below its top, lies over
  // the 120-wide tile at (40, 300): a fifth of its size, 8 further down.
  expect(grow?.frames[0]?.transform).toBe("translate(-160px, 192px) scale(0.2, 0.2)");
  expect(grow?.frames[0]?.clipPath).toMatch(/^inset\(40px 0px 0px 0px round /u);
  expect(grow?.frames[1]?.transform).toBe("none");

  page.escape();
  expect(closed).toEqual([]);
  const shrink = cardFlights()[1];
  expect(shrink?.frames.at(-1)?.transform).toBe(grow?.frames[0]?.transform);
  act(() => shrink?.animation.onfinish?.());

  expect(closed).toEqual(["closed"]);
  expect(page.card()).toBeNull();
  expect(page.face.style.visibility).toBe("");
});

test("a picture the viewer has yet to load flies from its tile once it has, the card unseen meanwhile", () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
  const closed: string[] = [];
  const page = mountPage(closed);

  act(() => page.tile.click());
  expect(cardFlights().map((each) => each.frames[0]?.opacity)).toEqual([0]);
  expect(page.face.style.visibility).toBe("");

  const picture = document.querySelector(".luke-dialog .luke-zoom-image");
  act(() => picture?.dispatchEvent(new Event("load")));

  expect(cardFlights()[1]?.frames[0]?.transform).toBe("translate(-160px, 192px) scale(0.2, 0.2)");
  expect(page.face.style.visibility).toBe("hidden");
});

test("a viewer walked off a picture still loading shows the card as every card is", () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
  const cancelled: Element[] = [];
  const animate = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = function (this: HTMLElement, ...args) {
    const animation = animate.apply(this, args);
    animation.cancel = () => cancelled.push(this);
    return animation;
  };
  const page = mountPage([]);
  act(() => page.tile.click());

  page.walk();

  expect(cancelled).toEqual([page.card()]);
  expect(page.card()?.hasAttribute("data-expanding")).toBe(false);
  expect(page.face.style.visibility).toBe("");
});

test("a picture that fails to load opens with the dialog's own entrance", () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
  const page = mountPage([]);

  act(() => page.tile.click());
  const picture = document.querySelector(".luke-dialog .luke-zoom-image");
  act(() => picture?.dispatchEvent(new Event("error")));

  expect(page.card()?.hasAttribute("data-expanding")).toBe(false);
  expect(cardFlights()).toHaveLength(1);
  expect(page.face.style.visibility).toBe("");
});

test("a viewer whose tile is gone by the close is put away at once", () => {
  const closed: string[] = [];
  const page = mountPage(closed);
  act(() => page.tile.click());

  page.withdraw();
  page.escape();

  expect(closed).toEqual(["closed"]);
  expect(cardFlights()).toHaveLength(1);
  expect(page.card()).toBeNull();
});

test("under reduced motion a picture opens and closes as every dialog does", () => {
  document.documentElement.style.setProperty("--luke-duration-fast", "0ms");
  const closed: string[] = [];
  const page = mountPage(closed);

  act(() => page.tile.click());
  expect(page.card()?.hasAttribute("data-expanding")).toBe(false);
  expect(page.face.style.visibility).toBe("");
  page.escape();

  expect(closed).toEqual(["closed"]);
  expect(played).toEqual([]);
});

test("a viewer opened from no tile keeps the dialog's own entrance and closes at once", () => {
  const closed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Viewer, { onClosed: () => closed.push("closed") })));

  const card = document.querySelector(".luke-dialog");
  expect(card?.hasAttribute("data-expanding")).toBe(false);
  act(() => card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  expect(closed).toEqual(["closed"]);
  expect(played).toEqual([]);
});
