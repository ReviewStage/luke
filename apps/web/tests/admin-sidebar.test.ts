import assert from "node:assert/strict";
import test from "node:test";
import {
  collapsedIconCenterOffset,
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

test("the collapsed rail keeps the icon within a pixel of centre without re-centring the row", () => {
  // The fold's smoothness rests on this: because the icon is already centred
  // by the panel's inset, the label can stay in the flow and be clipped rather
  // than removed, so folding never restructures the row and flickers.
  assert.ok(Math.abs(collapsedIconCenterOffset()) <= 1);
});

test("the toggle names the act it offers, opposite to the state it is in", () => {
  assert.equal(sidebarToggleLabel(true), SIDEBAR_TOGGLE_LABEL.EXPAND);
  assert.equal(sidebarToggleLabel(false), SIDEBAR_TOGGLE_LABEL.COLLAPSE);
});
