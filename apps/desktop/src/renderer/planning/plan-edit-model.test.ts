import assert from "node:assert/strict";
import { PLAN_EDIT_REFUSAL } from "@sidecar/hosted/plan-edit";
import { PLAN_BOUNDS } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import {
  DOCUMENT_EDITOR_STATE,
  type DocumentEditor,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorOpened,
  editorRebased,
  editorRetried,
  editorSent,
  editorTookLukes,
  editorTyped,
  pendingSave,
} from "./plan-edit-model";

const TEXT = "# Context\n\nOnly an admin can add a member.\n";

/** The save an editor would make now, failing the test where it has none. */
function saved(editor: DocumentEditor) {
  const request = pendingSave(editor);
  assert.ok(request !== undefined, "a save is pending");
  return request;
}

test("an editor opens on the text and saves as the document's base and value, nothing while unchanged", () => {
  const opened = editorOpened(TEXT);
  const typed = editorTyped(opened, `${TEXT}\nMembers wait.\n`);

  assert.equal(opened.draft, TEXT);
  assert.equal(pendingSave(opened), undefined);
  assert.deepEqual(pendingSave(typed), {
    document: { base: TEXT, value: `${TEXT}\nMembers wait.\n` },
  });
});

test("one save is out at a time; words typed meanwhile save after it lands, from what it saved", () => {
  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`);
  const out = editorSent(typed, saved(typed));
  const typedMore = editorTyped(out, `${TEXT}Mine, by email.\n`);

  assert.equal(pendingSave(typedMore), undefined);
  assert.deepEqual(saved(editorAnswered(typedMore, { saved: true })), {
    document: { base: `${TEXT}Mine.\n`, value: `${TEXT}Mine, by email.\n` },
  });
});

test("a conflict holds the developer's words and saves nothing until they choose", () => {
  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`);
  const conflicted = editorAnswered(editorSent(typed, saved(typed)), {
    conflict: { current: `${TEXT}Luke's.\n` },
  });

  assert.deepEqual(conflicted.state, {
    kind: DOCUMENT_EDITOR_STATE.CONFLICT,
    current: `${TEXT}Luke's.\n`,
  });
  assert.equal(conflicted.draft, `${TEXT}Mine.\n`);
  assert.equal(pendingSave(conflicted), undefined);
  assert.equal(editorCloses(editorCloseAsked(conflicted)), false);
});

test("keeping mine saves the developer's words over Luke's text", () => {
  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`);
  const lukes = `${TEXT}Luke's.\n`;
  const kept = editorKeptMine(
    editorAnswered(editorSent(typed, saved(typed)), { conflict: { current: lukes } }),
  );

  assert.deepEqual(saved(kept), { document: { base: lukes, value: `${TEXT}Mine.\n` } });
});

test("taking Luke's puts his words in the editor and closes it with nothing to save", () => {
  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`);
  const lukes = `${TEXT}Luke's.\n`;
  const took = editorTookLukes(
    editorAnswered(editorSent(typed, saved(typed)), { conflict: { current: lukes } }),
  );

  assert.equal(took.draft, lukes);
  assert.equal(pendingSave(took), undefined);
  assert.ok(editorCloses(took));
});

test("a failed save keeps the words, says why, and waits to be tried again or typed on", () => {
  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`);
  const out = editorSent(typed, saved(typed));
  const unanswered = editorAnswered(out, { failure: PLAN_CALL_FAILURE.UNANSWERED });
  const tooLong = editorAnswered(out, { failure: PLAN_EDIT_REFUSAL.TOO_LONG });

  assert.deepEqual(unanswered.state, {
    kind: DOCUMENT_EDITOR_STATE.FAILED,
    note: "Not saved: the service did not answer.",
  });
  assert.deepEqual(tooLong.state, {
    kind: DOCUMENT_EDITOR_STATE.FAILED,
    note: "Not saved: the plan would be longer than a plan may be.",
  });
  assert.equal(pendingSave(unanswered), undefined);
  assert.equal(editorCloses(editorCloseAsked(unanswered)), false);
  assert.equal(saved(editorRetried(unanswered)).document.value, `${TEXT}Mine.\n`);
  assert.equal(
    saved(editorTyped(unanswered, `${TEXT}Mine, again.\n`)).document.value,
    `${TEXT}Mine, again.\n`,
  );
});

test("an editor asked to close waits for its words to save, then closes", () => {
  const typed = editorCloseAsked(editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`));
  const out = editorSent(typed, saved(typed));

  assert.equal(editorCloses(typed), false);
  assert.equal(editorCloses(out), false);
  assert.ok(editorCloses(editorAnswered(out, { saved: true })));
  assert.ok(editorCloses(editorCloseAsked(editorOpened(TEXT))));
});

test("a text past the bound a document may hold says so and is never sent; trimmed back, it saves", () => {
  const long = "x".repeat(PLAN_BOUNDS.MAX_BODY_CHARS + 1);
  const over = editorTyped(editorOpened(TEXT), long);

  assert.deepEqual(over.state, {
    kind: DOCUMENT_EDITOR_STATE.FAILED,
    note: "Not saved: the plan would be longer than a plan may be.",
  });
  assert.equal(pendingSave(editorRetried(over)), undefined);
  assert.deepEqual(pendingSave(editorTyped(over, `${TEXT}Short.\n`)), {
    document: { base: TEXT, value: `${TEXT}Short.\n` },
  });
});

test("a text grown past the bound while a save was out still says so once that save lands, and holds the editor open", () => {
  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`);
  const out = editorCloseAsked(editorSent(typed, saved(typed)));
  const over = editorTyped(out, "x".repeat(PLAN_BOUNDS.MAX_BODY_CHARS + 1));
  const landed = editorAnswered(over, { saved: true });

  assert.deepEqual(landed.state, {
    kind: DOCUMENT_EDITOR_STATE.FAILED,
    note: "Not saved: the plan would be longer than a plan may be.",
  });
  assert.equal(landed.base, `${TEXT}Mine.\n`);
  assert.equal(editorCloses(landed), false);
});

test("a text rebased on a save's merged answer saves only what the developer typed since", () => {
  const merged = `${TEXT}Luke's.\nMine.\n`;
  const rebased = editorRebased(editorOpened(TEXT), merged, `${merged}More.\n`);

  assert.deepEqual(pendingSave(rebased), { document: { base: merged, value: `${merged}More.\n` } });
});
