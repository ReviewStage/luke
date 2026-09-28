import assert from "node:assert/strict";
import { test } from "vitest";
import { PANEL_TAB, panelTabForKey } from "./panel-tabs";

test("panel tabs wrap with horizontal arrows over Plans and Settings alone", () => {
  assert.equal(panelTabForKey(PANEL_TAB.PLANS, "ArrowRight"), PANEL_TAB.SETTINGS);
  assert.equal(panelTabForKey(PANEL_TAB.SETTINGS, "ArrowRight"), PANEL_TAB.PLANS);
  assert.equal(panelTabForKey(PANEL_TAB.SETTINGS, "ArrowLeft"), PANEL_TAB.PLANS);
  assert.equal(panelTabForKey(PANEL_TAB.PLANS, "ArrowLeft"), PANEL_TAB.SETTINGS);
});

test("panel tabs support Home and End and ignore unrelated keys", () => {
  assert.equal(panelTabForKey(PANEL_TAB.SETTINGS, "Home"), PANEL_TAB.PLANS);
  assert.equal(panelTabForKey(PANEL_TAB.PLANS, "End"), PANEL_TAB.SETTINGS);
  assert.equal(panelTabForKey(PANEL_TAB.PLANS, "Enter"), undefined);
});
