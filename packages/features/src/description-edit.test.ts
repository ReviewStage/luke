import assert from "node:assert/strict";
import { test } from "vitest";
import { applyDocumentEdit } from "./description-edit.js";

const DOCUMENT =
  "## Context\n\nOnly an admin can add a member.\n\n## Goal\n\n- Members invite by email.\n";

test("an edit of a document still holding its base takes the developer's text exactly", () => {
  const value =
    "## Context\n\nOnly an owner can add a member.\n\n## Goal\n\n- Members invite by email.";

  assert.deepEqual(applyDocumentEdit(DOCUMENT, { document: { base: DOCUMENT, value } }), {
    applied: value,
  });
});

test("an edit of a document Vespin wrote in meanwhile is laid over its words, which stay", () => {
  const appText = `${DOCUMENT}- Invites expire after 7 days.\n`;
  const value = DOCUMENT.replace("an admin", "an owner");

  assert.deepEqual(applyDocumentEdit(appText, { document: { base: DOCUMENT, value } }), {
    applied: appText.replace("an admin", "an owner"),
  });
});
