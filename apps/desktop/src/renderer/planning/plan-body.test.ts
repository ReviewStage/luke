import assert from "node:assert/strict";
import { EMPTY_PLAN_FIELDS, planBody } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, type Plan } from "@sidecar/hosted/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { agoText, editedLine, PlanBody } from "./plan-body";
import { NO_ASSUMPTIONS_LINE } from "./planning-model";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
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
      "Context",
      "Goal",
      "Approach",
      "Interfaces",
      "Hard parts",
      "Not doing",
      "Testing",
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

test("a plan says who last wrote it above the document; one nobody has written says nothing", () => {
  const edited: Plan = {
    ...PLAN,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 1, duringCall: true },
  };

  const note = /<p class="plan-edit-note">Edited by Luke during your call · \d+[mhd] ago<\/p>/u;
  assert.match(bodyMarkup(edited), note);
  assert.doesNotMatch(bodyMarkup(PLAN), /plan-edit-note/u);
});

test("from a service before history, the newest save a coding agent made is the last edit", () => {
  const journaled: Plan = {
    ...PLAN,
    agentEdits: [
      { agentId: "a3b1c2d4-0000-4000-8000-000000000001", label: "GPT-6.1 Sol", at: 1 },
      { agentId: "a3b1c2d4-0000-4000-8000-000000000002", label: "Claude Opus 5.5", at: 2 },
    ],
  };

  assert.match(
    bodyMarkup(journaled),
    /<p class="plan-edit-note">Edited by Claude Opus 5\.5 · \d+[mhd] ago<\/p>/u,
  );
  assert.doesNotMatch(bodyMarkup(journaled), /GPT-6\.1 Sol/u);
});

test("the last edit names its writer in the developer's words, and says when it was on a call", () => {
  const now = 3 * 60 * 60_000;
  const at = now - 2 * 60 * 60_000;
  assert.equal(
    editedLine({ actor: PLAN_ACTOR.NOTETAKER, at, duringCall: true }, now),
    "Edited by Luke during your call · 2h ago",
  );
  assert.equal(
    editedLine({ actor: PLAN_ACTOR.NOTETAKER, at, duringCall: false }, now),
    "Edited by Luke · 2h ago",
  );
  assert.equal(
    editedLine({ actor: PLAN_ACTOR.DEVELOPER, at: now, duringCall: false }, now),
    "Edited by you · just now",
  );
  assert.equal(
    editedLine({ actor: PLAN_ACTOR.AGENT, label: "Command K board", at, duringCall: false }, now),
    "Edited by Command K board · 2h ago",
  );
  assert.equal(
    editedLine({ actor: PLAN_ACTOR.EARLIER, at, duringCall: false }, now),
    "Edited · 2h ago",
  );
});

test("how long ago a save was reads in the shortest words", () => {
  const now = 10 * 24 * 60 * 60_000;
  assert.equal(agoText(now - 20_000, now), "just now");
  assert.equal(agoText(now - 3 * 60_000, now), "3m ago");
  assert.equal(agoText(now - 2 * 60 * 60_000, now), "2h ago");
  assert.equal(agoText(now - 5 * 24 * 60 * 60_000, now), "5d ago");
});
