import assert from "node:assert/strict";
import test from "node:test";
import { PANEL_PRESENTATION } from "../src/renderer/panel-state";
import {
  askDisengageLeaves,
  capsuleKeepsTab,
  POINTER_LEAVE_FIRE,
  pointerEnterPeeks,
  pointerLeaveFires,
  pointerLeaveSchedules,
} from "../src/renderer/use-panel-presentation";

test("hovering the capsule peeks; any other shape is already answering", () => {
  assert.equal(pointerEnterPeeks(PANEL_PRESENTATION.CAPSULE), true);
  assert.equal(pointerEnterPeeks(PANEL_PRESENTATION.PEEK), false);
  assert.equal(pointerEnterPeeks(PANEL_PRESENTATION.PANEL), false);
});

test("the slot and the composer stay put when the pointer leaves", () => {
  assert.equal(
    pointerLeaveSchedules({ presentation: PANEL_PRESENTATION.SLOT, hold: false }),
    false,
    "someone fetching a key is in a browser; the pointer being away is the normal case",
  );
  assert.equal(
    pointerLeaveSchedules({ presentation: PANEL_PRESENTATION.FEEDBACK, hold: false }),
    false,
    "a note being written must not be discarded by the pointer wandering off",
  );
  assert.equal(
    pointerLeaveSchedules({ presentation: PANEL_PRESENTATION.CAPSULE, hold: false }),
    false,
  );
});

test("a key or ask being typed holds the panel against the pointer", () => {
  assert.equal(
    pointerLeaveSchedules({ presentation: PANEL_PRESENTATION.PANEL, hold: true }),
    false,
  );
  assert.equal(
    pointerLeaveSchedules({ presentation: PANEL_PRESENTATION.PANEL, hold: false }),
    true,
  );
  assert.equal(pointerLeaveSchedules({ presentation: PANEL_PRESENTATION.PEEK, hold: false }), true);
});

test("the leave timer peeks back to the capsule, or collapses a panel that is not held", () => {
  assert.equal(
    pointerLeaveFires({ presentation: PANEL_PRESENTATION.PEEK, hold: false }),
    POINTER_LEAVE_FIRE.CAPSULE,
  );
  assert.equal(
    pointerLeaveFires({ presentation: PANEL_PRESENTATION.PANEL, hold: false }),
    POINTER_LEAVE_FIRE.COLLAPSE,
  );
  assert.equal(
    pointerLeaveFires({ presentation: PANEL_PRESENTATION.PANEL, hold: true }),
    POINTER_LEAVE_FIRE.IGNORE,
    "an entry can begin inside the delay — pressing Connect does exactly that",
  );
  assert.equal(
    pointerLeaveFires({ presentation: PANEL_PRESENTATION.SLOT, hold: false }),
    POINTER_LEAVE_FIRE.IGNORE,
  );
});

test("a half-written key or note keeps the settings tab through a close", () => {
  assert.equal(capsuleKeepsTab(true), true);
  assert.equal(capsuleKeepsTab(false), false);
});

test("letting go of the ask field while the pointer is away releases the hold", () => {
  assert.equal(
    askDisengageLeaves({ wasEngaged: true, engaged: false, pointerInside: false }),
    true,
  );
  assert.equal(
    askDisengageLeaves({ wasEngaged: true, engaged: false, pointerInside: true }),
    false,
    "the pointer is still on the shape and will close by leaving",
  );
  assert.equal(
    askDisengageLeaves({ wasEngaged: false, engaged: true, pointerInside: false }),
    false,
  );
});
