import assert from "node:assert/strict";
import { test } from "vitest";
import { applyDeveloperEdit, type PlanEditOutcome } from "./plan-edit.js";
import { EMPTY_PLAN_CONTENT, PLAN_FIELD, type PlanContent, planBody } from "./plan-template.js";

const HEADER = { name: "Teammate invitations" } as const;

const OPENED = "- Only an admin can add a member.\n- Admins are a bottleneck.";

/** A plan whose problem holds what the developer's editor opened on. */
const PLAN: PlanContent = {
  ...EMPTY_PLAN_CONTENT,
  fields: { ...EMPTY_PLAN_CONTENT.fields, goal: { problem: OPENED, outcome: null } },
};

/** The plan with its problem holding something else, as Luke left it meanwhile. */
function withProblem(problem: string | null): PlanContent {
  return { ...PLAN, fields: { ...PLAN.fields, goal: { problem, outcome: null } } };
}

/** The problem an outcome saved, failing the test on a conflict. */
function savedProblem(outcome: PlanEditOutcome): string | null {
  if (!("applied" in outcome)) return assert.fail("expected the edit to apply");
  return outcome.applied.fields.goal.problem;
}

test("an edit of a field still holding its base replaces it", () => {
  const value = "- Only an admin can add a member, by hand.\n- Admins are a bottleneck.";
  const outcome = applyDeveloperEdit(PLAN, { field: PLAN_FIELD.PROBLEM, base: OPENED, value });

  assert.equal(savedProblem(outcome), value);
});

test("clearing a field leaves it unanswered", () => {
  const outcome = applyDeveloperEdit(PLAN, {
    field: PLAN_FIELD.PROBLEM,
    base: OPENED,
    value: null,
  });

  assert.equal(savedProblem(outcome), null);
});

test("an edit that changes nothing leaves the content as it was", () => {
  const outcome = applyDeveloperEdit(PLAN, {
    field: PLAN_FIELD.PROBLEM,
    base: OPENED,
    value: OPENED,
  });

  assert.deepEqual(outcome, { applied: PLAN });
});

test("a point Luke added to the field meanwhile survives the developer's edit of another line", () => {
  const added = `${OPENED}\n- Invites go missing in spam.`;
  const outcome = applyDeveloperEdit(withProblem(added), {
    field: PLAN_FIELD.PROBLEM,
    base: OPENED,
    value: "- Only an owner can add a member.\n- Admins are a bottleneck.",
  });

  assert.equal(
    savedProblem(outcome),
    "- Only an owner can add a member.\n- Admins are a bottleneck.\n- Invites go missing in spam.",
  );
});

test("an edit of a field that was unanswered when opened lands over what Luke wrote since, where it adds lines", () => {
  const empty = withProblem(null);
  const outcome = applyDeveloperEdit(withProblem("- Luke's point."), {
    field: PLAN_FIELD.PROBLEM,
    base: null,
    value: "- The developer's point.",
  });

  assert.deepEqual(
    applyDeveloperEdit(empty, { field: PLAN_FIELD.PROBLEM, base: null, value: "- Mine." }),
    { applied: withProblem("- Mine.") },
  );
  assert.equal(savedProblem(outcome), "- The developer's point.\n- Luke's point.");
});

test("an edit of a line Luke changed meanwhile conflicts, answering the field as it stands and changing nothing", () => {
  const moved = "- Only an admin or owner can add a member.\n- Admins are a bottleneck.";
  const outcome = applyDeveloperEdit(withProblem(moved), {
    field: PLAN_FIELD.PROBLEM,
    base: OPENED,
    value: "- Only an owner can add a member.\n- Admins are a bottleneck.",
  });

  assert.deepEqual(outcome, { conflict: { current: moved } });
});

test("clearing a field Luke wrote in since it was opened conflicts rather than striking words the developer never read", () => {
  const added = `${OPENED}\n- Invites go missing in spam.`;
  const outcome = applyDeveloperEdit(withProblem(added), {
    field: PLAN_FIELD.PROBLEM,
    base: OPENED,
    value: null,
  });

  assert.deepEqual(outcome, { conflict: { current: added } });
});

test("a heading the developer types into a field stays inside it once formatted", () => {
  const outcome = applyDeveloperEdit(PLAN, {
    field: PLAN_FIELD.PROBLEM,
    base: OPENED,
    value: "## Scope\nNot a section.",
  });
  if (!("applied" in outcome)) return assert.fail("expected the edit to apply");

  const body = planBody(HEADER, outcome.applied.fields);
  assert.equal(body.split("\n").filter((line) => line === "## Scope").length, 1);
  assert.ok(body.includes("\\## Scope\nNot a section."));
});
