import assert from "node:assert/strict";
import test from "node:test";
import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, PEEK_SIDE_GROWTH } from "@sidecar/core";
import { wingMarkCapacity } from "../src/renderer/notch-wings";

const peekSideWidth = CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH;
const panelSideWidth = (housingWidth: number) => (PANEL_WIDTH - housingWidth) / 2;

test("the peek's fixed side holds the four marks it always has", () => {
  assert.equal(wingMarkCapacity(peekSideWidth), 4);
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
