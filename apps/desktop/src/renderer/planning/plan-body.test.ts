import assert from "node:assert/strict";
import { PLAN_ACTOR, type Plan, type PlanLastEdit } from "@luke/features/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { PlanBody } from "./plan-body";

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

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

/** The plan's "Edited" line and its Goal section's byline, as `readerId` reads a plan last edited as `edit` says. */
function editedLines(edit: Omit<PlanLastEdit, "at">, readerId: string | undefined): string[] {
  const at = Date.now();
  const plan: Plan = {
    ...PLAN,
    lastEdit: { ...edit, at },
    sectionEdits: [{ section: "Goal", ...edit, at }],
  };
  const markup = renderToStaticMarkup(
    createElement(PlanBody, { plan, live: false, reader: { id: readerId, own: false } }),
  );
  return [...markup.matchAll(/class="plan-(?:edit-note|unit-byline)">([^<]*)</gu)].map(
    // The markup escapes an apostrophe, which a reader sees as one.
    (match) => (match[1] ?? "").replaceAll("&#x27;", "'"),
  );
}

test("two members each see the other's edits under the other's name, and only their own as you", () => {
  const byDean = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false, by: DEAN };
  const byCharles = { ...byDean, by: CHARLES };

  assert.deepEqual(editedLines(byCharles, DEAN.userId), [
    "Edited by Charles Pan · now",
    "Edited by Charles Pan · now",
  ]);
  assert.deepEqual(editedLines(byDean, CHARLES.userId), [
    "Edited by Dean Stratakos · now",
    "Edited by Dean Stratakos · now",
  ]);
  assert.deepEqual(editedLines(byDean, DEAN.userId), [
    "Edited by you · now",
    "Edited by you · now",
  ]);
});

test("Luke's notes on a teammate's call name whose call it was", () => {
  const onCharlesCall = { actor: PLAN_ACTOR.NOTETAKER, duringCall: true, by: CHARLES };

  assert.equal(
    editedLines(onCharlesCall, DEAN.userId)[0],
    "Edited by Luke during Charles Pan's call · now",
  );
  assert.equal(
    editedLines(onCharlesCall, CHARLES.userId)[0],
    "Edited by Luke during your call · now",
  );
});

test("an edit the service names no member for, or read without an account id, is never yours", () => {
  const unnamed = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false };

  assert.equal(editedLines(unnamed, DEAN.userId)[0], "Edited by someone · now");
  assert.equal(
    editedLines({ ...unnamed, by: DEAN }, undefined)[0],
    "Edited by Dean Stratakos · now",
  );
});
