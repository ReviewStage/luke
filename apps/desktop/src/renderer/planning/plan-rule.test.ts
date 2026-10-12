import assert from "node:assert/strict";
import { EMPTY_PLAN_FIELDS, planBody } from "@sidecar/hosted/plan-template";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { versionDiff } from "./plan-history-model";
import { chaseOpened, chaseRetargeted, chaseStepped, chaseView } from "./plan-reveal";
import { PlanUnitWords } from "./plan-rule";

const HEADER = { name: "Teammate invitations" } as const;

/** A newer document that adds no assumption. */
const NO_ADDED = { before: [], after: [] } as const;

function ruled(statements: readonly string[]): string {
  const rules = statements.map((statement) => ({ statement, examples: null }));
  return planBody(HEADER, { ...EMPTY_PLAN_FIELDS, rules });
}

function drawn(words: string, edit: Parameters<typeof PlanUnitWords>[0]["edit"]): string {
  return renderToStaticMarkup(
    createElement(PlanUnitWords, { words, className: "plan-unit", edit }),
  );
}

test("a rule being typed in draws its number, and the caret in its statement", () => {
  const before = ruled(["Only admins invite."]);
  const after = ruled(["Only admins invite.", "Links expire in a week."]);
  const aim = { reduced: false, lit: true };
  const typing = chaseStepped(chaseRetargeted(chaseOpened(before), after, NO_ADDED, aim), 550);
  const view = chaseView(typing, true).find((unit) => unit.words.startsWith("### Rule 2"));
  assert.ok(view?.edit !== undefined, "the new rule is being typed");

  const markup = drawn(view.words, view.edit);

  assert.match(markup, /<span class="plan-rule-number">2\.<\/span>/u);
  assert.match(
    markup,
    /<p>Links[^<]*<span class="markdown-caret" aria-hidden="true"><\/span><\/p>/u,
  );
  assert.doesNotMatch(markup, /Rule 2|No examples yet/u);
});

test("a rule renumbered in a version reads as its number now, not as a change", () => {
  const before = { body: ruled(["Only admins invite.", "Links expire."]), assumptions: [] };
  const after = { body: ruled(["Links expire."]), assumptions: [] };
  const unit = versionDiff(before, after).units.find((each) => each.words.includes("Links"));
  assert.ok(unit !== undefined && unit.marks.length > 0, "the renumbering is marked");

  const markup = drawn(unit.words, { marks: unit.marks });

  assert.match(
    markup,
    /<span class="plan-rule-number">1\.<\/span><div class="markdown plan-rule-body"><p>Links expire\.<\/p>/u,
  );
});
