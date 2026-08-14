import assert from "node:assert/strict";
import test from "node:test";
import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, PEEK_SIDE_GROWTH } from "@sidecar/core";
import { OVERFLOW_SLOT_ID, wingMarkCapacity, wingSlots } from "../src/renderer/notch-wings";
import type { ProviderTally } from "../src/renderer/session-model";

const peekSideWidth = CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH;
const panelSideWidth = (housingWidth: number) => (PANEL_WIDTH - housingWidth) / 2;

test("the peek's fixed side holds three marks now they start at the panel's inset", () => {
  assert.equal(wingMarkCapacity(peekSideWidth), 3);
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
