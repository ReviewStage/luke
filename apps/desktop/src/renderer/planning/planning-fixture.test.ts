import assert from "node:assert/strict";
import { test } from "vitest";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { planMarkdown } from "#shared/plan-markdown";
import { fixturePlanningView } from "./planning-fixture";
import { DOCUMENT_REGION, documentRegion } from "./planning-model";

test("a fixture run under the planning profile draws a saved plan with both kinds of assumption", () => {
  const view = fixturePlanningView({ fixtureMode: true, profile: RUN_PROFILE.PLANNING });
  assert.ok(view !== undefined);
  const region = documentRegion(view);
  assert.equal(region.kind, DOCUMENT_REGION.READY);
  if (region.kind !== DOCUMENT_REGION.READY) return;
  // The evidence frame has to show the checklist's two states, not one.
  const copied = planMarkdown(region.plan.document);
  assert.match(copied, /^- \[x\] /m);
  assert.match(copied, /^- \[ \] /m);
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
