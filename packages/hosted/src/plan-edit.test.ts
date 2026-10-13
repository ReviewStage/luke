import assert from "node:assert/strict";
import { test } from "vitest";
import { applyDocumentEdit } from "./plan-edit.js";

const DOCUMENT =
  "## Context\n\nOnly an admin can add a member.\n\n## Goal\n\n- Members invite by email.\n";

test("an edit of a document still holding its base takes the developer's text exactly", () => {
  const value =
    "## Context\n\nOnly an owner can add a member.\n\n## Goal\n\n- Members invite by email.";

  assert.deepEqual(applyDocumentEdit(DOCUMENT, { document: { base: DOCUMENT, value } }), {
    applied: value,
  });
});

test("an edit of a document Luke wrote in meanwhile is laid over his words, which stay", () => {
  const lukes = `${DOCUMENT}- Invites expire after 7 days.\n`;
  const value = DOCUMENT.replace("an admin", "an owner");

  assert.deepEqual(applyDocumentEdit(lukes, { document: { base: DOCUMENT, value } }), {
    applied: lukes.replace("an admin", "an owner"),
  });
});

test("an edit of a line Luke changed meanwhile, or a clearing of a moved text, conflicts and answers the text as it stands", () => {
  const lukes = DOCUMENT.replace("an admin", "a workspace admin");

  assert.deepEqual(
    applyDocumentEdit(lukes, {
      document: { base: DOCUMENT, value: DOCUMENT.replace("an admin", "an owner") },
    }),
    { conflict: { current: lukes } },
  );
  assert.deepEqual(applyDocumentEdit(lukes, { document: { base: DOCUMENT, value: "" } }), {
    conflict: { current: lukes },
  });
});
