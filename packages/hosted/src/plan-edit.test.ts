import assert from "node:assert/strict";
import { test } from "vitest";
import { applyDeveloperEdit, type PlanEditOutcome } from "./plan-edit.js";
import { EMPTY_PLAN_CONTENT, type PlanContent, planBody } from "./plan-template.js";
import { PLAN_FIELD } from "./plan-wire.js";

const HEADER = { name: "Teammate invitations" } as const;

const OPENED = "- Only an admin can add a member.\n- Admins are a bottleneck.";

/** A plan whose context holds what the developer's editor opened on. */
const PLAN: PlanContent = {
  ...EMPTY_PLAN_CONTENT,
  fields: { ...EMPTY_PLAN_CONTENT.fields, context: OPENED },
};

/** The plan with its context holding something else, as Luke left it meanwhile. */
function withContext(context: string | null): PlanContent {
  return { ...PLAN, fields: { ...PLAN.fields, context } };
}

/** The context an outcome saved, failing the test on a conflict. */
function savedContext(outcome: PlanEditOutcome): string | null {
  if (!("applied" in outcome)) return assert.fail("expected the edit to apply");
  return outcome.applied.fields.context;
}

test("an edit of a field still holding its base replaces it", () => {
  const value = "- Only an admin can add a member, by hand.\n- Admins are a bottleneck.";
  const outcome = applyDeveloperEdit(PLAN, { field: PLAN_FIELD.CONTEXT, base: OPENED, value });

  assert.equal(savedContext(outcome), value);
});

test("clearing a field leaves it unanswered", () => {
  const outcome = applyDeveloperEdit(PLAN, {
    field: PLAN_FIELD.CONTEXT,
    base: OPENED,
    value: null,
  });

  assert.equal(savedContext(outcome), null);
});

test("an edit that changes nothing leaves the content as it was", () => {
  const outcome = applyDeveloperEdit(PLAN, {
    field: PLAN_FIELD.CONTEXT,
    base: OPENED,
    value: OPENED,
  });

  assert.deepEqual(outcome, { applied: PLAN });
});

test("a point Luke added to the field meanwhile survives the developer's edit of another line", () => {
  const added = `${OPENED}\n- Invites go missing in spam.`;
  const outcome = applyDeveloperEdit(withContext(added), {
    field: PLAN_FIELD.CONTEXT,
    base: OPENED,
    value: "- Only an owner can add a member.\n- Admins are a bottleneck.",
  });

  assert.equal(
    savedContext(outcome),
    "- Only an owner can add a member.\n- Admins are a bottleneck.\n- Invites go missing in spam.",
  );
});

test("an edit of a field that was unanswered when opened lands over what Luke wrote since, where it adds lines", () => {
  const empty = withContext(null);
  const outcome = applyDeveloperEdit(withContext("- Luke's point."), {
    field: PLAN_FIELD.CONTEXT,
    base: null,
    value: "- The developer's point.",
  });

  assert.deepEqual(
    applyDeveloperEdit(empty, { field: PLAN_FIELD.CONTEXT, base: null, value: "- Mine." }),
    { applied: withContext("- Mine.") },
  );
  assert.equal(savedContext(outcome), "- The developer's point.\n- Luke's point.");
});

test("an edit of a line Luke changed meanwhile conflicts, answering the field as it stands and changing nothing", () => {
  const moved = "- Only an admin or owner can add a member.\n- Admins are a bottleneck.";
  const outcome = applyDeveloperEdit(withContext(moved), {
    field: PLAN_FIELD.CONTEXT,
    base: OPENED,
    value: "- Only an owner can add a member.\n- Admins are a bottleneck.",
  });

  assert.deepEqual(outcome, { conflict: { current: moved } });
});

test("clearing a field Luke wrote in since it was opened conflicts rather than striking words the developer never read", () => {
  const added = `${OPENED}\n- Invites go missing in spam.`;
  const outcome = applyDeveloperEdit(withContext(added), {
    field: PLAN_FIELD.CONTEXT,
    base: OPENED,
    value: null,
  });

  assert.deepEqual(outcome, { conflict: { current: added } });
});

test("a heading the developer types into a field stays inside it once formatted", () => {
  const outcome = applyDeveloperEdit(PLAN, {
    field: PLAN_FIELD.CONTEXT,
    base: OPENED,
    value: "## Goal\nNot a section.",
  });
  if (!("applied" in outcome)) return assert.fail("expected the edit to apply");

  const body = planBody(HEADER, outcome.applied.fields);
  assert.equal(body.split("\n").filter((line) => line === "## Goal").length, 1);
  assert.ok(body.includes("\\## Goal\nNot a section."));
});

/** A plan holding two questions and an assumption, as the editor opened on them. */
const LISTED: PlanContent = {
  fields: {
    ...EMPTY_PLAN_CONTENT.fields,
    openQuestions: ["Who can withdraw an invite?", "How long is a link valid?"],
  },
  assumptions: [{ text: "Invites reuse memberships." }],
};

function appliedContent(outcome: PlanEditOutcome): PlanContent {
  if (!("applied" in outcome)) return assert.fail("expected the edit to apply");
  return outcome.applied;
}

test("an edit of an open question Luke changed meanwhile conflicts with the questions as they stand", () => {
  const lukes = ["Who can withdraw or resend an invite?", "How long is a link valid?"];
  const now = { ...LISTED, fields: { ...LISTED.fields, openQuestions: lukes } };

  const outcome = applyDeveloperEdit(now, {
    field: PLAN_FIELD.OPEN_QUESTIONS,
    base: LISTED.fields.openQuestions,
    value: ["Who can revoke an invite?", "How long is a link valid?"],
  });

  assert.deepEqual(outcome, { conflict: { current: lukes } });
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
