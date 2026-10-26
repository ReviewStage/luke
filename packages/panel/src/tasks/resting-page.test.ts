import assert from "node:assert/strict";
import { test } from "vitest";
import { freshAccount, RESTING_PAGE, restingPage } from "./resting-page.js";

test("an account is new with no task in any workspace and nothing waiting on it, a teammate's question leaving it new", () => {
  const nothing = { tasks: [], taskless: [], readerId: "me" };
  assert.equal(freshAccount(nothing), true);
  assert.equal(freshAccount({ ...nothing, tasks: [{}] }), false);
  assert.equal(freshAccount({ ...nothing, taskless: [{ startedBy: "me" }] }), false);
  assert.equal(freshAccount({ ...nothing, taskless: [{ startedBy: "teammate" }] }), true);
});

test("the window rests on the welcome for a new account, and on the Inbox's last choice otherwise", () => {
  const remembered = { taskId: "a", itemId: "old" };
  assert.deepEqual(restingPage({ fresh: true, remembered }), {
    kind: RESTING_PAGE.WELCOME,
  });
  assert.deepEqual(restingPage({ fresh: false, remembered }), {
    kind: RESTING_PAGE.INBOX,
    chosen: remembered,
  });
});
