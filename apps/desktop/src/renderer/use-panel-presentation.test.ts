import assert from "node:assert/strict";
import test from "node:test";
import { PANEL_PRESENTATION } from "./panel-state";
import {
  askDisengageLeaves,
  capsuleKeepsTab,
  POINTER_LEAVE_FIRE,
  pointerEnterPeeks,
  pointerLeaveFires,
  pointerLeaveSchedules,
  RECEDE_SETTLE_MS,
  recedeArms,
  recedeReleases,
} from "./use-panel-presentation";

test("hovering the capsule peeks; any other shape is already answering", () => {
  assert.equal(pointerEnterPeeks(PANEL_PRESENTATION.CAPSULE), true);
  assert.equal(pointerEnterPeeks(PANEL_PRESENTATION.PEEK), false);
  assert.equal(pointerEnterPeeks(PANEL_PRESENTATION.PANEL), false);
});

test("the slot and the composer stay put when the pointer leaves", () => {
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.SLOT,
      hold: false,
      receded: false,
      travelled: true,
    }),
    false,
    "someone fetching a key is in a browser; the pointer being away is the normal case",
  );
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.FEEDBACK,
      hold: false,
      receded: false,
      travelled: true,
    }),
    false,
    "a note being written must not be discarded by the pointer wandering off",
  );
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.CAPSULE,
      hold: false,
      receded: false,
      travelled: true,
    }),
    false,
  );
});

test("a key or ask being typed holds the panel against the pointer", () => {
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.PANEL,
      hold: true,
      receded: false,
      travelled: true,
    }),
    false,
  );
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.PANEL,
      hold: false,
      receded: false,
      travelled: true,
    }),
    true,
  );
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.PEEK,
      hold: false,
      receded: false,
      travelled: true,
    }),
    true,
  );
});

test("a leave at a point the pointer never moved from is the shape's own doing", () => {
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.PANEL,
      hold: false,
      receded: false,
      travelled: false,
    }),
    false,
    "the greeting expanding under a resting cursor must not collapse on the synthetic leave",
  );
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.PEEK,
      hold: false,
      receded: false,
      travelled: false,
    }),
    true,
    "only the panel is ever opened by the app itself under a pointer that did nothing",
  );
});

test("a shape that receded out from under the pointer does not close by leaving", () => {
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.PANEL,
      hold: false,
      receded: true,
      travelled: true,
    }),
    false,
    "a settings page opening shorter than the last shrinks the shape past a resting hand",
  );
  assert.equal(
    pointerLeaveSchedules({
      presentation: PANEL_PRESENTATION.PEEK,
      hold: false,
      receded: true,
      travelled: true,
    }),
    true,
    "the peek never follows the panel's content, so a mark there explains nothing",
  );
});

test("only a pointer actually on the panel can be left behind by a shrink", () => {
  assert.equal(recedeArms({ presentation: PANEL_PRESENTATION.PANEL, pointerInside: true }), true);
  assert.equal(
    recedeArms({ presentation: PANEL_PRESENTATION.PANEL, pointerInside: false }),
    false,
    "a shrink with the pointer already away has nobody to protect",
  );
  assert.equal(
    recedeArms({ presentation: PANEL_PRESENTATION.CAPSULE, pointerInside: true }),
    false,
    "the hidden panel's content can resize behind the capsule without moving the shape",
  );
});

test("the recede mark releases only once the spring has settled", () => {
  assert.equal(
    recedeReleases({ recededAt: 1_000, now: 1_000 + RECEDE_SETTLE_MS - 1 }),
    false,
    "mid-spring the vacated footprint still answers as content",
  );
  assert.equal(recedeReleases({ recededAt: 1_000, now: 1_000 + RECEDE_SETTLE_MS }), true);
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
