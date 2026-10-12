import assert from "node:assert/strict";
import { PLAN_EDIT_REFUSAL } from "@sidecar/hosted/plan-edit";
import { EMPTY_PLAN_CONTENT, type PlanContent } from "@sidecar/hosted/plan-template";
import { PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import {
  EDIT_DRAFT,
  type EditDraft,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorOpened,
  editorRetried,
  editorRuleStruck,
  editorSent,
  editorTookLukes,
  editorTyped,
  editTargetOfUnit,
  FIELD_EDITOR_STATE,
  type FieldEditor,
  pendingSave,
  textFieldOfUnit,
} from "./plan-field-editor-model";

const LUKES = "- Only an admin can add a member.";

const RULE = {
  statement: "Any member may invite by email.",
  examples: [
    // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
    { given: "A member", when: "they invite", then: "an email goes out" }, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
  ],
};

const CONTENT: PlanContent = {
  fields: {
    ...EMPTY_PLAN_CONTENT.fields,
    goal: { problem: LUKES, outcome: null },
    rules: [RULE],
    openQuestions: ["Who can withdraw an invite?"],
  },
  assumptions: [{ text: "Invites reuse memberships." }],
};

const PROBLEM = { field: PLAN_FIELD.PROBLEM } as const;

function text(words: string): EditDraft {
  return { kind: EDIT_DRAFT.TEXT, text: words };
}

/** The save an editor would make now, failing the test where it has none. */
function saved(editor: FieldEditor) {
  const request = pendingSave(editor);
  assert.ok(request, "a save is pending");
  return request;
}

test("a unit is known as the field its heading names, a rule by its number, and the rules' heading as a new rule", () => {
  assert.equal(textFieldOfUnit("### Problem\n\n- Only admins."), PLAN_FIELD.PROBLEM);
  assert.deepEqual(editTargetOfUnit("## Decisions\n\n_Unanswered_", 1), {
    field: PLAN_FIELD.DECISIONS,
  });
  assert.deepEqual(editTargetOfUnit("### Rule 2: Invites expire.", 3), {
    field: PLAN_FIELD.RULES,
    rule: 1,
  });
  assert.deepEqual(editTargetOfUnit("## Rules", 3), { field: PLAN_FIELD.RULES, rule: 3 });
  assert.deepEqual(editTargetOfUnit("## Open questions\n\n- Who?", 0), {
    field: PLAN_FIELD.OPEN_QUESTIONS,
  });
  assert.equal(editTargetOfUnit("## Goal", 0), undefined);
  assert.equal(editTargetOfUnit("# Teammate invitations", 0), undefined);
});

test("an editor opens on the field as it stands, and has nothing to save until the words change", () => {
  const opened = editorOpened(PROBLEM, CONTENT);
  const outcome = editorOpened({ field: PLAN_FIELD.OUTCOME }, CONTENT);

  assert.deepEqual(opened.draft, text(LUKES));
  assert.equal(pendingSave(opened), undefined);
  assert.equal(pendingSave(editorTyped(opened, text(`${LUKES}\n`))), undefined);
  assert.equal(pendingSave(editorTyped(outcome, text("  "))), undefined);
});

test("words cleared to nothing save the field as unanswered", () => {
  assert.deepEqual(saved(editorTyped(editorOpened(PROBLEM, CONTENT), text("  \n "))), {
    field: PLAN_FIELD.PROBLEM,
    base: LUKES,
    value: null,
  });
});

test("the open questions and the assumptions open one to a line, and save each line as an item, markers dropped", () => {
  const questions = editorOpened({ field: PLAN_FIELD.OPEN_QUESTIONS }, CONTENT);
  const assumptions = editorOpened({ field: PLAN_FIELD.ASSUMPTIONS }, CONTENT);
  const typed = "- Who can withdraw an invite?\n\n2. How long is a link valid?";

  assert.deepEqual(questions.draft, text("Who can withdraw an invite?"));
  assert.deepEqual(saved(editorTyped(questions, text(typed))), {
    field: PLAN_FIELD.OPEN_QUESTIONS,
    base: ["Who can withdraw an invite?"],
    value: ["Who can withdraw an invite?", "How long is a link valid?"],
  });
  assert.deepEqual(saved(editorTyped(assumptions, text(""))), {
    field: PLAN_FIELD.ASSUMPTIONS,
    base: [{ text: "Invites reuse memberships." }],
    value: [],
  });
});

test("a rule opens as its statement and examples, and saves as the rules with that one changed", () => {
  const opened = editorOpened({ field: PLAN_FIELD.RULES, rule: 0 }, CONTENT);
  const changed = editorTyped(opened, {
    kind: EDIT_DRAFT.RULE,
    rule: {
      statement: " Any member may invite by email or link. ",
      examples: [
        // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
        { given: "A member", when: "they invite", then: "" }, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
        // biome-ignore lint/suspicious/noThenProperty: the same key, for the same reason.
        { given: " ", when: "", then: "" }, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      ],
    },
  });

  assert.equal(opened.draft.kind, EDIT_DRAFT.RULE);
  assert.deepEqual(saved(changed), {
    field: PLAN_FIELD.RULES,
    base: [RULE],
    value: [
      {
        statement: "Any member may invite by email or link.",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
        examples: [{ given: "A member", when: "they invite", then: null }], // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      },
    ],
  });
});

test("a new rule is added after the rules standing; a struck rule is saved as the rules without it", () => {
  const added = editorTyped(editorOpened({ field: PLAN_FIELD.RULES, rule: 1 }, CONTENT), {
    kind: EDIT_DRAFT.RULE,
    rule: { statement: "Invites expire after 7 days.", examples: [] },
  });
  const struck = editorRuleStruck(editorOpened({ field: PLAN_FIELD.RULES, rule: 0 }, CONTENT));

  assert.deepEqual(saved(added).value, [
    RULE,
    { statement: "Invites expire after 7 days.", examples: null },
  ]);
  assert.equal(saved(struck).value, null);
  assert.ok(struck.closing);
});

test("one save is out at a time; words typed meanwhile save after it lands, from what it saved", () => {
  const typed = editorTyped(editorOpened(PROBLEM, CONTENT), text("- Only owners."));
  const out = editorSent(typed, saved(typed));
  const typedMore = editorTyped(out, text("- Only owners, by email."));

  assert.equal(pendingSave(typedMore), undefined);
  assert.deepEqual(saved(editorAnswered(typedMore, { saved: true })), {
    field: PLAN_FIELD.PROBLEM,
    base: "- Only owners.",
    value: "- Only owners, by email.",
  });
});

test("a conflict holds the developer's words and saves nothing until they choose", () => {
  const typed = editorTyped(editorOpened(PROBLEM, CONTENT), text("- Mine."));
  const conflicted = editorAnswered(editorSent(typed, saved(typed)), {
    conflict: { current: "- Luke's newer words." },
  });

  assert.deepEqual(conflicted.state, {
    kind: FIELD_EDITOR_STATE.CONFLICT,
    current: "- Luke's newer words.",
  });
  assert.deepEqual(conflicted.draft, text("- Mine."));
  assert.equal(pendingSave(conflicted), undefined);
  assert.equal(editorCloses(editorCloseAsked(conflicted)), false);
});

test("keeping mine saves the developer's words over what the field holds now", () => {
  const typed = editorTyped(editorOpened(PROBLEM, CONTENT), text("- Mine."));
  const kept = editorKeptMine(
    editorAnswered(editorSent(typed, saved(typed)), { conflict: { current: "- Luke's." } }),
  );

  assert.deepEqual(saved(kept), { field: PLAN_FIELD.PROBLEM, base: "- Luke's.", value: "- Mine." });
});

test("taking Luke's puts his words in the editor and closes it with nothing to save", () => {
  const opened = editorOpened({ field: PLAN_FIELD.OPEN_QUESTIONS }, CONTENT);
  const typed = editorTyped(opened, text("Mine?"));
  const took = editorTookLukes(
    editorAnswered(editorSent(typed, saved(typed)), {
      conflict: { current: ["Who can withdraw?", "Luke's question?"] },
    }),
  );

  assert.deepEqual(took.draft, text("Who can withdraw?\nLuke's question?"));
  assert.equal(pendingSave(took), undefined);
  assert.ok(editorCloses(took));
});

test("a failed save keeps the words, says why, and waits to be tried again or typed on", () => {
  const typed = editorTyped(editorOpened(PROBLEM, CONTENT), text("- Mine."));
  const out = editorSent(typed, saved(typed));
  const unanswered = editorAnswered(out, { failure: PLAN_CALL_FAILURE.UNANSWERED });
  const tooLong = editorAnswered(out, { failure: PLAN_EDIT_REFUSAL.TOO_LONG });

  assert.deepEqual(unanswered.state, {
    kind: FIELD_EDITOR_STATE.FAILED,
    note: "Not saved: the service did not answer.",
  });
  assert.deepEqual(tooLong.state, {
    kind: FIELD_EDITOR_STATE.FAILED,
    note: "Not saved: the plan would be longer than a plan may be.",
  });
  assert.equal(pendingSave(unanswered), undefined);
  assert.equal(editorCloses(editorCloseAsked(unanswered)), false);
  assert.equal(saved(editorRetried(unanswered)).value, "- Mine.");
  assert.equal(saved(editorTyped(unanswered, text("- Mine, again."))).value, "- Mine, again.");
});

test("an editor asked to close waits for its words to save, then closes", () => {
  const typed = editorCloseAsked(editorTyped(editorOpened(PROBLEM, CONTENT), text("- Mine.")));
  const out = editorSent(typed, saved(typed));

  assert.equal(editorCloses(typed), false);
  assert.equal(editorCloses(out), false);
  assert.ok(editorCloses(editorAnswered(out, { saved: true })));
  assert.ok(editorCloses(editorCloseAsked(editorOpened(PROBLEM, CONTENT))));
});

test("an item with line breaks opened and closed saves nothing, and keeps its breaks when another line changes", () => {
  const broken: PlanContent = {
    ...CONTENT,
    assumptions: [{ text: "Check access\nwhen revoked" }, { text: "Invites reuse memberships." }],
  };
  const opened = editorOpened({ field: PLAN_FIELD.ASSUMPTIONS }, broken);

  assert.equal(pendingSave(opened), undefined);
  assert.deepEqual(
    saved(editorTyped(opened, text("Check access when revoked\nInvites reuse accounts."))).value,
    [{ text: "Check access\nwhen revoked" }, { text: "Invites reuse accounts." }],
  );
});

test("keeping mine on a rule that moved while Luke struck one before it saves it where it now stands", () => {
  const first = { statement: "Admins approve invites.", examples: null };
  const content = { ...CONTENT, fields: { ...CONTENT.fields, rules: [first, RULE] } };
  const edited = { statement: "Any member may invite by email or link.", examples: [] };
  const typed = editorTyped(editorOpened({ field: PLAN_FIELD.RULES, rule: 1 }, content), {
    kind: EDIT_DRAFT.RULE,
    rule: edited,
  });
  const conflicted = editorAnswered(editorSent(typed, saved(typed)), {
    conflict: { current: [RULE] },
  });

  assert.deepEqual(saved(editorKeptMine(conflicted)), {
    field: PLAN_FIELD.RULES,
    base: [RULE],
    value: [{ statement: edited.statement, examples: null }],
  });
});
