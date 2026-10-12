import assert from "node:assert/strict";
import { PLAN_ACTOR, type Plan } from "@sidecar/hosted/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { agoText, editedLine, PlanBody } from "./plan-body";

const PLAN: Plan = {
  ...DOCUMENT_PLAN,
  document: { body: "## Goal\nInvite a teammate by email.", assumptions: [] },
};

function bodyMarkup(plan: Plan): string {
  return renderToStaticMarkup(createElement(PlanBody, { plan, live: false }));
}

test("the saved body is drawn as Markdown", () => {
  const markup = bodyMarkup(PLAN);

  assert.match(markup, /<p class="markdown-heading" data-level="2">Goal<\/p>/u);
  assert.match(markup, /Invite a teammate by email\./u);
});

test("the document offers no way to write, confirm, or approve anything", () => {
  const markup = bodyMarkup(PLAN);

  assert.doesNotMatch(markup, /<textarea|contenteditable|type="text"|<button/u);
  assert.doesNotMatch(markup, /Approve|Version|History|Ready/u);
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

test("a plan draws its name as the title over its text, and no section after it, even from a service that sends assumptions", () => {
  const markup = bodyMarkup({
    ...DOCUMENT_PLAN,
    document: { ...DOCUMENT_PLAN.document, assumptions: [{ text: "Invites expire." }] },
  });

  assert.match(
    markup,
    /^<div class="plan-document-scroll"><div class="plan-body"><div class="markdown plan-title"><p class="markdown-heading" data-level="1">Teammate invitations<\/p><\/div><div class="markdown plan-unit"><p class="markdown-heading" data-level="1">Context<\/p>/u,
  );
  const headings = [
    ...markup.matchAll(/<p class="markdown-heading" data-level="(\d)">([^<]*)<\/p>/gu),
  ];
  assert.deepEqual(
    headings.map((match) => [match[1], match[2]]),
    [
      ["1", "Teammate invitations"],
      ["1", "Context"],
      ["2", "Goal"],
      ["2", "Approach"],
      ["2", "Assumptions"],
    ],
  );
  assert.match(markup, /## Not a section/u, "a heading inside a fence is drawn as code");
  assert.match(markup, /<li>Links are single use\.<\/li>/u);
  assert.doesNotMatch(markup, /Invites expire|None recorded/u);
});

test("an empty plan draws its title alone, with no editor, no section to add, and no placeholder, even with an edit door", () => {
  const markup = renderToStaticMarkup(
    createElement(PlanBody, {
      plan: { ...DOCUMENT_PLAN, document: { body: "", assumptions: [] } },
      live: false,
      onEdit: () => Promise.resolve({ saved: true } as const),
    }),
  );

  assert.doesNotMatch(markup, /<button|<textarea/u);
  assert.doesNotMatch(markup, /Unanswered|None recorded/u);
  assert.match(markup, /data-level="1">Teammate invitations</u);
});
