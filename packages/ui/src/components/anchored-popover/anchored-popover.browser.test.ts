import { createElement } from "react";
import { expect, test } from "vitest";
import { mount } from "../../testing/browser.js";
import { AnchoredPopover, POPOVER_ALIGN, type PopoverAlign } from "./anchored-popover.js";

/**
 * anchored-popover.browser.test.ts -- a popover hangs a small gap above its
 * button from the edge its owner asked for, turns below only where the room
 * above cannot hold it, narrows and stays inside a room too small for it,
 * and is placed again as its room scrolls or resizes.
 */

/** The popover's height, as a menu of a few rows draws it. */
const MENU_HEIGHT = 200;

/** The anchor's height, a desktop control's. */
const ANCHOR_HEIGHT = 30;

/** A room of this size at the window's corner, holding a button `top` down and `left` in, `scroll` tall inside. */
interface Stage {
  width: number;
  height: number;
  top: number;
  left: number;
  scroll?: number;
  align?: PopoverAlign;
}

function staged(stage: Stage): React.ReactElement {
  const anchor = createElement(
    "div",
    {
      "data-testid": "anchor",
      style: {
        position: "absolute",
        top: stage.top,
        left: stage.left,
        width: 100,
        height: ANCHOR_HEIGHT,
      },
    },
    createElement("button", { type: "button", style: { width: "100%", height: "100%" } }, "Model"),
    createElement(AnchoredPopover, {
      align: stage.align ?? POPOVER_ALIGN.END,
      children: createElement("div", { style: { height: MENU_HEIGHT } }, "Menu"),
    }),
  );
  return createElement(
    "div",
    {
      "data-popover-room": "",
      "data-testid": "room",
      style: {
        position: "fixed",
        top: 0,
        left: 0,
        width: stage.width,
        height: stage.height,
        overflow: "auto",
      },
    },
    createElement(
      "div",
      { style: { position: "relative", height: stage.scroll ?? stage.height } },
      anchor,
    ),
  );
}

/**
 * Waits out two frames. Note that a test that scrolls waits first, because a
 * resize observer reports once on its own a frame after it is armed, and a
 * scroll made before that report would be measured by it rather than by
 * the scroll.
 */
async function frames(): Promise<void> {
  for (const _ of [1, 2]) await new Promise((resolve) => requestAnimationFrame(resolve));
}

/** The drawn boxes of the anchor and its layer, and the layer's side. */
function boxes(container: HTMLElement) {
  const anchor = container.querySelector('[data-testid="anchor"]');
  const layer = container.querySelector(".luke-anchored-popover");
  if (anchor === null || layer === null) throw new Error("the popover is drawn at its anchor");
  return {
    anchor: anchor.getBoundingClientRect(),
    layer: layer.getBoundingClientRect(),
    side: layer.getAttribute("data-side"),
  };
}

test("a popover hangs a small gap above its button, from the trailing edge or the leading one as asked", async () => {
  const end = await mount(staged({ width: 800, height: 600, top: 400, left: 400 }));
  const drawn = boxes(end.container);
  expect(drawn.side).toBe("above");
  expect(drawn.layer.bottom).toBe(drawn.anchor.top - 4);
  expect(drawn.layer.right).toBe(drawn.anchor.right);
  expect(drawn.layer.width).toBe(340);

  const start = await mount(
    staged({ width: 800, height: 600, top: 400, left: 100, align: POPOVER_ALIGN.START }),
  );
  const started = boxes(start.container);
  expect(started.layer.left).toBe(started.anchor.left);
});

test("a popover turns below its button only where the room above cannot hold it and below can", async () => {
  const { container } = await mount(staged({ width: 800, height: 600, top: 60, left: 400 }));
  const drawn = boxes(container);
  expect(drawn.side).toBe("below");
  expect(drawn.layer.top).toBe(drawn.anchor.bottom + 4);
});

test("a popover takes the other edge where the asked one runs past the room, and narrows in a room too small for it", async () => {
  const flipped = await mount(staged({ width: 800, height: 600, top: 400, left: 20 }));
  const drawn = boxes(flipped.container);
  expect(drawn.layer.left).toBe(drawn.anchor.left);

  const narrow = await mount(staged({ width: 240, height: 600, top: 400, left: 70 }));
  const squeezed = boxes(narrow.container);
  expect(squeezed.layer.width).toBe(240 - 2 * 8);
  expect(squeezed.layer.left).toBe(8);
});

test("a popover is placed again as its room scrolls its button toward the top, and as its room resizes", async () => {
  const { container } = await mount(
    staged({ width: 800, height: 400, top: 300, left: 400, scroll: 1200 }),
  );
  expect(boxes(container).side).toBe("above");

  const room = container.querySelector<HTMLElement>('[data-testid="room"]');
  if (room === null) throw new Error("the room is drawn");
  await frames();
  room.scrollTop = 260;
  await expect.poll(() => boxes(container).side).toBe("below");

  room.style.width = "300px";
  await expect.poll(() => boxes(container).layer.width).toBe(300 - 2 * 8);
});
