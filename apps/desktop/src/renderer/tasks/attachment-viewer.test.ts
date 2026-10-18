// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { FileChip } from "@luke/features/attachment-model";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { relayout } from "@luke/panel/testing/resize-observer";
import type { ImageView } from "@luke/ui/image-zoom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { AttachmentViewer } from "./attachment-viewer";

/**
 * attachment-viewer.test.ts -- a picture opened over the window zooms as
 * Preview's does: a pinch zooms it, a press zooms it in and back out rather
 * than closing the viewer, a drag moves it without counting as a press, the
 * bare zoom keys and the header's buttons step it, the zoom belongs to the
 * picture rather than its place among the files, a resized frame holds its
 * edges again, and a mouse counting its wheel in lines zooms as one counting
 * pixels does. jsdom lays nothing out, so each picture is
 * given the 800 by 400 its frame of 800 by 500 would fit a 2400 by 1200
 * screenshot to.
 */

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** A screenshot of its own, told apart from the others by its address alone. */
function shot(name: string): FileChip {
  return { name, mediaType: "image/png", url: `data:image/png;base64,${PIXEL}#${name}` };
}

const FIRST = shot("first.png");
const SECOND = shot("second.png");

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

beforeEach(() => {
  fakeAppBridge({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
});

/** `element`'s layout as the window would draw it. */
function laidOut<Laid extends Element>(element: Laid, sizes: Partial<Laid>): void {
  for (const [name, value] of Object.entries(sizes)) {
    Object.defineProperty(element, name, { configurable: true, value });
  }
}

/** What the owner of an open viewer holds: the files it hands in, the place shown, and whether it was closed. */
interface ViewerState {
  files: readonly FileChip[];
  at: number;
  closed: boolean;
}

/** The viewer open on the two screenshots, at `at`, and the ways to reach the picture shown. */
function opened() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const state: ViewerState = { files: [FIRST, SECOND], at: 0, closed: false };
  const draw = () =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(AttachmentViewer, {
            files: state.files,
            at: state.at,
            onAt: (at: number) => {
              state.at = at;
              draw();
            },
            onClose: () => {
              state.closed = true;
            },
          }),
        ),
      ),
    );
  draw();
  const picture = () => {
    const image =
      document.querySelector<HTMLImageElement>(".attachment-viewer-image") ??
      assert.fail("the viewer draws the picture");
    const frame = image.parentElement ?? assert.fail("the picture stands in its frame");
    laidOut(frame, {
      clientWidth: 800,
      clientHeight: 500,
      getBoundingClientRect: () => ({
        ...{ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500 },
        toJSON: () => undefined,
      }),
    });
    laidOut(image, {
      offsetWidth: 800,
      offsetHeight: 400,
      naturalWidth: 2400,
      naturalHeight: 1200,
      setPointerCapture: () => undefined,
    });
    return image;
  };
  const card = () =>
    document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("the viewer is open");
  const fire = (target: Element, event: Event) => act(() => target.dispatchEvent(event));
  const pointer = (type: string, x: number, y: number, buttons: number) =>
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons });
  const key = (key: string) =>
    fire(card(), new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const press = (label: string) => {
    const button =
      card().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
      assert.fail(`the header offers ${label}`);
    act(() => button.click());
  };
  /** The files and the place shown handed in anew, as the place opening the viewer does when a picture lands. */
  const show = (files: readonly FileChip[], at: number) => {
    state.files = files;
    state.at = at;
    draw();
  };
  return { state, picture, fire, pointer, key, press, show };
}

/** How far the picture is drawn zoomed and moved, read off its transform. */
function drawn(image: HTMLImageElement): ImageView {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/u.exec(
    image.style.transform,
  );
  assert.ok(match, `a transform is drawn: ${image.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

test("a pinch on the picture zooms it about the fingers, and one the other way fits it again", () => {
  const viewer = opened();
  const image = viewer.picture();
  assert.equal(drawn(image).scale, 1, "it opens fitted");
  const pinch = (deltaY: number) =>
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY,
      clientX: 600,
      clientY: 250,
    });
  const apart = pinch(-30);
  viewer.fire(image, apart);
  assert.ok(drawn(image).scale > 1, "a pinch apart zooms in");
  assert.ok(drawn(image).x < 0, "toward the point under the fingers, right of centre");
  assert.ok(apart.defaultPrevented, "the window itself is not zoomed by it");
  for (let each = 0; each < 5; each += 1) viewer.fire(image, pinch(40));
  assert.equal(drawn(image).scale, 1, "a pinch together fits it again");
});

test("a press zooms a fitted picture to its own pixels and a second fits it again, the viewer open throughout", () => {
  const viewer = opened();
  const image = viewer.picture();
  viewer.fire(image, viewer.pointer("pointerdown", 400, 250, 1));
  viewer.fire(image, viewer.pointer("click", 400, 250, 0));
  assert.equal(drawn(image).scale, 3, "a 2400-pixel picture drawn 800 wide is zoomed three times");
  assert.equal(image.dataset.zoom, "zoomed");
  viewer.fire(image, viewer.pointer("pointerdown", 400, 250, 1));
  viewer.fire(image, viewer.pointer("click", 400, 250, 0));
  assert.equal(drawn(image).scale, 1);
  assert.equal(viewer.state.closed, false, "a press on the picture no longer closes the viewer");
});

test("a zoomed picture is moved by a drag, and the press the drag ends on leaves it zoomed", () => {
  const viewer = opened();
  const image = viewer.picture();
  viewer.key("=");
  const before = drawn(image);
  assert.ok(before.scale > 1);
  viewer.fire(image, viewer.pointer("pointerdown", 400, 250, 1));
  viewer.fire(image, viewer.pointer("pointermove", 380, 240, 1));
  viewer.fire(image, viewer.pointer("pointermove", 350, 230, 1));
  viewer.fire(image, viewer.pointer("pointerup", 350, 230, 0));
  viewer.fire(image, viewer.pointer("click", 350, 230, 0));
  const after = drawn(image);
  assert.equal(after.scale, before.scale, "the drag is no press");
  assert.equal(after.x, before.x - 50);
  assert.equal(after.y, before.y - 20);
});

test("a two-finger scroll moves a zoomed picture and leaves a fitted one where it is", () => {
  const viewer = opened();
  const image = viewer.picture();
  const scroll = () =>
    new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 30, deltaY: 10 });
  viewer.fire(image, scroll());
  assert.deepEqual(drawn(image), { scale: 1, x: 0, y: 0 });
  viewer.press("Zoom in");
  viewer.fire(image, scroll());
  assert.deepEqual(drawn(image), { scale: 1.5, x: -30, y: -10 });
});

test("the zoom keys and buttons step the picture, 0 fits it, and the next file opens fitted", () => {
  const viewer = opened();
  const image = viewer.picture();
  viewer.key("=");
  viewer.key("+");
  assert.equal(drawn(image).scale, 2.25);
  viewer.press("Zoom out");
  assert.equal(drawn(image).scale, 1.5);
  viewer.key("0");
  assert.equal(drawn(image).scale, 1);
  viewer.key("=");
  viewer.key("ArrowRight");
  assert.equal(viewer.state.at, 1, "the arrows still walk the files");
  assert.equal(drawn(viewer.picture()).scale, 1, "the next file opens fitted");
});

test("the zoom stays with the picture: moved along the files it keeps it, and another in its place opens fitted", () => {
  const viewer = opened();
  viewer.show([SECOND], 0);
  viewer.picture();
  viewer.key("=");
  viewer.show([FIRST, SECOND], 1);
  assert.equal(
    drawn(viewer.picture()).scale,
    1.5,
    "an earlier picture landing keeps the one shown zoomed",
  );
  viewer.show([FIRST, SECOND], 0);
  assert.equal(drawn(viewer.picture()).scale, 1, "another picture shown in its place opens fitted");
  viewer.show([FIRST, { ...FIRST, name: "copy.png" }], 0);
  viewer.picture();
  viewer.key("=");
  viewer.key("ArrowRight");
  assert.equal(
    drawn(viewer.picture()).scale,
    1,
    "a copy of the same bytes under its own name opens fitted",
  );
});

test("a frame grown past the zoomed picture centres it again", () => {
  const viewer = opened();
  const image = viewer.picture();
  viewer.key("=");
  viewer.fire(image, new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: -500 }));
  assert.equal(drawn(image).x, 200, "1200 wide in an 800 frame moves at most 200 each way");
  const frame = image.parentElement ?? assert.fail("the picture stands in its frame");
  laidOut(frame, { clientWidth: 1600 });
  act(() => relayout());
  assert.equal(drawn(image).x, 0, "1200 wide in a 1600 frame stands centred");
});

test("a mouse counting its wheel in lines zooms by about as much as one counting pixels", () => {
  const viewer = opened();
  const image = viewer.picture();
  const notch = (deltaY: number, deltaMode: number) =>
    new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY, deltaMode });
  viewer.fire(image, notch(-100, WheelEvent.DOM_DELTA_PIXEL));
  const byPixels = drawn(image).scale;
  viewer.key("0");
  viewer.fire(image, notch(-3, WheelEvent.DOM_DELTA_LINE));
  assert.equal(drawn(image).scale, byPixels);
});

test("a wheel counting pages moves a zoomed picture by the frame's own width across and height down", () => {
  const viewer = opened();
  const image = viewer.picture();
  for (const _ of [1, 2, 3]) viewer.key("=");
  const page = { bubbles: true, cancelable: true, deltaMode: WheelEvent.DOM_DELTA_PAGE };
  viewer.fire(image, new WheelEvent("wheel", { ...page, deltaX: -1 }));
  assert.equal(drawn(image).x, 800, "a page across is the frame's 800 wide");
  viewer.fire(image, new WheelEvent("wheel", { ...page, deltaY: -0.5 }));
  assert.equal(drawn(image).y, 250, "half a page down is half the frame's 500 tall");
});

test("the zoom buttons name the bare keys that do the same", () => {
  opened();
  const named = (label: string) =>
    document.querySelector(`button[aria-label="${label}"]`)?.getAttribute("aria-keyshortcuts");
  assert.equal(named("Zoom in"), "=");
  assert.equal(named("Zoom out"), "-");
});
