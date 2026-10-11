import assert from "node:assert/strict";
import { PLAN_EDIT_REFUSAL } from "@sidecar/hosted/plan-edit";
import { PLAN_FIELD } from "@sidecar/hosted/plan-template";
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
  FIELD_EDITOR_STATE,
  pendingAnswer,
  textFieldOfUnit,
} from "./plan-field-editor-model";

const LUKES = "- Only an admin can add a member.";

test("a unit is known as the text field its heading names; a section, a rule, and a list are none", () => {
  assert.equal(textFieldOfUnit("### Problem\n\n- Only admins."), PLAN_FIELD.PROBLEM);
  assert.equal(textFieldOfUnit("## Decisions\n\n_Unanswered_"), PLAN_FIELD.DECISIONS);
  assert.equal(textFieldOfUnit("### Left to the agent"), PLAN_FIELD.LEFT_TO_AGENT);
  assert.equal(textFieldOfUnit("## Goal"), undefined);
  assert.equal(textFieldOfUnit("### Rule 1: Any member may invite."), undefined);
  assert.equal(textFieldOfUnit("## Open questions\n\n- Who withdraws?"), undefined);
  assert.equal(textFieldOfUnit("# Teammate invitations"), undefined);
});

test("an editor opens on the field's answer, and has nothing to save until the words change", () => {
  const opened = editorOpened(PLAN_FIELD.PROBLEM, LUKES);
  const unanswered = editorOpened(PLAN_FIELD.OUTCOME, null);

  assert.equal(opened.text, LUKES);
  assert.equal(pendingAnswer(opened), undefined);
  assert.equal(unanswered.text, "");
  assert.equal(pendingAnswer(editorTyped(unanswered, "   ")), undefined);
  assert.equal(pendingAnswer(editorTyped(opened, `${LUKES}\n`)), undefined);
});

test("words cleared to nothing save the field as unanswered", () => {
  const cleared = editorTyped(editorOpened(PLAN_FIELD.PROBLEM, LUKES), "  \n ");

  assert.equal(pendingAnswer(cleared), null);
});

test("one save is out at a time; words typed meanwhile save after it lands, from what it saved", () => {
  const typed = editorTyped(editorOpened(PLAN_FIELD.PROBLEM, LUKES), "- Only owners.");
  const out = editorSent(typed, "- Only owners.");
  const typedMore = editorTyped(out, "- Only owners, by email.");

  assert.equal(pendingAnswer(typedMore), undefined);
  const landed = editorAnswered(typedMore, { saved: true });
  assert.equal(landed.base, "- Only owners.");
  assert.equal(pendingAnswer(landed), "- Only owners, by email.");
});

test("a conflict holds the developer's words and saves nothing until they choose", () => {
  const out = editorSent(
    editorTyped(editorOpened(PLAN_FIELD.PROBLEM, LUKES), "- Mine."),
    "- Mine.",
  );
  const conflicted = editorAnswered(out, { conflict: { current: "- Luke's newer words." } });

  assert.deepEqual(conflicted.state, {
    kind: FIELD_EDITOR_STATE.CONFLICT,
    current: "- Luke's newer words.",
  });
  assert.equal(conflicted.text, "- Mine.");
  assert.equal(pendingAnswer(conflicted), undefined);
  assert.equal(editorCloses(editorCloseAsked(conflicted)), false);
});

test("keeping mine saves the developer's words over what the field holds now", () => {
  const out = editorSent(
    editorTyped(editorOpened(PLAN_FIELD.PROBLEM, LUKES), "- Mine."),
    "- Mine.",
  );
  const kept = editorKeptMine(editorAnswered(out, { conflict: { current: "- Luke's." } }));

  assert.equal(kept.base, "- Luke's.");
  assert.equal(pendingAnswer(kept), "- Mine.");
});

test("taking Luke's puts his words in the editor and closes it with nothing to save", () => {
  const out = editorSent(
    editorTyped(editorOpened(PLAN_FIELD.PROBLEM, LUKES), "- Mine."),
    "- Mine.",
  );
  const took = editorTookLukes(editorAnswered(out, { conflict: { current: "- Luke's." } }));

  assert.equal(took.text, "- Luke's.");
  assert.equal(pendingAnswer(took), undefined);
  assert.ok(editorCloses(took));
});

test("a failed save keeps the words, says why, and waits to be tried again or typed on", () => {
  const out = editorSent(
    editorTyped(editorOpened(PLAN_FIELD.PROBLEM, LUKES), "- Mine."),
    "- Mine.",
  );
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
  assert.equal(unanswered.base, LUKES);
  assert.equal(pendingAnswer(unanswered), undefined);
  assert.equal(editorCloses(editorCloseAsked(unanswered)), false);
  assert.equal(pendingAnswer(editorRetried(unanswered)), "- Mine.");
  assert.equal(pendingAnswer(editorTyped(unanswered, "- Mine, again.")), "- Mine, again.");
});

test("an editor asked to close waits for its words to save, then closes", () => {
  const typed = editorCloseAsked(editorTyped(editorOpened(PLAN_FIELD.PROBLEM, LUKES), "- Mine."));
  const out = editorSent(typed, "- Mine.");

  assert.equal(editorCloses(typed), false);
  assert.equal(editorCloses(out), false);
  assert.ok(editorCloses(editorAnswered(out, { saved: true })));
  assert.ok(editorCloses(editorCloseAsked(editorOpened(PLAN_FIELD.PROBLEM, LUKES))));
});
