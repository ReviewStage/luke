import assert from "node:assert/strict";
import { test } from "vitest";
import {
  APP_SETTING_SCHEMA,
  isZoomPercent,
  SETTING_SECTION,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  settingFromOption,
  settingRowsForPage,
  settingsScopeChanged,
  ZOOM_STEP,
  type ZoomPercent,
  type ZoomStep,
  zoomStepped,
} from "./index.js";
import { APP_SETTING_DEFAULTS } from "./schema-access.js";
import { settingsView, settingsVisibility } from "./testing.js";
import { type AppSettings, appSettingsView } from "./wire.js";

/** Every size one press after another reaches from `from`, the press that changed nothing included. */
function walk(from: ZoomPercent, step: ZoomStep, presses: number): ZoomPercent[] {
  const reached: ZoomPercent[] = [];
  let at = from;
  for (let press = 0; press < presses; press += 1) {
    at = zoomStepped(at, step);
    reached.push(at);
  }
  return reached;
}

test("⌘+ climbs Chrome's steps from actual size and holds at twice", () => {
  assert.deepEqual(walk(100, ZOOM_STEP.IN, 7), [110, 125, 150, 175, 200, 200, 200]);
});

test("⌘− descends Chrome's steps from actual size and holds at two thirds", () => {
  assert.deepEqual(walk(100, ZOOM_STEP.OUT, 6), [90, 80, 75, 67, 67, 67]);
});

test("a step out and a step back in land where they began", () => {
  assert.equal(zoomStepped(zoomStepped(125, ZOOM_STEP.OUT), ZOOM_STEP.IN), 125);
});

test("the store takes the offered sizes and nothing between or beyond them", () => {
  const { guard } = APP_SETTING_SCHEMA.zoom;
  assert.deepEqual(guard(150), { valid: true, value: 150 });
  assert.deepEqual(guard(undefined), { valid: true, value: undefined });
  for (const refused of [100.5, 33, 300, 0, -100, "100", "100%", true, null]) {
    assert.equal(isZoomPercent(refused), false, String(refused));
    assert.deepEqual(guard(refused), { valid: false, value: undefined }, String(refused));
  }
});

test("a zoom nobody chose is actual size, and a chosen one stays as chosen", () => {
  const { zoom: _default, ...stored } = APP_SETTING_DEFAULTS;
  const wire = (zoom: AppSettings["stored"]["zoom"]): AppSettings => ({
    stored: zoom === undefined ? stored : { ...stored, zoom },
    status: { voiceAvailable: false },
  });
  assert.equal(appSettingsView(wire(undefined)).zoom, 100);
  assert.equal(appSettingsView(wire(175)).zoom, 175);
});

test("the zoom follows the theme on the Appearance page as a pop-up of percentages", () => {
  const view = settingsVisibility({ settings: { zoom: 125 } });
  const rows = settingRowsForPage(SETTINGS_PAGE.APPEARANCE, SETTING_SECTION.MAIN, view);
  const zoom = rows[1];
  assert.equal(zoom?.field, APP_SETTING_SCHEMA.zoom.field);
  assert.deepEqual(zoom?.control, {
    value: "125",
    options: [
      { value: "67", label: "67%" },
      { value: "75", label: "75%" },
      { value: "80", label: "80%" },
      { value: "90", label: "90%" },
      { value: "100", label: "100%" },
      { value: "110", label: "110%" },
      { value: "125", label: "125%" },
      { value: "150", label: "150%" },
      { value: "175", label: "175%" },
      { value: "200", label: "200%" },
    ],
  });
  assert.equal(zoom?.changed, true);
  assert.equal(settingFromOption("zoom", "150", view), 150);
  assert.equal(settingFromOption("zoom", "300", view), undefined);
});

test("a zoom away from actual size is what the Appearance reset is offered for", () => {
  assert.equal(settingsScopeChanged(settingsView(), SETTINGS_RESET_SCOPE.APPEARANCE), false);
  const zoomed = settingsView({ zoom: 80 });
  assert.equal(settingsScopeChanged(zoomed, SETTINGS_RESET_SCOPE.APPEARANCE), true);
});
