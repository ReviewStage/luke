import assert from "node:assert/strict";
import test from "node:test";
import { PANEL_TAB, panelTabForKey } from "./panel-tabs";

test("panel tabs wrap with horizontal arrows", () => {
  assert.equal(panelTabForKey(PANEL_TAB.SESSIONS, "ArrowRight"), PANEL_TAB.HISTORY);
  assert.equal(panelTabForKey(PANEL_TAB.HISTORY, "ArrowRight"), PANEL_TAB.SETTINGS);
  assert.equal(panelTabForKey(PANEL_TAB.SETTINGS, "ArrowLeft"), PANEL_TAB.HISTORY);
  assert.equal(panelTabForKey(PANEL_TAB.SESSIONS, "ArrowLeft"), PANEL_TAB.SETTINGS);
});

test("panel tabs support Home and End and ignore unrelated keys", () => {
  assert.equal(panelTabForKey(PANEL_TAB.SETTINGS, "Home"), PANEL_TAB.SESSIONS);
  assert.equal(panelTabForKey(PANEL_TAB.SESSIONS, "End"), PANEL_TAB.SETTINGS);
  assert.equal(panelTabForKey(PANEL_TAB.SESSIONS, "Enter"), undefined);
});
