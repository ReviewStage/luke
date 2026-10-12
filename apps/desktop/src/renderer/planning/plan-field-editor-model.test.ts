import assert from "node:assert/strict";
import { PLAN_EDIT_REFUSAL } from "@sidecar/hosted/plan-edit";
import { EMPTY_PLAN_CONTENT, type PlanContent } from "@sidecar/hosted/plan-template";
import { PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import {
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorOpened,
  editorRetried,
  editorSent,
  editorTookLukes,
  editorTyped,
  editTargetOfUnit,
  FIELD_EDITOR_STATE,
  type FieldEditor,
  pendingSave,
} from "./plan-field-editor-model";

const LUKES = "- Only an admin can add a member.";

const CONTENT: PlanContent = {
  fields: {
    ...EMPTY_PLAN_CONTENT.fields,
    context: LUKES,
    openQuestions: ["Who can withdraw an invite?"],
  },
  assumptions: [{ text: "Invites reuse memberships." }],
};

const CONTEXT = { field: PLAN_FIELD.CONTEXT } as const;

/** The save an editor would make now, failing the test where it has none. */
function saved(editor: FieldEditor) {
  const request = pendingSave(editor);
  assert.ok(request, "a save is pending");
  return request;
}

test("a unit is known as the field its heading names, and the title and old headings as none", () => {
  assert.deepEqual(editTargetOfUnit("## Context\n\n- Only admins."), {
    field: PLAN_FIELD.CONTEXT,
  });
  assert.deepEqual(editTargetOfUnit("## Approach\n\n_Unanswered_"), {
    field: PLAN_FIELD.APPROACH,
  });
  assert.deepEqual(editTargetOfUnit("## Plan of attack\n\n1. Schema."), {
    field: PLAN_FIELD.PLAN_OF_ATTACK,
  });
  assert.deepEqual(editTargetOfUnit("## Open questions\n\n- Who?"), {
    field: PLAN_FIELD.OPEN_QUESTIONS,
  });
  assert.equal(editTargetOfUnit("### Context\n\n- Only admins."), undefined);
  assert.equal(editTargetOfUnit("## Rules"), undefined);
  assert.equal(editTargetOfUnit("# Teammate invitations"), undefined);
});

test("an editor opens on the field as it stands, and has nothing to save until the words change", () => {
  const opened = editorOpened(CONTEXT, CONTENT);
  const goal = editorOpened({ field: PLAN_FIELD.GOAL }, CONTENT);

  assert.deepEqual(opened.draft, LUKES);
  assert.equal(pendingSave(opened), undefined);
  assert.equal(pendingSave(editorTyped(opened, `${LUKES}\n`)), undefined);
  assert.equal(pendingSave(editorTyped(goal, "  ")), undefined);
});

test("words cleared to nothing save the field as unanswered", () => {
  assert.deepEqual(saved(editorTyped(editorOpened(CONTEXT, CONTENT), "  \n ")), {
    field: PLAN_FIELD.CONTEXT,
    base: LUKES,
    value: null,
  });
});

test("the open questions and the assumptions open one to a line, and save each line as an item, markers dropped", () => {
  const questions = editorOpened({ field: PLAN_FIELD.OPEN_QUESTIONS }, CONTENT);
  const assumptions = editorOpened({ field: PLAN_FIELD.ASSUMPTIONS }, CONTENT);
  const typed = "- Who can withdraw an invite?\n\n2. How long is a link valid?";

  assert.deepEqual(questions.draft, "Who can withdraw an invite?");
  assert.deepEqual(saved(editorTyped(questions, typed)), {
    field: PLAN_FIELD.OPEN_QUESTIONS,
    base: ["Who can withdraw an invite?"],
    value: ["Who can withdraw an invite?", "How long is a link valid?"],
  });
  assert.deepEqual(saved(editorTyped(assumptions, "")), {
    field: PLAN_FIELD.ASSUMPTIONS,
    base: [{ text: "Invites reuse memberships." }],
    value: [],
  });
});

test("one save is out at a time; words typed meanwhile save after it lands, from what it saved", () => {
  const typed = editorTyped(editorOpened(CONTEXT, CONTENT), "- Only owners.");
  const out = editorSent(typed, saved(typed));
  const typedMore = editorTyped(out, "- Only owners, by email.");

  assert.equal(pendingSave(typedMore), undefined);
  assert.deepEqual(saved(editorAnswered(typedMore, { saved: true })), {
    field: PLAN_FIELD.CONTEXT,
    base: "- Only owners.",
    value: "- Only owners, by email.",
  });
});

test("a conflict holds the developer's words and saves nothing until they choose", () => {
  const typed = editorTyped(editorOpened(CONTEXT, CONTENT), "- Mine.");
  const conflicted = editorAnswered(editorSent(typed, saved(typed)), {
    conflict: { current: "- Luke's newer words." },
  });

  assert.deepEqual(conflicted.state, {
    kind: FIELD_EDITOR_STATE.CONFLICT,
    current: "- Luke's newer words.",
  });
  assert.deepEqual(conflicted.draft, "- Mine.");
  assert.equal(pendingSave(conflicted), undefined);
  assert.equal(editorCloses(editorCloseAsked(conflicted)), false);
});

test("keeping mine saves the developer's words over what the field holds now", () => {
  const typed = editorTyped(editorOpened(CONTEXT, CONTENT), "- Mine.");
  const kept = editorKeptMine(
    editorAnswered(editorSent(typed, saved(typed)), { conflict: { current: "- Luke's." } }),
  );

  assert.deepEqual(saved(kept), { field: PLAN_FIELD.CONTEXT, base: "- Luke's.", value: "- Mine." });
});

test("taking Luke's puts his words in the editor and closes it with nothing to save", () => {
  const opened = editorOpened({ field: PLAN_FIELD.OPEN_QUESTIONS }, CONTENT);
  const typed = editorTyped(opened, "Mine?");
  const took = editorTookLukes(
    editorAnswered(editorSent(typed, saved(typed)), {
      conflict: { current: ["Who can withdraw?", "Luke's question?"] },
    }),
  );

  assert.deepEqual(took.draft, "Who can withdraw?\nLuke's question?");
  assert.equal(pendingSave(took), undefined);
  assert.ok(editorCloses(took));
});

test("a failed save keeps the words, says why, and waits to be tried again or typed on", () => {
  const typed = editorTyped(editorOpened(CONTEXT, CONTENT), "- Mine.");
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
  assert.equal(saved(editorTyped(unanswered, "- Mine, again.")).value, "- Mine, again.");
});

test("an editor asked to close waits for its words to save, then closes", () => {
  const typed = editorCloseAsked(editorTyped(editorOpened(CONTEXT, CONTENT), "- Mine."));
  const out = editorSent(typed, saved(typed));

  assert.equal(editorCloses(typed), false);
  assert.equal(editorCloses(out), false);
  assert.ok(editorCloses(editorAnswered(out, { saved: true })));
  assert.ok(editorCloses(editorCloseAsked(editorOpened(CONTEXT, CONTENT))));
});

test("an item with line breaks opened and closed saves nothing, and keeps its breaks when another line changes", () => {
  const broken: PlanContent = {
    ...CONTENT,
    assumptions: [{ text: "Check access\nwhen revoked" }, { text: "Invites reuse memberships." }],
  };
  const opened = editorOpened({ field: PLAN_FIELD.ASSUMPTIONS }, broken);

  assert.equal(pendingSave(opened), undefined);
  assert.deepEqual(
    saved(editorTyped(opened, "Check access when revoked\nInvites reuse accounts.")).value,
    [{ text: "Check access\nwhen revoked" }, { text: "Invites reuse accounts." }],
  );
});
