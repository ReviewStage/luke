import assert from "node:assert/strict";
import { test } from "vitest";
import { applyDocumentEdit, PLAN_EDIT_REFUSAL } from "./plan-edit.js";
import {
  DOCUMENT_EDITOR_STATE,
  type DocumentEditor,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorLeft,
  editorOpened,
  editorRebased,
  editorRetried,
  editorSent,
  editorTyped,
  leavingSave,
  pendingSave,
} from "./plan-edit-model.js";
import { TASK_BOUNDS } from "./task-wire.js";
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

test("an editor left tries a failed save once more, sends nothing over a conflict, and keeps whatever the service does not hold", () => {
  const typed = editorTyped(editorOpened(TEXT), `${TEXT}Mine.\n`);
  const out = editorSent(typed, saved(typed));
  const failed = editorAnswered(out, { failure: TASK_CALL_FAILURE.UNANSWERED });
  const conflicted = editorAnswered(out, { conflict: { current: `${TEXT}Luke's.\n` } });

  assert.deepEqual(leavingSave(failed), { document: { base: TEXT, value: `${TEXT}Mine.\n` } });
  assert.equal(leavingSave(conflicted), undefined);
  assert.equal(editorLeft(conflicted)?.draft, `${TEXT}Mine.\n`);
  assert.equal(editorLeft(failed)?.draft, `${TEXT}Mine.\n`);
  assert.equal(editorLeft(editorAnswered(out, { saved: true })), undefined);
});

const SECTIONS = [
  "# Context",
  "",
  "Only an admin can add a member.",
  "",
  "# Steps",
  "",
  "Send the invite.",
  "",
].join("\n");

/** An editor whose save of `mine` met `theirs`, the text another writer saved from the same base meanwhile. */
function conflictedOver(mine: string, theirs: string): DocumentEditor {
  const typed = editorTyped(editorOpened(SECTIONS), mine);
  return editorAnswered(editorSent(typed, saved(typed)), { conflict: { current: theirs } });
}

/** The text the service holds once it takes the editor's next save over `current`. */
function storedAfter(editor: DocumentEditor, current: string): string {
  const outcome = applyDocumentEdit(current, saved(editor));
  assert.ok("applied" in outcome, "the save lands");
  return outcome.applied;
}

test("Keep mine over a writer who changed another section saves both changes", () => {
  const mine = SECTIONS.replace("add a member.", "add a member, by email.");
  const theirs = SECTIONS.replace("Send the invite.", "Send the invite.\nWait for the reply.");

  const kept = editorKeptMine(conflictedOver(mine, theirs));

  assert.equal(
    storedAfter(kept, theirs),
    SECTIONS.replace("add a member.", "add a member, by email.").replace(
      "Send the invite.",
      "Send the invite.\nWait for the reply.",
    ),
  );
});

test("Keep mine where both writers changed the same line saves mine there and theirs elsewhere", () => {
  const mine = SECTIONS.replace("Only an admin", "Only an owner");
  const theirs = SECTIONS.replace("Only an admin", "Any member").replace(
    "Send the invite.",
    "Send the invite today.",
  );

  const kept = editorKeptMine(conflictedOver(mine, theirs));

  assert.equal(
    storedAfter(kept, theirs),
    SECTIONS.replace("Only an admin", "Only an owner").replace(
      "Send the invite.",
      "Send the invite today.",
    ),
  );
});

test("Keep mine where both writers added a line at the same place keeps both lines, once where they match", () => {
  const theirs = `${SECTIONS}Luke's point.\n`;

  const both = editorKeptMine(conflictedOver(`${SECTIONS}My point.\n`, theirs));
  const same = editorKeptMine(conflictedOver(theirs, theirs));

  assert.equal(storedAfter(both, theirs), `${SECTIONS}Luke's point.\nMy point.\n`);
  assert.equal(pendingSave(same), undefined);
});

test("Keep mine sends no comment anchors where the other writer's lines moved the words, and keeps them where they did not", () => {
  const thread = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";
  const anchors = { anchors: [{ thread, from: 13, to: 33 }], carried: [thread] };
  const mine = SECTIONS.replace("add a member.", "add a member, by email.");
  const theirs = SECTIONS.replace("# Context", "# Who can join");
  const typed = editorTyped(editorOpened(SECTIONS), mine, anchors);
  const out = editorSent(typed, saved(typed));

  const moved = editorKeptMine(editorAnswered(out, { conflict: { current: theirs } }));
  const unmoved = editorKeptMine(editorAnswered(out, { conflict: { current: SECTIONS } }));

  assert.equal(saved(moved).comments, undefined);
  assert.deepEqual(saved(unmoved).comments, anchors);
});

test("Keep mine whose merge runs past the bound says so and holds the editor open with the merged words", () => {
  const room = TASK_BOUNDS.MAX_BODY_CHARS - SECTIONS.length;
  const mine = SECTIONS.replace("add a member.", `add a member.${"m".repeat(room)}`);
  const theirs = SECTIONS.replace("Send the invite.", "Send the invite now.");

  const kept = editorCloseAsked(editorKeptMine(conflictedOver(mine, theirs)));

  assert.deepEqual(kept.state, {
    kind: DOCUMENT_EDITOR_STATE.FAILED,
    note: "Not saved: the plan is too long.",
  });
  assert.ok(kept.draft.includes("Send the invite now."));
  assert.equal(editorCloses(kept), false);
});
