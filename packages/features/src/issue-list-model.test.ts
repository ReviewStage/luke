import assert from "node:assert/strict";
import { test } from "vitest";
import { issueColumns, issueGroups, issueIdentifier } from "./issue-list-model.js";
import { ISSUE_PRIORITY, ISSUE_STATUS, type Issue } from "./issue-wire.js";

/**
 * A workspace's issues as a window draws them: grouped by status with the
 * work under way first, the most pressing first inside a status, and each
 * named by its workspace's prefix and number. Synthetic ids and words.
 */

function issue(number: number, extra: Partial<Issue> = {}): Issue {
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    workspaceId: "workspace-1",
    number,
    title: `Issue ${number}`,
    description: "",
    status: ISSUE_STATUS.BACKLOG,
    priority: ISSUE_PRIORITY.NONE,
    creator: null,
    archivedAt: null,
    createdAt: number,
    updatedAt: number,
    ...extra,
  };
}

test("issues group by status with the work under way first, and an empty status is left out", () => {
  const groups = issueGroups([
    issue(1, { status: ISSUE_STATUS.DONE }),
    issue(2, { status: ISSUE_STATUS.BACKLOG }),
    issue(3, { status: ISSUE_STATUS.IN_PROGRESS }),
    issue(4, { status: ISSUE_STATUS.BACKLOG }),
  ]);

  assert.deepEqual(
    groups.map((group) => [group.status, group.issues.map((one) => one.number)]),
    [
      [ISSUE_STATUS.IN_PROGRESS, [3]],
      [ISSUE_STATUS.BACKLOG, [4, 2]],
      [ISSUE_STATUS.DONE, [1]],
    ],
  );
});

test("inside a status the most pressing stands first, an unweighed issue last, and a tie the most recently changed first", () => {
  const [group] = issueGroups([
    issue(1, { priority: ISSUE_PRIORITY.NONE, updatedAt: 90 }),
    issue(2, { priority: ISSUE_PRIORITY.LOW, updatedAt: 10 }),
    issue(3, { priority: ISSUE_PRIORITY.URGENT, updatedAt: 10 }),
    issue(4, { priority: ISSUE_PRIORITY.HIGH, updatedAt: 10 }),
    issue(5, { priority: ISSUE_PRIORITY.HIGH, updatedAt: 50 }),
  ]);

  assert.deepEqual(
    group?.issues.map((one) => one.number),
    [3, 5, 4, 2, 1],
  );
});

test("an identifier is the workspace's prefix and the issue's number", () => {
  assert.equal(issueIdentifier("Acme", 42), "ACME-42");
  assert.equal(issueIdentifier("Luke Labs", 7), "LL-7");
  assert.equal(issueIdentifier("Charles's workspace", 1), "CW-1");
  assert.equal(issueIdentifier("Initech", 3), "INIT-3");
  assert.equal(issueIdentifier("  ", 9), "ISSUE-9");
});

test("a board stands a column for every status in the list's order, an empty one among them, each sorted as the list sorts", () => {
  const columns = issueColumns([
    issue(1, { status: ISSUE_STATUS.DONE }),
    issue(2, { status: ISSUE_STATUS.TODO, priority: ISSUE_PRIORITY.LOW }),
    issue(3, { status: ISSUE_STATUS.TODO, priority: ISSUE_PRIORITY.URGENT }),
  ]);

  assert.deepEqual(
    columns.map((column) => [column.status, column.issues.map((one) => one.number)]),
    [
      [ISSUE_STATUS.IN_PROGRESS, []],
      [ISSUE_STATUS.TODO, [3, 2]],
      [ISSUE_STATUS.BACKLOG, []],
      [ISSUE_STATUS.DONE, [1]],
      [ISSUE_STATUS.CANCELED, []],
    ],
  );
});
