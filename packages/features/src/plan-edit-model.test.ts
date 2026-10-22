import assert from "node:assert/strict";
import { test } from "vitest";
import { PLAN_EDIT_REFUSAL } from "./plan-edit.js";
import {
  DOCUMENT_EDITOR_STATE,
  type DocumentEditor,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorOpened,
  editorRebased,
  editorRetried,
  editorSent,
  editorTyped,
  pendingSave,
} from "./plan-edit-model.js";
import { TASK_CALL_FAILURE } from "./tasks-view.js";

const TEXT = "# Context\n\nOnly an admin can add a member.\n";

/** The save an editor would make now, failing the test where it has none. */
function saved(editor: DocumentEditor) {
  const request = pendingSave(editor);
  assert.ok(request !== undefined, "a save is pending");
  return request;
}

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

test("a failed save keeps the words, says why, and waits to be tried again or typed on", () => {
  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`);
  const out = editorSent(typed, saved(typed));
  const unanswered = editorAnswered(out, { failure: TASK_CALL_FAILURE.UNANSWERED });
  const tooLong = editorAnswered(out, { failure: PLAN_EDIT_REFUSAL.TOO_LONG });

  assert.deepEqual(unanswered.state, {
    kind: DOCUMENT_EDITOR_STATE.FAILED,
    note: "Not saved: the service did not answer.",
  });
  assert.deepEqual(tooLong.state, {
    kind: DOCUMENT_EDITOR_STATE.FAILED,
    note: "Not saved: the plan is too long.",
  });
  assert.equal(pendingSave(unanswered), undefined);
  assert.equal(editorCloses(editorCloseAsked(unanswered)), false);
  assert.equal(saved(editorRetried(unanswered)).document.value, `${TEXT}Mine.\n`);
  assert.equal(
    saved(editorTyped(unanswered, `${TEXT}Mine, again.\n`)).document.value,
    `${TEXT}Mine, again.\n`,
  );
});

test("a text rebased on a save's merged answer saves only what the developer typed since", () => {
  const merged = `${TEXT}Luke's.\nMine.\n`;
  const rebased = editorRebased(editorOpened(TEXT), merged, `${merged}More.\n`);

  assert.deepEqual(pendingSave(rebased), { document: { base: merged, value: `${merged}More.\n` } });
});

test("an editor carrying comment anchors sends where they stand with its save, and keeps the last it reported", () => {
  const thread = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";
  const anchors = { anchors: [{ thread, from: 12, to: 20 }], carried: [thread] };
  const deleted = { anchors: [], carried: [thread] };

  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`, anchors);
  const typedOn = editorTyped(typed, `${TEXT}Mine and more.\n`);
  const cut = editorTyped(typedOn, "# Context\n", deleted);

  assert.deepEqual(saved(typed).comments, anchors);
  assert.deepEqual(saved(typedOn).comments, anchors);
  assert.deepEqual(saved(cut).comments, deleted);
  assert.equal(saved(editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`)).comments, undefined);
});
