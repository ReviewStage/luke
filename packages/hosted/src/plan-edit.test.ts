import assert from "node:assert/strict";
import { test } from "vitest";
import { applyDeveloperEdit, type PlanEditOutcome } from "./plan-edit.js";
import { EMPTY_PLAN_CONTENT, type PlanContent, planBody } from "./plan-template.js";
import { PLAN_FIELD } from "./plan-wire.js";

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

const RULE_ONE = { statement: "Any member may invite by email.", examples: null };
const RULE_TWO = { statement: "Invites expire after 7 days.", examples: null };

/** A plan holding two rules, two questions, and an assumption, as the editor opened on them. */
const LISTED: PlanContent = {
  fields: {
    ...EMPTY_PLAN_CONTENT.fields,
    rules: [RULE_ONE, RULE_TWO],
    openQuestions: ["Who can withdraw an invite?", "How long is a link valid?"],
  },
  assumptions: [{ text: "Invites reuse memberships." }],
};

function appliedContent(outcome: PlanEditOutcome): PlanContent {
  if (!("applied" in outcome)) return assert.fail("expected the edit to apply");
  return outcome.applied;
}

test("an edit of one rule lands over a rule Luke added meanwhile, item by item", () => {
  const added = { statement: "An owner can revoke any invite.", examples: null };
  const now = { ...LISTED, fields: { ...LISTED.fields, rules: [RULE_ONE, RULE_TWO, added] } };
  const edited = { ...RULE_ONE, statement: "Any member may invite by email or link." };

  const outcome = applyDeveloperEdit(now, {
    field: PLAN_FIELD.RULES,
    base: [RULE_ONE, RULE_TWO],
    value: [edited, RULE_TWO],
  });

  assert.deepEqual(appliedContent(outcome).fields.rules, [edited, RULE_TWO, added]);
});

test("an edit of a rule Luke changed meanwhile conflicts with the rules as they stand", () => {
  const lukes = { ...RULE_ONE, statement: "Any admin may invite by email." };
  const now = { ...LISTED, fields: { ...LISTED.fields, rules: [lukes, RULE_TWO] } };

  const outcome = applyDeveloperEdit(now, {
    field: PLAN_FIELD.RULES,
    base: [RULE_ONE, RULE_TWO],
    value: [{ ...RULE_ONE, statement: "Any owner may invite by email." }, RULE_TWO],
  });

  assert.deepEqual(outcome, { conflict: { current: [lukes, RULE_TWO] } });
});

test("striking every rule leaves the rules unanswered", () => {
  const outcome = applyDeveloperEdit(LISTED, {
    field: PLAN_FIELD.RULES,
    base: [RULE_ONE, RULE_TWO],
    value: null,
  });

  assert.equal(appliedContent(outcome).fields.rules, null);
});

test("an open question struck while Luke added another keeps his and drops the struck one", () => {
  const now = {
    ...LISTED,
    fields: {
      ...LISTED.fields,
      openQuestions: [...LISTED.fields.openQuestions, "Can a guest invite?"],
    },
  };

  const outcome = applyDeveloperEdit(now, {
    field: PLAN_FIELD.OPEN_QUESTIONS,
    base: LISTED.fields.openQuestions,
    value: ["How long is a link valid?"],
  });

  assert.deepEqual(appliedContent(outcome).fields.openQuestions, [
    "How long is a link valid?",
    "Can a guest invite?",
  ]);
});

test("the assumptions are edited like any other list, with no confirming of them", () => {
  const outcome = applyDeveloperEdit(LISTED, {
    field: PLAN_FIELD.ASSUMPTIONS,
    base: LISTED.assumptions,
    value: [{ text: "Invites reuse memberships, never accounts." }],
  });

  assert.deepEqual(appliedContent(outcome).assumptions, [
    { text: "Invites reuse memberships, never accounts." },
  ]);
  assert.deepEqual(appliedContent(outcome).fields, LISTED.fields);
});
