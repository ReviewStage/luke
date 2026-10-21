import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { expect, test } from "vitest";
import {
  COMPLETED_WINDOW,
  clearedField,
  DEFAULT_BOARD_DISPLAY,
  DEFAULT_LIST_DISPLAY,
  keptTasksDisplay,
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
 * stands empty groups or not, shows the settled finished within a window
 * (ending a settled group on how many older it leaves out), and leads the List
 * with the pins and sections; the Board stands columns by status or by
 * priority alone.
 */

const DEAN = "user-dean";
const MAYA = "user-maya";

/** The instant the page is read at. */
const NOW = Date.UTC(2026, 9, 21, 12);

const DAY = 24 * 60 * 60 * 1000;

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
    completedAt,
  }: {
    status?: TaskStatus;
    priority?: TaskPriority;
    repository?: string | null;
    creator?: string;
    updatedAt?: number;
    createdAt?: number;
    completedAt?: number;
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
    ...(completedAt === undefined ? undefined : { completedAt }),
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
      now: NOW,
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
  expect(listed(tasks, { completed: COMPLETED_WINDOW.ALL }).map(([head]) => head)).toEqual([
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
  expect(
    listed(tasks, { emptyGroups: true, completed: COMPLETED_WINDOW.PAST_WEEK }, filter),
  ).toEqual([
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
        now: NOW,
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

test("the Board stands a column for every status at first, empty ones too, the settled finished in the past week, and by priority where asked; a grouping it cannot drop into is read as status", () => {
  const tasks = [
    task("Urgent", { status: TASK_STATUS.TODO, priority: TASK_PRIORITY.URGENT }),
    task("Unweighed", { status: TASK_STATUS.TODO }),
    task("Dropped", { status: TASK_STATUS.CANCELED, completedAt: NOW - DAY }),
  ];
  const board = (display: Partial<TasksDisplay>) =>
    drawn(
      tasksBoardColumns(tasks, {
        filter: NO_TASKS_FILTER,
        display: { ...DEFAULT_BOARD_DISPLAY, ...display },
        now: NOW,
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
    [["status", "canceled"], ["Dropped"]],
  ]);
  expect(board({ grouping: TASKS_GROUPING.REPOSITORY })).toEqual(board({}));
  expect(board({ grouping: TASKS_GROUPING.PRIORITY, emptyGroups: false })).toEqual([
    [["priority", "urgent"], ["Urgent"]],
    [
      ["priority", "none"],
      ["Unweighed", "Dropped"],
    ],
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

test("the completed window keeps the settled finished within it, by when each was finished, a task from an older service by its last save", () => {
  const tasks = [
    task("Open", { status: TASK_STATUS.IN_PROGRESS, updatedAt: NOW - 90 * DAY }),
    task("Shipped Monday", { status: TASK_STATUS.DONE, completedAt: NOW - 2 * DAY }),
    task("Older service, saved Sunday", { status: TASK_STATUS.DONE, updatedAt: NOW - 3 * DAY }),
    // Saved today, but finished ten days ago: when it was finished is what counts.
    task("Shipped last week", {
      status: TASK_STATUS.DONE,
      updatedAt: NOW,
      completedAt: NOW - 10 * DAY,
    }),
    task("Older service, saved in spring", { status: TASK_STATUS.DONE, updatedAt: NOW - 90 * DAY }),
    task("Dropped", { status: TASK_STATUS.CANCELED, completedAt: NOW - 20 * DAY }),
  ];
  const settled = (completed: TasksDisplay["completed"]) =>
    tasksListGroups(tasks, {
      filter: NO_TASKS_FILTER,
      display: { ...DEFAULT_LIST_DISPLAY, order: TASKS_ORDER.NAME, completed },
      pinned: [],
      sections: [],
      readerId: DEAN,
      creatorName: () => "",
      now: NOW,
    }).map((group) => [headOf(group.head), group.tasks.map((each) => each.name), group.older]);

  expect(settled(COMPLETED_WINDOW.NONE)).toEqual([
    [["status", "in-progress"], ["Open"], undefined],
  ]);
  expect(settled(COMPLETED_WINDOW.PAST_WEEK)).toEqual([
    [["status", "in-progress"], ["Open"], undefined],
    [["status", "done"], ["Older service, saved Sunday", "Shipped Monday"], 2],
    [["status", "canceled"], [], 1],
  ]);
  expect(settled(COMPLETED_WINDOW.PAST_MONTH)).toEqual([
    [["status", "in-progress"], ["Open"], undefined],
    [["status", "done"], ["Older service, saved Sunday", "Shipped last week", "Shipped Monday"], 1],
    [["status", "canceled"], ["Dropped"], undefined],
  ]);
  expect(settled(COMPLETED_WINDOW.ALL)).toEqual([
    [["status", "in-progress"], ["Open"], undefined],
    [
      ["status", "done"],
      [
        "Older service, saved in spring",
        "Older service, saved Sunday",
        "Shipped last week",
        "Shipped Monday",
      ],
      undefined,
    ],
    [["status", "canceled"], ["Dropped"], undefined],
  ]);
});

test("the older count leaves out the tasks the filter does, and a Board column holding only older tasks still counts them", () => {
  const tasks = [
    task("Shipped long ago", { status: TASK_STATUS.DONE, completedAt: NOW - 40 * DAY }),
    task("Shipped long ago, elsewhere", {
      status: TASK_STATUS.DONE,
      repository: "acme/other",
      completedAt: NOW - 40 * DAY,
    }),
  ];
  const filter = toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.REPOSITORY, "acme/relay");
  const done = tasksBoardColumns(tasks, { filter, display: DEFAULT_BOARD_DISPLAY, now: NOW }).find(
    (column) => column.head.kind === TASKS_GROUP.STATUS && column.head.status === TASK_STATUS.DONE,
  );

  expect([done?.tasks, done?.older]).toEqual([[], 1]);
});

test("a display kept before the completed window reads its Done and Canceled switches as the past week or none, and one kept since reads as kept", () => {
  expect(keptTasksDisplay({ done: true, canceled: false }, DEFAULT_LIST_DISPLAY).completed).toBe(
    COMPLETED_WINDOW.PAST_WEEK,
  );
  expect(keptTasksDisplay({ done: false, canceled: true }, DEFAULT_LIST_DISPLAY).completed).toBe(
    COMPLETED_WINDOW.PAST_WEEK,
  );
  expect(keptTasksDisplay({ done: false, canceled: false }, DEFAULT_BOARD_DISPLAY)).toEqual({
    ...DEFAULT_BOARD_DISPLAY,
    completed: COMPLETED_WINDOW.NONE,
  });
  expect(
    keptTasksDisplay({ grouping: TASKS_GROUPING.PRIORITY, done: true }, DEFAULT_BOARD_DISPLAY),
  ).toEqual({
    ...DEFAULT_BOARD_DISPLAY,
    grouping: TASKS_GROUPING.PRIORITY,
    completed: COMPLETED_WINDOW.PAST_WEEK,
  });
  expect(keptTasksDisplay({}, DEFAULT_LIST_DISPLAY)).toEqual(DEFAULT_LIST_DISPLAY);
  expect(keptTasksDisplay({}, DEFAULT_BOARD_DISPLAY).completed).toBe(COMPLETED_WINDOW.PAST_WEEK);
  expect(
    keptTasksDisplay({ completed: COMPLETED_WINDOW.ALL, done: false }, DEFAULT_LIST_DISPLAY)
      .completed,
  ).toBe(COMPLETED_WINDOW.ALL);
});
