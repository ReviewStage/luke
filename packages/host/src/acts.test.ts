import assert from "node:assert/strict";
import { test } from "vitest";
import { ACT_KIND, parsedAct } from "./acts.js";

test("an envelope that is not one act of a named kind is refused whole", () => {
  assert.equal(parsedAct(undefined), undefined);
  assert.equal(parsedAct("session.open"), undefined);
  assert.equal(parsedAct({}), undefined);
  assert.equal(parsedAct({ kind: "session.reopen" }), undefined);
  // A key beside the two the envelope has is a shape this build does not know.
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_FOCUS_PANEL, sender: "panel" }), undefined);
  // A payload sent to a kind that takes none, and a kind that takes one sent none.
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_FOCUS_PANEL, payload: { now: true } }), undefined);
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_COPY_TEXT }), undefined);
  // A payload its own schema refuses is refused here.
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: 3 } }), undefined);
  assert.equal(
    parsedAct({ kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: "x", extra: 1 } }),
    undefined,
  );
});
