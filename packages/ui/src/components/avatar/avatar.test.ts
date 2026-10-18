// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { AVATAR_SHAPE, Avatar } from "./avatar.js";

/**
 * avatar.test.ts -- the letter stands until the picture loads and comes back
 * where it fails; a picture that failed is asked for again once its address
 * is given back; a glyph stands where the letter would, for an app; a
 * picture the browser drew before the page took over is shown; and the disc
 * names its person to a reader once. The page's
 * answer to a picture is the boundary, so a test sends the load or the error
 * the browser would.
 */

const PICTURE = "https://pictures.example/ada.png";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

type AvatarProps = Parameters<typeof Avatar>[0];

/** A disc drawn into the page, and a way to draw it again with other props. */
interface Drawn {
  readonly container: HTMLElement;
  readonly redraw: (next: AvatarProps) => void;
}

function drawn(props: AvatarProps): Drawn {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const redraw = (next: AvatarProps): void => act(() => root.render(createElement(Avatar, next)));
  redraw(props);
  return { container, redraw };
}

/** The picture the disc asks for, if it asks for one. */
function picture(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector("img");
}

/** The browser answers the picture's request with `answer`. */
function answer(container: HTMLElement, answer: "load" | "error"): void {
  const asked = picture(container);
  assert.ok(asked, "no picture was asked for");
  act(() => {
    asked.dispatchEvent(new Event(answer));
  });
}

test("the letter stands until the picture loads, and goes once it has", () => {
  const { container } = drawn({ name: "ada lovelace", src: PICTURE });
  assert.equal(container.textContent, "A");
  assert.equal(picture(container)?.getAttribute("src"), PICTURE);
  answer(container, "load");
  assert.equal(container.textContent, "");
});

test("a picture that fails leaves the letter where it was and is not asked for again", () => {
  const { container, redraw } = drawn({ name: "Ada", src: PICTURE });
  answer(container, "error");
  assert.equal(container.textContent, "A");
  assert.equal(picture(container), null);
  redraw({ name: "Ada Lovelace", src: PICTURE });
  assert.equal(picture(container), null);
});

test("a picture that failed is asked for again once its address is taken away and given back", () => {
  const { container, redraw } = drawn({ name: "Ada", src: PICTURE });
  answer(container, "error");
  redraw({ name: "Ada" });
  redraw({ name: "Ada", src: PICTURE });
  assert.equal(picture(container)?.getAttribute("src"), PICTURE);
});

test("a name's first character is its letter, an emoji's whole", () => {
  const { container } = drawn({ name: "👩‍🚀 Sally" });
  assert.equal(container.textContent, "👩‍🚀");
});

test("the disc names its person to a reader, and a decorative one beside the name says nothing", () => {
  const { container } = drawn({ name: "Grace Hopper" });
  const disc = container.firstElementChild;
  assert.equal(disc?.getAttribute("role"), "img");
  assert.equal(disc?.getAttribute("aria-label"), "Grace Hopper");
  const beside = drawn({ name: "Ada Lovelace", decorative: true }).container.firstElementChild;
  assert.equal(beside?.getAttribute("aria-hidden"), "true");
  assert.equal(beside?.getAttribute("role"), null);
});

test("a name with no character to draw stands as the figure, said to nobody", () => {
  const { container } = drawn({ name: "  " });
  const disc = container.firstElementChild;
  assert.equal(container.textContent, "");
  assert.ok(disc?.querySelector("svg"));
  assert.equal(disc?.getAttribute("aria-hidden"), "true");
});

/** A glyph a caller hands the square, as an app's mark would be. */
const GLYPH = createElement("svg", { "data-glyph": "robot" });

test("an app's glyph stands where its letter would, until its picture loads and again where it fails", () => {
  const { container, redraw } = drawn({
    name: "Vercel",
    src: PICTURE,
    shape: AVATAR_SHAPE.SQUARE,
    glyph: GLYPH,
  });
  assert.equal(container.textContent, "");
  assert.ok(container.querySelector('[data-glyph="robot"]'));
  answer(container, "load");
  assert.equal(container.querySelector('[data-glyph="robot"]'), null);
  redraw({ name: "Vercel", src: `${PICTURE}?v=2`, shape: AVATAR_SHAPE.SQUARE, glyph: GLYPH });
  answer(container, "error");
  assert.equal(picture(container), null);
  assert.ok(container.querySelector('[data-glyph="robot"]'));
});

test("an app's square names it to a reader as a person's disc does", () => {
  const disc = drawn({ name: "Vercel", shape: AVATAR_SHAPE.SQUARE, glyph: GLYPH }).container
    .firstElementChild;
  assert.equal(disc?.getAttribute("role"), "img");
  assert.equal(disc?.getAttribute("aria-label"), "Vercel");
});

test("a picture the browser had drawn before the page took over is shown without a load of its own", () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(96);
  const { container } = drawn({ name: "Ada", src: PICTURE });
  assert.equal(container.textContent, "");
  assert.equal(picture(container)?.getAttribute("src"), PICTURE);
});
