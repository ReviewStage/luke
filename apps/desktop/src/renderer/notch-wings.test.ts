import assert from "node:assert/strict";
import test from "node:test";
import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, PEEK_MIN_WIDTH } from "@sidecar/surface";
import {
  peekSideWidth,
  signInLabelFit,
  wingMarkCapacity,
  wingPileOffset,
  wingSlots,
} from "./notch-wings";
import type { ProviderTally } from "./session-model";

const panelSideWidth = (housingWidth: number) => (PANEL_WIDTH - housingWidth) / 2;

test("the peek's side beside the 14-inch housing holds four marks", () => {
  assert.equal(wingMarkCapacity(peekSideWidth(210)), 4);
});

test("the bubble's peek side is half the floored peek, so it holds more marks", () => {
  assert.equal(peekSideWidth(0), PEEK_MIN_WIDTH / 2);
  assert.ok(wingMarkCapacity(peekSideWidth(0)) > wingMarkCapacity(peekSideWidth(210)));
});

test("the panel's side holds what is left after the housing", () => {
  // The fixture display's 210px housing: (620 - 210) / 2 = 205px a side.
  assert.equal(wingMarkCapacity(panelSideWidth(210)), 8);
  // No housing at all — a display without a notch — leaves the most room.
  assert.equal(wingMarkCapacity(panelSideWidth(0)), 13);
});

test("a wider housing costs marks rather than clipping them", () => {
  assert.ok(wingMarkCapacity(panelSideWidth(300)) < wingMarkCapacity(panelSideWidth(210)));
});

test("a wing too narrow for the arithmetic still shows one mark", () => {
  assert.equal(wingMarkCapacity(0), 1);
});

// The capsule's own side, and the last pixels of it the resting mark keeps
// clear: the shape is turning its corner there, and the wing clips at the
// peek's bound rather than the capsule's, so nothing catches a mark drawn past
// it.
const RESTING_KEEP = 6;
const WING_INSET = 9;
const MARK_WIDTH = 14;
const MARK_AND_GAP = 21;

test("the one mark drawn at rest stays inside the capsule's side", () => {
  // The invariant the whole opacity-at-rest change hangs on: a resting mark
  // drawn past the capsule is drawn on the desktop, and no clip saves it.
  const right = WING_INSET + wingPileOffset(0) + MARK_WIDTH;
  assert.ok(right <= CAPSULE_SIDE_WIDTH - RESTING_KEEP);
});

test("every mark past the first rests exactly on it", () => {
  const seat = (index: number) => wingPileOffset(index) + MARK_AND_GAP * index;
  assert.equal(seat(0), 0);
  assert.equal(seat(1), 0);
  assert.equal(seat(4), 0);
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

test("more providers than slots truncates rather than counting the rest", () => {
  const slots = wingSlots(providers("a", "b", "c", "d", "e"), 4);
  assert.deepEqual(
    slots.map((slot) => slot.id),
    ["a", "b", "c", "d"],
  );
});

test("exactly filling the wing drops nothing", () => {
  const slots = wingSlots(providers("a", "b", "c", "d"), 4);
  assert.deepEqual(
    slots.map((slot) => slot.id),
    ["a", "b", "c", "d"],
  );
});

test("the sign-in label keeps its resting scale while the words fit", () => {
  assert.equal(signInLabelFit(30), 1);
});

test("a label wider than the capsule's side stands down to fit it", () => {
  const width = 42;
  const fit = signInLabelFit(width);
  assert.ok(fit < 1);
  assert.ok(fit * 0.88 * width <= CAPSULE_SIDE_WIDTH - 6 + 1e-9);
});

test("text not yet measured is not scaled", () => {
  assert.equal(signInLabelFit(0), 1);
});
