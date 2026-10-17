import assert from "node:assert/strict";
import { test } from "vitest";
import { POPOVER_ALIGN, POPOVER_SIDE, popoverPlace } from "./popover-place.js";

/**
 * popover-place.test.ts -- a popover stands above its anchor unless only
 * below has room, at its owner's edge unless only the other keeps it inside,
 * else pushed back inside and narrowed to the room. The worked numbers use
 * the 4px gap off the anchor and the 8px margin off the room's edges.
 */

const ROOM = { left: 0, top: 0, right: 800, bottom: 600 };

/** A 100 by 30 button standing `left` in and `top` down. */
function anchorAt(left: number, top: number) {
  return { left, top, right: left + 100, bottom: top + 30 };
}

test("a popover stands above its anchor, from the trailing edge or the leading one as asked", () => {
  const anchor = anchorAt(400, 400);
  assert.deepEqual(
    popoverPlace({ anchor, room: ROOM, width: 340, height: 200, align: POPOVER_ALIGN.END }),
    { side: POPOVER_SIDE.ABOVE, inset: 0, width: 340 },
  );
  assert.deepEqual(
    popoverPlace({ anchor, room: ROOM, width: 340, height: 200, align: POPOVER_ALIGN.START }),
    { side: POPOVER_SIDE.ABOVE, inset: 0, width: 340 },
  );
});

test("a popover turns below only where the room above cannot hold it and below can", () => {
  const place = (top: number, height: number) =>
    popoverPlace({
      anchor: anchorAt(400, top),
      room: ROOM,
      width: 340,
      height,
      align: POPOVER_ALIGN.END,
    }).side;
  // 60 - 4 - 8 = 48 above, too short for 200; 600 - 90 - 12 = 498 below.
  assert.equal(place(60, 200), POPOVER_SIDE.BELOW);
  // 212 - 12 = 200 above holds a 200-tall popover exactly.
  assert.equal(place(212, 200), POPOVER_SIDE.ABOVE);
  // Neither side holds 700, so it keeps to above.
  assert.equal(place(60, 700), POPOVER_SIDE.ABOVE);
});

test("a scroll that lifts the anchor toward its room's top turns the popover below", () => {
  const scroller = { left: 0, top: 0, right: 800, bottom: 400 };
  const at = (top: number) =>
    popoverPlace({
      anchor: anchorAt(400, top),
      room: scroller,
      width: 340,
      height: 200,
      align: POPOVER_ALIGN.START,
    }).side;
  assert.equal(at(300), POPOVER_SIDE.ABOVE, "before the scroll");
  assert.equal(at(40), POPOVER_SIDE.BELOW, "after 260px of scroll");
});

test("a popover takes the other edge where the asked one runs past the room", () => {
  // From the trailing edge it would start at 120 - 340 = -220; from the leading edge at 20 it fits.
  const place = popoverPlace({
    anchor: anchorAt(20, 400),
    room: ROOM,
    width: 340,
    height: 200,
    align: POPOVER_ALIGN.END,
  });
  assert.equal(place.width, 340);
  assert.equal(place.inset, 100 - 340, "its trailing edge stands 240px past the anchor's");
});

test("a popover narrows to its room less both margins and is pushed back inside where neither edge fits", () => {
  const place = popoverPlace({
    anchor: anchorAt(70, 400),
    room: { left: 0, top: 0, right: 240, bottom: 600 },
    width: 340,
    height: 200,
    align: POPOVER_ALIGN.START,
  });
  assert.equal(place.width, 224, "240 less 8 each side");
  assert.equal(place.inset, 8 - 70, "its leading edge stands at the room's 8px margin");
});
