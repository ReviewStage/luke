import assert from "node:assert/strict";
import test from "node:test";
import { leavesPanelForCompact, PANEL_PRESENTATION } from "../src/renderer/panel-state";

test("only the panel standing down to a compact shape marks a collapse", () => {
  assert.equal(leavesPanelForCompact(PANEL_PRESENTATION.PANEL, PANEL_PRESENTATION.CAPSULE), true);
  assert.equal(leavesPanelForCompact(PANEL_PRESENTATION.PANEL, PANEL_PRESENTATION.PEEK), true);
});

test("standing down to the slot or the composer keeps the base surface timing", () => {
  assert.equal(leavesPanelForCompact(PANEL_PRESENTATION.PANEL, PANEL_PRESENTATION.SLOT), false);
  assert.equal(leavesPanelForCompact(PANEL_PRESENTATION.PANEL, PANEL_PRESENTATION.FEEDBACK), false);
});

test("moves between compact shapes are not a collapse, and neither is expanding", () => {
  assert.equal(leavesPanelForCompact(PANEL_PRESENTATION.CAPSULE, PANEL_PRESENTATION.PEEK), false);
  assert.equal(leavesPanelForCompact(PANEL_PRESENTATION.PEEK, PANEL_PRESENTATION.CAPSULE), false);
  assert.equal(leavesPanelForCompact(PANEL_PRESENTATION.CAPSULE, PANEL_PRESENTATION.PANEL), false);
  assert.equal(leavesPanelForCompact(PANEL_PRESENTATION.SLOT, PANEL_PRESENTATION.CAPSULE), false);
});
