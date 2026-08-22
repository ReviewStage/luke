import assert from "node:assert/strict";
import test from "node:test";
import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, PEEK_MIN_WIDTH } from "@sidecar/surface";
import {
  countBadgeFit,
  OVERFLOW_SLOT_ID,
  peekSideWidth,
  wingMarkCapacity,
  wingSlots,
} from "./notch-wings";
import { PANEL_PRESENTATION } from "./panel-state";
import type { ProviderTally } from "./session-model";

const panelSideWidth = (housingWidth: number) => (PANEL_WIDTH - housingWidth) / 2;

test("the peek's side beside the 14-inch housing holds three marks", () => {
  assert.equal(wingMarkCapacity(peekSideWidth(210)), 3);
});

test("the bubble's peek side is half the floored peek, so it holds more marks", () => {
  assert.equal(peekSideWidth(0), PEEK_MIN_WIDTH / 2);
  assert.ok(wingMarkCapacity(peekSideWidth(0)) > wingMarkCapacity(peekSideWidth(210)));
});

test("the panel's side holds what is left after the housing", () => {
  // The fixture display's 210px housing: (620 - 210) / 2 = 205px a side.
  assert.equal(wingMarkCapacity(panelSideWidth(210)), 7);
  // No housing at all — a display without a notch — leaves the most room.
  assert.equal(wingMarkCapacity(panelSideWidth(0)), 12);
});

test("a wider housing costs marks rather than clipping them", () => {
  assert.ok(wingMarkCapacity(panelSideWidth(300)) < wingMarkCapacity(panelSideWidth(210)));
});

test("a wing too narrow for the arithmetic still shows one mark", () => {
  assert.equal(wingMarkCapacity(0), 1);
});

const providers = (...ids: string[]): ProviderTally[] =>
  ids.map((providerId) => ({ providerId, provider: providerId, total: 1, attention: 0 }));

test("providers that fit are one slot each, named by their own id", () => {
  const slots = wingSlots(providers("codex", "jules"), 4);
  assert.deepEqual(
    slots.map((slot) => slot.id),
    ["codex", "jules"],
  );
});

test("more providers than slots ends the strip with the count of the rest", () => {
  const slots = wingSlots(providers("a", "b", "c", "d", "e"), 4);
  assert.deepEqual(
    slots.map((slot) => slot.id),
    ["a", "b", "c", OVERFLOW_SLOT_ID],
  );
  const overflow = slots[3];
  assert.ok(overflow !== undefined && !("provider" in overflow));
  // The count names its own number: the two that lost the arithmetic, plus the
  // one whose slot the count itself took.
  assert.equal(overflow.unshown, 2);
});

test("the count keeps one id however many it stands for, so it glides rather than re-arriving", () => {
  const [grown] = wingSlots(providers("a", "b", "c", "d", "e", "f"), 4).slice(-1);
  const [shrunk] = wingSlots(providers("a", "b", "c", "d", "e"), 4).slice(-1);
  assert.ok(grown !== undefined && shrunk !== undefined);
  assert.equal(grown.id, shrunk.id);
});

test("exactly filling the wing needs no count", () => {
  const slots = wingSlots(providers("a", "b", "c", "d"), 4);
  assert.deepEqual(
    slots.map((slot) => slot.id),
    ["a", "b", "c", "d"],
  );
});

// The badge's room in the arithmetic below: the capsule's 36px side minus the
// wing's 9px inset and the 2px kept off the shape's edge, and the peek's 124px
// side minus the same.
const capsuleRoom = CAPSULE_SIDE_WIDTH - 11;
const peekRoom = peekSideWidth(210) - 11;

test("the sign-in label starts at the housing and keeps clear of the strip's corner", () => {
  // Flush to the housing, the label spends no inset and keeps more from the
  // outer corner, so the same words render larger than a numeral's margins
  // would allow — and still inside the capsule's side.
  const width = 42;
  const label = countBadgeFit(PANEL_PRESENTATION.CAPSULE, 180, width, 0, true);
  const count = countBadgeFit(PANEL_PRESENTATION.CAPSULE, 180, width, 0);
  assert.ok(label > count);
  assert.ok(label * 0.88 * width <= 36 - 6);
});

test("a count that fits keeps its resting scale", () => {
  // Two tabular digits: about 19 layout pixels, 17 once the 0.88 draws them.
  assert.equal(countBadgeFit(PANEL_PRESENTATION.CAPSULE, 210, 19, 0), 1);
});

test("a number wider than the capsule's side stands down to fit it", () => {
  // Five digits: about 47 layout pixels against the capsule's 25 of room.
  const fit = countBadgeFit(PANEL_PRESENTATION.CAPSULE, 210, 47, 0);
  assert.ok(fit < 1);
  assert.ok(0.88 * fit * 47 <= capsuleRoom + 1e-9);
});

test("the capsule ignores the caption it never draws", () => {
  assert.equal(
    countBadgeFit(PANEL_PRESENTATION.CAPSULE, 210, 19, 400),
    countBadgeFit(PANEL_PRESENTATION.CAPSULE, 210, 19, 0),
  );
});

test("the peek fits the number and its caption together", () => {
  // A three-digit count beside "121 need you": each fits the peek alone, and
  // together they outgrow it.
  const fit = countBadgeFit(PANEL_PRESENTATION.PEEK, 210, 29, 100);
  assert.ok(fit < 1);
  assert.ok(0.88 * fit * (29 + 9 + 100) <= peekRoom + 1e-9);
});

test("the bubble's wider peek side keeps the same text at its resting scale", () => {
  assert.equal(countBadgeFit(PANEL_PRESENTATION.PEEK, 0, 29, 100), 1);
});

test("the panel's wider side stands the same text down less than the peek's", () => {
  const peek = countBadgeFit(PANEL_PRESENTATION.PEEK, 210, 38, 160);
  const panel = countBadgeFit(PANEL_PRESENTATION.PANEL, 210, 38, 160);
  assert.ok(peek < panel);
});

test("the slot keeps the capsule's quiet wing, so it keeps the capsule's fit", () => {
  assert.equal(
    countBadgeFit(PANEL_PRESENTATION.SLOT, 210, 47, 0),
    countBadgeFit(PANEL_PRESENTATION.CAPSULE, 210, 47, 0),
  );
});

test("text not yet measured is not scaled", () => {
  assert.equal(countBadgeFit(PANEL_PRESENTATION.CAPSULE, 210, 0, 0), 1);
});

test("wing mark provider slots map to valid session filters", () => {
  const slots = wingSlots(providers("claude", "codex", "cursor"), 3);
  for (const slot of slots) {
    if ("provider" in slot) {
      assert.ok(["claude", "codex", "cursor"].includes(slot.provider.providerId));
    }
  }
});
