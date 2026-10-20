import assert from "node:assert/strict";
import { test } from "vitest";
import { ACT_KIND, parsedAct } from "./acts.js";

test("an envelope that is not one act of a named kind is refused whole", () => {
  assert.equal(parsedAct(undefined), undefined);
  assert.equal(parsedAct("session.open"), undefined);
  assert.equal(parsedAct({}), undefined);
  assert.equal(parsedAct({ kind: "session.reopen" }), undefined);
});

test("a kind the act port answers is no act of app:act's, however well formed", () => {
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_FOCUS_PANEL }), undefined);
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: "x" } }), undefined);
  assert.equal(parsedAct({ kind: ACT_KIND.UPDATE_CHECK }), undefined);
});
