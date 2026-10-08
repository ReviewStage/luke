import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { DOCUMENT_REGION, PLAN_VIEW, PLANS_PAGE } from "../planning/planning-model";
import { DesktopPlans } from "./desktop-plans";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  openedAt: 3,
  document: { body: "# Teammate invitations", assumptions: [] },
};

function openPlanMarkup(shown: (typeof PLAN_VIEW)[keyof typeof PLAN_VIEW]): string {
  const plans = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    activePlanId: PLAN.id,
    region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
    planView: { shown, onChoose: () => undefined },
  });
  return renderToStaticMarkup(createElement(DesktopPlans, { plans }));
}

test("the open plan's toolbar offers its document and its whiteboard, and Board shows the whiteboard in the document's place", () => {
  const onDocument = openPlanMarkup(PLAN_VIEW.DOCUMENT);
  const onBoard = openPlanMarkup(PLAN_VIEW.BOARD);

  assert.match(
    onDocument,
    /class="desktop-toolbar-actions">.*>Document<\/button>.*>Board<\/button>/su,
  );
  assert.match(onDocument, /class="desktop-document" aria-label="Teammate invitations"/u);
  assert.doesNotMatch(onDocument, /plan-board/u);
  assert.match(onBoard, /class="desktop-document desktop-board"/u);
  assert.match(onBoard, /class="plan-board ph-no-capture"/u);
});
