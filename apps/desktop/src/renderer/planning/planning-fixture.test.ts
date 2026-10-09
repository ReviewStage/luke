import assert from "node:assert/strict";
import { PLAN_WORK_STATE } from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { FIXTURE_PLANNING_CALL, fixturePlanningView, fixtureSidePanel } from "./planning-fixture";
import { DOCUMENT_REGION, documentRegion } from "./planning-model";
import { heardCalls, TRANSCRIPT_REGION, transcriptRegion } from "./transcript-model";
import { SIDE_PANEL_TAB } from "./use-side-panel";
import { workRowsOf } from "./work-model";

test("a fixture run under the planning profile draws a saved plan with its assumptions", () => {
  const view = fixturePlanningView({ fixtureMode: true, profile: RUN_PROFILE.PLANNING });
  assert.ok(view !== undefined);
  const region = documentRegion(view);
  assert.equal(region.kind, DOCUMENT_REGION.READY);
  if (region.kind !== DOCUMENT_REGION.READY) return;
  assert.ok(region.plan.document.assumptions.length > 0);
  assert.ok(view.plans.some((plan) => plan.id === region.plan.id));
});

test("a fixture run under another profile draws the synthetic list with no plan open", () => {
  for (const profile of [RUN_PROFILE.IDLE, RUN_PROFILE.SPEAKING]) {
    const view = fixturePlanningView({ fixtureMode: true, profile });
    assert.ok(view !== undefined);
    assert.equal(view.plans.length > 1, true);
    assert.equal(view.activePlanId, undefined);
    assert.equal(documentRegion(view).kind, DOCUMENT_REGION.NONE);
  }
});

test("a live run draws no synthetic plans", () => {
  assert.equal(
    fixturePlanningView({ fixtureMode: false, profile: RUN_PROFILE.PLANNING }),
    undefined,
  );
});

test("a fixture run under the planning-transcript profile opens its plan on the transcript, an earlier call above the live one", () => {
  const run = { fixtureMode: true, profile: RUN_PROFILE.PLANNING_TRANSCRIPT };
  const view = fixturePlanningView(run);
  assert.ok(view !== undefined);
  assert.equal(fixtureSidePanel(run)?.tab, SIDE_PANEL_TAB.TRANSCRIPT);
  const heard = heardCalls({
    held: [],
    voice: FIXTURE_PLANNING_CALL,
    planId: view.activePlanId,
    now: 0,
  });
  const region = transcriptRegion({ transcript: view.transcript, heard });
  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
  if (region.kind !== TRANSCRIPT_REGION.READY) return;
  assert.deepEqual(
    region.calls.map((call) => call.live),
    [false, true],
  );
});

test("a fixture run under the planning-work profile opens its plan on the Work tab mid-call, a finished turn above the one still working", () => {
  const run = { fixtureMode: true, profile: RUN_PROFILE.PLANNING_WORK };
  const view = fixturePlanningView(run);
  assert.ok(view !== undefined);
  assert.equal(fixtureSidePanel(run)?.tab, SIDE_PANEL_TAB.WORK);
  assert.equal(FIXTURE_PLANNING_CALL.callPlanId, view.activePlanId);
  assert.deepEqual(
    workRowsOf(view.work, true).map((turn) => turn.state),
    [PLAN_WORK_STATE.DONE, PLAN_WORK_STATE.RUNNING],
  );
});
