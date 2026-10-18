import assert from "node:assert/strict";
import { test } from "vitest";
import {
  clearedIssueFilter,
  DEFAULT_ISSUE_FILTER,
  filteredIssues,
  issueColumns,
  issueFilterAnyPriority,
  issueFilterChanged,
  issueFilterCreatedBy,
  issueFilterToggledPriority,
  issueGroups,
  issueIdentifier,
} from "./issue-list-model.js";
import { ISSUE_PRIORITY, ISSUE_STATUS, type Issue } from "./issue-wire.js";

/**
 * A workspace's issues as a window draws them: grouped by status with the
 * work under way first, the most pressing first inside a status, and each
 * named by its workspace's prefix and number, and a filter leaving out
 * priorities, other members' issues, and settled issues gone quiet as of a
 * fixed moment. Synthetic ids and words.
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

test("a board stands a column for every status in the order work moves through them, an empty one among them, each sorted as the list sorts", () => {
  const columns = issueColumns([
    issue(1, { status: ISSUE_STATUS.DONE }),
    issue(2, { status: ISSUE_STATUS.TODO, priority: ISSUE_PRIORITY.LOW }),
    issue(3, { status: ISSUE_STATUS.TODO, priority: ISSUE_PRIORITY.URGENT }),
  ]);

  assert.deepEqual(
    columns.map((column) => [column.status, column.issues.map((one) => one.number)]),
    [
      [ISSUE_STATUS.BACKLOG, []],
      [ISSUE_STATUS.TODO, [3, 2]],
      [ISSUE_STATUS.IN_PROGRESS, []],
      [ISSUE_STATUS.DONE, [1]],
      [ISSUE_STATUS.CANCELED, []],
    ],
  );
});

const DAY = 24 * 60 * 60 * 1000;

/** The moment a filter is applied at. */
const NOW = Date.UTC(2026, 9, 14, 12);

/** The numbers of the issues kept, in the order given. */
function numbers(issues: readonly Issue[]): number[] {
  return issues.map((one) => one.number);
}

test("the filter a workspace starts on leaves out only settled issues gone quiet, and is no change", () => {
  const issues = [
    issue(1, { status: ISSUE_STATUS.DONE, updatedAt: NOW - 30 * DAY }),
    issue(2, { priority: ISSUE_PRIORITY.URGENT }),
    issue(3, { status: ISSUE_STATUS.CANCELED, updatedAt: NOW - DAY }),
  ];

  assert.equal(issueFilterChanged(DEFAULT_ISSUE_FILTER), false);
  assert.deepEqual(numbers(filteredIssues(issues, DEFAULT_ISSUE_FILTER, NOW)), [2, 3]);
  assert.deepEqual(numbers(filteredIssues(issues, { showCompleted: true }, NOW)), [1, 2, 3]);
  assert.equal(issueFilterChanged({ showCompleted: true }), true);
});

test("Clear filters goes back to the first filter where it keeps an issue, else shows every issue", () => {
  const quiet = issue(1, { status: ISSUE_STATUS.DONE, updatedAt: NOW - 30 * DAY });

  assert.deepEqual(clearedIssueFilter([quiet, issue(2)], NOW), DEFAULT_ISSUE_FILTER);
  assert.deepEqual(numbers(filteredIssues([quiet], clearedIssueFilter([quiet], NOW), NOW)), [1]);
});

test("a priority chosen from every priority narrows to it, another adds to it, and taking the last away shows every one again", () => {
  const issues = [
    issue(1, { priority: ISSUE_PRIORITY.URGENT }),
    issue(2, { priority: ISSUE_PRIORITY.HIGH }),
    issue(3, { priority: ISSUE_PRIORITY.NONE }),
  ];
  const urgent = issueFilterToggledPriority(DEFAULT_ISSUE_FILTER, ISSUE_PRIORITY.URGENT);
  const urgentOrUnweighed = issueFilterToggledPriority(urgent, ISSUE_PRIORITY.NONE);
  const unweighed = issueFilterToggledPriority(urgentOrUnweighed, ISSUE_PRIORITY.URGENT);
  const none = issueFilterToggledPriority(unweighed, ISSUE_PRIORITY.NONE);

  assert.deepEqual(numbers(filteredIssues(issues, urgent, NOW)), [1]);
  assert.deepEqual(numbers(filteredIssues(issues, urgentOrUnweighed, NOW)), [1, 3]);
  assert.deepEqual(numbers(filteredIssues(issues, unweighed, NOW)), [3]);
  assert.equal(issueFilterChanged(none), false, "no priority left chosen shows every one");
  assert.deepEqual(numbers(filteredIssues(issues, none, NOW)), [1, 2, 3]);
});

test("choosing every priority one by one is the same as choosing none", () => {
  const every = [
    ISSUE_PRIORITY.URGENT,
    ISSUE_PRIORITY.HIGH,
    ISSUE_PRIORITY.MEDIUM,
    ISSUE_PRIORITY.LOW,
    ISSUE_PRIORITY.NONE,
  ].reduce(issueFilterToggledPriority, DEFAULT_ISSUE_FILTER);

  assert.equal(issueFilterChanged(every), false);
});

test("a member's filter keeps the issues they filed and leaves out another's and one whose creator is gone", () => {
  const issues = [
    issue(1, { creator: { userId: "user-ada", name: "Ada" } }),
    issue(2, { creator: { userId: "user-grace", name: "Grace" } }),
    issue(3, { creator: null }),
  ];

  assert.deepEqual(
    numbers(filteredIssues(issues, { ...DEFAULT_ISSUE_FILTER, createdBy: "user-ada" }, NOW)),
    [1],
  );
});

test("with completed issues hidden a settled issue quiet for over a week leaves while a recent one, and open work however old, stands", () => {
  const issues = [
    issue(1, { status: ISSUE_STATUS.DONE, updatedAt: NOW - 8 * DAY }),
    issue(2, { status: ISSUE_STATUS.CANCELED, updatedAt: NOW - 8 * DAY }),
    issue(3, { status: ISSUE_STATUS.DONE, updatedAt: NOW - 6 * DAY }),
    issue(4, { status: ISSUE_STATUS.CANCELED, updatedAt: NOW - 7 * DAY }),
    issue(5, { status: ISSUE_STATUS.BACKLOG, updatedAt: NOW - 90 * DAY }),
  ];

  assert.deepEqual(numbers(filteredIssues(issues, { showCompleted: false }, NOW)), [3, 4, 5]);
});

test("a priority and a member's filter together keep only what both keep", () => {
  const ada = { userId: "user-ada", name: "Ada" };
  const issues = [
    issue(1, { priority: ISSUE_PRIORITY.HIGH, creator: ada }),
    issue(2, { priority: ISSUE_PRIORITY.LOW, creator: ada }),
    issue(3, { priority: ISSUE_PRIORITY.HIGH, creator: null }),
  ];
  const filter = issueFilterToggledPriority(
    { ...DEFAULT_ISSUE_FILTER, createdBy: ada.userId },
    ISSUE_PRIORITY.HIGH,
  );

  assert.deepEqual(numbers(filteredIssues(issues, filter, NOW)), [1]);
});

test("choosing a creator or every priority changes that alone, the rest of the filter standing", () => {
  const narrowed = issueFilterToggledPriority(
    { createdBy: "user-ada", showCompleted: false },
    ISSUE_PRIORITY.HIGH,
  );

  assert.deepEqual(issueFilterCreatedBy(narrowed, undefined), {
    priorities: [ISSUE_PRIORITY.HIGH],
    showCompleted: false,
  });
  assert.deepEqual(issueFilterCreatedBy(narrowed, "user-grace"), {
    priorities: [ISSUE_PRIORITY.HIGH],
    showCompleted: false,
    createdBy: "user-grace",
  });
  assert.deepEqual(issueFilterAnyPriority(narrowed), {
    createdBy: "user-ada",
    showCompleted: false,
  });
});
