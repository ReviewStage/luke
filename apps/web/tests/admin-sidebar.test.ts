import assert from "node:assert/strict";
import test from "node:test";
import {
  collapsedIconCenterOffset,
  labelStartOffset,
  SIDEBAR_TOGGLE_LABEL,
  SIDEBAR_WIDTH,
  sidebarRailWidth,
  sidebarToggleLabel,
} from "../src/admin-sidebar";

test("the rail folds between its two fixed widths and nothing between", () => {
  assert.equal(sidebarRailWidth(false), SIDEBAR_WIDTH.EXPANDED);
  assert.equal(sidebarRailWidth(true), SIDEBAR_WIDTH.COLLAPSED);
  assert.ok(SIDEBAR_WIDTH.COLLAPSED < SIDEBAR_WIDTH.EXPANDED);
});

test("the collapsed rail sits the icon on its centre without re-centring the row", () => {
  // The fold's smoothness rests on this: because the icon slot is the rail's
  // own width, the icon is centred and the label can stay in the flow and be
  // clipped rather than removed, so folding never restructures the row.
  assert.equal(collapsedIconCenterOffset(), 0);
});

test("a label begins at the collapsed edge, so the folded rail shows no fragment of it", () => {
  // The bug this guards: a label that begins inside the collapsed width leaves
  // its first characters peeking out of the folded rail.
  assert.ok(labelStartOffset() >= SIDEBAR_WIDTH.COLLAPSED);
});

test("the toggle names the act it offers, opposite to the state it is in", () => {
  assert.equal(sidebarToggleLabel(true), SIDEBAR_TOGGLE_LABEL.EXPAND);
  assert.equal(sidebarToggleLabel(false), SIDEBAR_TOGGLE_LABEL.COLLAPSE);
});
