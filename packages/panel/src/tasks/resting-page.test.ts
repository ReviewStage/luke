import assert from "node:assert/strict";
import { test } from "vitest";
import { freshAccount } from "./resting-page.js";

test("an account is new with no task in any workspace and nothing waiting on it, a teammate's question leaving it new", () => {
  const nothing = { tasks: [], taskless: [], readerId: "me" };
  assert.equal(freshAccount(nothing), true);
  assert.equal(freshAccount({ ...nothing, tasks: [{}] }), false);
  assert.equal(freshAccount({ ...nothing, taskless: [{ startedBy: "me" }] }), false);
  assert.equal(freshAccount({ ...nothing, taskless: [{ startedBy: "teammate" }] }), true);
});
