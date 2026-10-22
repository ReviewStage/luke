import assert from "node:assert/strict";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { test } from "vitest";
import { freshAccount, newestWaiting, RESTING_PAGE, restingPage } from "./resting-page.js";

/** An item an agent with no task posted, waiting on `startedBy`, in `workspaceId`. */
function taskless(
  id: string,
  postedAt: number,
  extra: Partial<AppInboxTasklessItem> = {},
): AppInboxTasklessItem {
  return {
    id,
    agentId: `agent-${id}`,
    title: id,
    postedAt,
    agentTitle: null,
    agentModel: "model",
    automationId: null,
    automationName: null,
    repository: "acme/relay",
    ...extra,
  };
}

test("an account is new with no task in any workspace and nothing waiting on it, a teammate's question leaving it new", () => {
  const nothing = { tasks: [], taskless: [], readerId: "me" };
  assert.equal(freshAccount(nothing), true);
  assert.equal(freshAccount({ ...nothing, tasks: [{}] }), false);
  assert.equal(freshAccount({ ...nothing, taskless: [{ startedBy: "me" }] }), false);
  assert.equal(freshAccount({ ...nothing, taskless: [{ startedBy: "teammate" }] }), true);
});

test("the newest item waiting is the one posted last, a task's or an agent's with no task, leaving out a teammate's and another workspace's", () => {
  const tasks = [
    { taskId: "a", items: [{ id: "a-1", agentId: "x", title: "", postedAt: 5 }] },
    { taskId: "b", items: [{ id: "b-1", agentId: "y", title: "", postedAt: 3 }] },
  ];
  const base = { tasks, taskless: [], workspaceId: "w", readerId: "me" };
  assert.deepEqual(newestWaiting(base), { taskId: "a", itemId: "a-1" });

  assert.deepEqual(newestWaiting({ ...base, taskless: [taskless("t", 9, { workspaceId: "w" })] }), {
    agentId: "agent-t",
    itemId: "t",
  });
  assert.deepEqual(
    newestWaiting({
      ...base,
      taskless: [
        taskless("theirs", 9, { startedBy: "teammate" }),
        taskless("elsewhere", 9, { workspaceId: "other" }),
      ],
    }),
    { taskId: "a", itemId: "a-1" },
  );
  assert.equal(newestWaiting({ ...base, tasks: [] }), undefined);
});

test("the window rests on the welcome for a new account, beside the task list on the Inbox's last choice, and beside the inbox-first sidebar on the newest item or the Tasks page", () => {
  const remembered = { taskId: "a", itemId: "old" };
  const newest = { taskId: "b", itemId: "new" };
  assert.deepEqual(restingPage({ fresh: true, inboxFirst: false, remembered, newest }), {
    kind: RESTING_PAGE.WELCOME,
  });
  assert.deepEqual(restingPage({ fresh: false, inboxFirst: false, remembered, newest }), {
    kind: RESTING_PAGE.INBOX,
    chosen: remembered,
  });
  assert.deepEqual(restingPage({ fresh: false, inboxFirst: true, remembered, newest }), {
    kind: RESTING_PAGE.INBOX,
    chosen: newest,
  });
  assert.deepEqual(restingPage({ fresh: false, inboxFirst: true, remembered, newest: undefined }), {
    kind: RESTING_PAGE.TASKS,
  });
});
