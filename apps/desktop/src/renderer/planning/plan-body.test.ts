import assert from "node:assert/strict";
import { EMPTY_PLAN_FIELDS, planBody } from "@sidecar/hosted/plan-template";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { PlanBody } from "./plan-body";
import { NO_ASSUMPTIONS_LINE } from "./planning-model";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  document: {
    body: "# Teammate invitations\n\n## Goal\nInvite a teammate by email.",
    assumptions: [
      { text: "Members and admins can both invite." },
      { text: "An invite expires after 7 days." },
    ],
  },
};

function bodyMarkup(plan: Plan): string {
  return renderToStaticMarkup(createElement(PlanBody, { plan, live: false }));
}

test("the saved body is drawn as Markdown", () => {
  const markup = bodyMarkup(PLAN);

  assert.match(markup, /<p class="markdown-heading" data-level="2">Goal<\/p>/u);
  assert.match(markup, /Invite a teammate by email\./u);
});

test("each assumption is a list item holding its text and nothing to click", () => {
  const markup = bodyMarkup(PLAN);

  const rows = markup.match(/<li class="plan-assumption">[\s\S]*?<\/li>/gu) ?? [];
  assert.deepEqual(
    rows,
    PLAN.document.assumptions.map(({ text }) => `<li class="plan-assumption">${text}</li>`),
  );
  assert.doesNotMatch(markup, /type="checkbox"|Confirmed/u);
});

test("the document offers no way to write, confirm, or approve anything", () => {
  const markup = bodyMarkup(PLAN);

  assert.doesNotMatch(markup, /<textarea|contenteditable|type="text"|<button/u);
  assert.doesNotMatch(markup, /Approve|Version|History|Ready/u);
});

test("a new plan draws its whole template unanswered, and an assumptions section that says none is recorded", () => {
  const body = planBody(PLAN, EMPTY_PLAN_FIELDS);
  const markup = bodyMarkup({ ...PLAN, document: { body, assumptions: [] } });

  const sections = [
    ...markup.matchAll(/<p class="markdown-heading" data-level="2">([^<]*)<\/p>/gu),
  ];
  assert.deepEqual(
    sections.map((match) => match[1]),
    [
      "Goal",
      "Scope",
      "Rules",
      "Implementation",
      "Decisions",
      "Verification",
      "Left to the agent",
      "Open questions",
    ],
  );
  assert.match(markup, /<em>Unanswered<\/em>/u);
  assert.match(
    markup,
    new RegExp(
      `<h2 class="plan-assumptions-heading">Assumptions</h2><p class="plan-assumptions-none">${NO_ASSUMPTIONS_LINE}</p>`,
      "u",
    ),
  );
});
