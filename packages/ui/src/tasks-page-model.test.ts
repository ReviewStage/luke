import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { expect, test } from "vitest";
import {
  clearedField,
  DEFAULT_BOARD_DISPLAY,
  DEFAULT_LIST_DISPLAY,
  NO_TASKS_FILTER,
  TASKS_FILTER_FIELD,
  TASKS_GROUP,
  TASKS_GROUPING,
  TASKS_ORDER,
  type TasksDisplay,
  type TasksFilter,
  type TasksGroup,
  type TasksGroupHead,
  tasksBoardColumns,
  tasksListGroups,
  toggledFilter,
  valueCounts,
} from "./tasks-page-model.js";

/**
 * tasks-page-model.test.ts -- the Tasks page's filter narrows the tasks by
 * each field it keeps, and-ed; its display groups them, orders each group,
 * stands empty groups or not, shows the settled or not, and leads the List
 * with the pins and sections; the Board stands columns by status or by
 * priority alone.
 */

const DEAN = "user-dean";
const MAYA = "user-maya";

const NAMES = new Map([
  [DEAN, "Dean Stratakos"],
  [MAYA, "Maya Okafor"],
]);

/** A task by name, with what it stands at; `updatedAt` doubles as its start where none is given. */
function task(
  name: string,
  {
    status,
    priority,
    repository = "acme/relay",
    creator,
    updatedAt = 1,
    createdAt = updatedAt,
  }: {
    status?: TaskStatus;
    priority?: TaskPriority;
    repository?: string | null;
    creator?: string;
    updatedAt?: number;
    createdAt?: number;
  } = {},
): TaskSummary {
  return {
    id: name,
    workspaceId: "workspace-acme",
    name,
    createdAt,
    updatedAt,
    repository,
    ...(status === undefined ? undefined : { status }),
    ...(priority === undefined ? undefined : { priority }),
    ...(creator === undefined
      ? undefined
      : { ownerId: creator, createdBy: { userId: creator, name: NAMES.get(creator) ?? "" } }),
  };
}

/** What a group stands for: its kind, and the value it heads where it heads one. */
function headOf(head: TasksGroupHead): readonly (string | null)[] {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
    case TASKS_GROUP.ALL:
      return [head.kind];
    case TASKS_GROUP.SECTION:
      return [head.kind, head.sectionId];
    case TASKS_GROUP.STATUS:
      return [head.kind, head.status];
    case TASKS_GROUP.PRIORITY:
      return [head.kind, head.priority];
    case TASKS_GROUP.REPOSITORY:
      return [head.kind, head.repository];
    case TASKS_GROUP.CREATOR:
      return [head.kind, head.creatorId];
  }
}

/** Each group as what it stands for and its tasks' names. */
const drawn = (groups: readonly TasksGroup[]) =>
  groups.map((group) => [headOf(group.head), group.tasks.map((each) => each.name)]);

/** The List's groups with no pins and no sections. */
const listed = (
  tasks: readonly TaskSummary[],
  display: Partial<TasksDisplay> = {},
  filter: TasksFilter = NO_TASKS_FILTER,
) =>
  drawn(
    tasksListGroups(tasks, {
      filter,
      display: { ...DEFAULT_LIST_DISPLAY, ...display },
      pinned: [],
      sections: [],
      readerId: DEAN,
      creatorName: (userId) => NAMES.get(userId) ?? "",
    }),
  );

test("the List at first runs the open work by status from the work under way, the most pressing first, and leaves the settled out", () => {
  const tasks = [
    task("Filed", { status: TASK_STATUS.BACKLOG, priority: TASK_PRIORITY.LOW }),
    task("Under way", {
      status: TASK_STATUS.IN_PROGRESS,
      priority: TASK_PRIORITY.LOW,
      updatedAt: 2,
    }),
    task("Urgent", { status: TASK_STATUS.IN_PROGRESS, priority: TASK_PRIORITY.URGENT }),
    task("Shipped", { status: TASK_STATUS.DONE }),
    task("Dropped", { status: TASK_STATUS.CANCELED }),
    task("Older service"),
  ];

  expect(listed(tasks)).toEqual([
    [
      ["status", "in-progress"],
      ["Urgent", "Under way"],
    ],
    [["status", "todo"], ["Older service"]],
    [["status", "backlog"], ["Filed"]],
  ]);
  expect(listed(tasks, { done: true, canceled: true }).map(([head]) => head)).toEqual([
    ["status", "in-progress"],
    ["status", "todo"],
    ["status", "backlog"],
    ["status", "done"],
    ["status", "canceled"],
  ]);
});

test("a filter keeps the tasks holding one of each field's values, its fields and-ed, and a field cleared filters nothing again", () => {
  const tasks = [
    task("Dean's urgent", { priority: TASK_PRIORITY.URGENT, creator: DEAN }),
    task("Maya's urgent", { priority: TASK_PRIORITY.URGENT, creator: MAYA }),
    task("Dean's high", { priority: TASK_PRIORITY.HIGH, creator: DEAN }),
    task("Dean's unweighed, nowhere", { creator: DEAN, repository: null }),
  ];
  let filter = toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.CREATOR, DEAN);
  filter = toggledFilter(filter, TASKS_FILTER_FIELD.PRIORITY, TASK_PRIORITY.URGENT);
  filter = toggledFilter(filter, TASKS_FILTER_FIELD.PRIORITY, TASK_PRIORITY.NONE);

  expect(listed(tasks, { grouping: TASKS_GROUPING.NONE }, filter)).toEqual([
    [["all"], ["Dean's urgent", "Dean's unweighed, nowhere"]],
  ]);
  const nowhere = toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.REPOSITORY, null);
  expect(listed(tasks, { grouping: TASKS_GROUPING.NONE }, nowhere)).toEqual([
    [["all"], ["Dean's unweighed, nowhere"]],
  ]);
  expect(
    toggledFilter(
      clearedField(filter, TASKS_FILTER_FIELD.CREATOR),
      TASKS_FILTER_FIELD.PRIORITY,
      TASK_PRIORITY.URGENT,
    ),
  ).toEqual({ [TASKS_FILTER_FIELD.PRIORITY]: [TASK_PRIORITY.NONE] });
});

test("a status filter narrows the status groups, and empty groups stand only for the values the filter and the display let in", () => {
  const tasks = [task("Under way", { status: TASK_STATUS.IN_PROGRESS })];
  const filter = toggledFilter(
    toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.STATUS, TASK_STATUS.IN_PROGRESS),
    TASKS_FILTER_FIELD.STATUS,
    TASK_STATUS.DONE,
  );

  expect(listed(tasks, { emptyGroups: true }, filter)).toEqual([
    [["status", "in-progress"], ["Under way"]],
  ]);
  expect(listed(tasks, { emptyGroups: true, done: true }, filter)).toEqual([
    [["status", "in-progress"], ["Under way"]],
    [["status", "done"], []],
  ]);
});

test("grouped by repository the groups run by name and the tasks with none last; by creator the reader's own first, then teammates by name, then nobody's", () => {
  const tasks = [
    task("Web", { repository: "acme/web", creator: MAYA }),
    task("Nowhere", { repository: null }),
    task("Api", { repository: "acme/api", creator: DEAN }),
    task("Relay", { creator: MAYA }),
  ];

  expect(listed(tasks, { grouping: TASKS_GROUPING.REPOSITORY })).toEqual([
    [["repository", "acme/api"], ["Api"]],
    [["repository", "acme/relay"], ["Relay"]],
    [["repository", "acme/web"], ["Web"]],
    [["repository", null], ["Nowhere"]],
  ]);
  expect(listed(tasks, { grouping: TASKS_GROUPING.CREATOR, order: TASKS_ORDER.NAME })).toEqual([
    [["creator", DEAN], ["Api"]],
    [
      ["creator", MAYA],
      ["Relay", "Web"],
    ],
    [["creator", null], ["Nowhere"]],
  ]);
});

test("each order runs a group's tasks its own way, a tie falling to the latest activity", () => {
  const tasks = [
    task("Beta", { priority: TASK_PRIORITY.LOW, createdAt: 3, updatedAt: 3 }),
    task("Alpha", { priority: TASK_PRIORITY.HIGH, createdAt: 1, updatedAt: 9 }),
    task("Gamma", { createdAt: 5, updatedAt: 5 }),
  ];
  const run = (order: TasksDisplay["order"]) =>
    listed(tasks, { grouping: TASKS_GROUPING.NONE, order })[0]?.[1];

  expect(run(TASKS_ORDER.PRIORITY)).toEqual(["Alpha", "Beta", "Gamma"]);
  expect(run(TASKS_ORDER.UPDATED)).toEqual(["Alpha", "Gamma", "Beta"]);
  expect(run(TASKS_ORDER.CREATED)).toEqual(["Gamma", "Beta", "Alpha"]);
  expect(run(TASKS_ORDER.NAME)).toEqual(["Alpha", "Beta", "Gamma"]);
});

test("the List leads with the pins, then each section, a task in one group alone, and every group holds only the tasks that stand", () => {
  const tasks = [
    task("Pinned", { status: TASK_STATUS.TODO }),
    task("Pinned and shipped", { status: TASK_STATUS.DONE }),
    task("Sectioned", { status: TASK_STATUS.TODO }),
    task("Loose", { status: TASK_STATUS.TODO }),
  ];
  const groups = (pinnedFirst: boolean) =>
    drawn(
      tasksListGroups(tasks, {
        filter: NO_TASKS_FILTER,
        display: { ...DEFAULT_LIST_DISPLAY, pinnedFirst },
        pinned: ["Pinned and shipped", "Pinned"],
        sections: [
          { sectionId: "launch", taskIds: ["Pinned", "Sectioned"] },
          { sectionId: "empty", taskIds: [] },
        ],
        readerId: DEAN,
        creatorName: () => "",
      }),
    );

  expect(groups(true)).toEqual([
    [[TASKS_GROUP.PINNED], ["Pinned"]],
    [["section", "launch"], ["Sectioned"]],
    [["status", "todo"], ["Loose"]],
  ]);
  expect(groups(false)).toEqual([
    [
      ["status", "todo"],
      ["Pinned", "Sectioned", "Loose"],
    ],
  ]);
});

test("the Board stands a column for every status but Canceled at first, empty ones too, and by priority where asked; a grouping it cannot drop into is read as status", () => {
  const tasks = [
    task("Urgent", { status: TASK_STATUS.TODO, priority: TASK_PRIORITY.URGENT }),
    task("Unweighed", { status: TASK_STATUS.TODO }),
    task("Dropped", { status: TASK_STATUS.CANCELED }),
  ];
  const board = (display: Partial<TasksDisplay>) =>
    drawn(
      tasksBoardColumns(tasks, {
        filter: NO_TASKS_FILTER,
        display: { ...DEFAULT_BOARD_DISPLAY, ...display },
      }),
    );

  expect(board({})).toEqual([
    [["status", "backlog"], []],
    [
      ["status", "todo"],
      ["Urgent", "Unweighed"],
    ],
    [["status", "in-progress"], []],
    [["status", "done"], []],
  ]);
  expect(board({ grouping: TASKS_GROUPING.REPOSITORY })).toEqual(board({}));
  expect(board({ grouping: TASKS_GROUPING.PRIORITY, emptyGroups: false })).toEqual([
    [["priority", "urgent"], ["Urgent"]],
    [["priority", "none"], ["Unweighed"]],
  ]);
});

test("a field's counts say how many tasks hold each value, a task from before priorities as No priority", () => {
  const counts = valueCounts(
    [task("One", { priority: TASK_PRIORITY.HIGH }), task("Two"), task("Three")],
    TASKS_FILTER_FIELD.PRIORITY,
  );

  expect([...counts]).toEqual([
    [TASK_PRIORITY.HIGH, 1],
    [TASK_PRIORITY.NONE, 2],
  ]);
});
