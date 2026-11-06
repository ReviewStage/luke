import assert from "node:assert/strict";
import { test } from "vitest";
import { POPOVER_ALIGN, POPOVER_SIDE, popoverPlace } from "./popover-place.js";

const ROOM = { left: 0, top: 0, right: 800, bottom: 600 };

function anchorAt(left: number, top: number) {
  return { left, top, right: left + 100, bottom: top + 30 };
}

test("a popover stands above its anchor, from the trailing edge or the leading one as asked", () => {
  const anchor = anchorAt(400, 400);
  assert.deepEqual(
    popoverPlace({ anchor, room: ROOM, width: 340, height: 200, align: POPOVER_ALIGN.END }),
    { side: POPOVER_SIDE.ABOVE, inset: 0, width: 340, room: 388 },
  );
  assert.deepEqual(
    popoverPlace({ anchor, room: ROOM, width: 340, height: 200, align: POPOVER_ALIGN.START }),
    { side: POPOVER_SIDE.ABOVE, inset: 0, width: 340, room: 388 },
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
  assert.equal(place(60, 200), POPOVER_SIDE.BELOW);
  assert.equal(place(212, 200), POPOVER_SIDE.ABOVE);
});

test("a popover neither side holds opens on the side with more room, and is told that side's height", () => {
  const place = (top: number) =>
    popoverPlace({
      anchor: anchorAt(400, top),
      room: ROOM,
      width: 340,
      height: 700,
      align: POPOVER_ALIGN.END,
    });
  assert.deepEqual([place(60).side, place(60).room], [POPOVER_SIDE.BELOW, 498]);
  assert.deepEqual([place(500).side, place(500).room], [POPOVER_SIDE.ABOVE, 488]);
});

test("a popover takes the other edge where the asked one runs past the room", () => {
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

test("a popover asked to hang below does so, turning above only where below cannot hold it and above can", () => {
  const place = (top: number, height: number) =>
    popoverPlace({
      anchor: anchorAt(400, top),
      room: ROOM,
      width: 340,
      height,
      align: POPOVER_ALIGN.START,
      side: POPOVER_SIDE.BELOW,
    }).side;
  assert.equal(place(200, 200), POPOVER_SIDE.BELOW);
  assert.equal(place(500, 200), POPOVER_SIDE.ABOVE);
});
