import {
  PLAN_ACTOR,
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
  EARLIER_BOARD_PROPERTIES,
  EARLIER_LIST_PROPERTIES,
  keptTasksDisplay,
  NO_TASKS_FILTER,
  TASK_MAKER,
  TASK_PROPERTY,
  TASKS_FILTER_FIELD,
  TASKS_GROUP,
  TASKS_GROUPING,
  TASKS_ORDER,
  type TaskProperty,
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
 * with the pins and sections; the Board stands columns by status, by
 * priority, or by assignee alone; and a display an earlier build kept draws
 * the properties offered since as the view's own display does.
 */

const DEAN = "user-dean";
const MAYA = "user-maya";
const ARLO = "user-arlo";
const ZOE = "user-zoe";

/** The instant the page is read at. */
const NOW = Date.UTC(2026, 9, 21, 12);

const DAY = 24 * 60 * 60 * 1000;

const NAMES = new Map([
  [DEAN, "Dean Stratakos"],
  [MAYA, "Maya Okafor"],
  [ARLO, "Arlo Finch"],
  [ZOE, "Zoe Park"],
]);

/** A task by name, with what it stands at; `updatedAt` doubles as its start where none is given. */
function task(
  name: string,
  {
    status,
    priority,
    repository = "acme/relay",
    creator,
    assignee,
    updatedAt = 1,
    createdAt = updatedAt,
    completedAt,
  }: {
    status?: TaskStatus;
    priority?: TaskPriority;
    repository?: string | null;
    creator?: string;
    assignee?: string;
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
    ...(assignee === undefined
      ? undefined
      : { assignee: { userId: assignee, name: NAMES.get(assignee) ?? "" } }),
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
    case TASKS_GROUP.ASSIGNEE:
      return [head.kind, head.assigneeId];
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
      personName: (userId) => NAMES.get(userId) ?? "",
      members: [],
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

test("a status filter narrows the status groups, and empty groups stand only for the values the filter lets in", () => {
  const tasks = [task("Under way", { status: TASK_STATUS.IN_PROGRESS })];
  const filter = toggledFilter(
    toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.STATUS, TASK_STATUS.IN_PROGRESS),
    TASKS_FILTER_FIELD.STATUS,
    TASK_STATUS.DONE,
  );

  expect(listed(tasks, { emptyGroups: true }, filter)).toEqual([
    [["status", "in-progress"], ["Under way"]],
    [["status", "done"], []],
  ]);
  expect(listed(tasks, { emptyGroups: true })).toEqual([
    [["status", "in-progress"], ["Under way"]],
    [["status", "todo"], []],
    [["status", "backlog"], []],
  ]);
});

test("a settled status the filter names stands in full whatever the completed window, on the List and the Board alike", () => {
  const tasks = [
    task("Under way", { status: TASK_STATUS.IN_PROGRESS }),
    task("Shipped Monday", { status: TASK_STATUS.DONE, completedAt: NOW - 2 * DAY }),
    task("Shipped in spring", { status: TASK_STATUS.DONE, completedAt: NOW - 90 * DAY }),
    task("Dropped in spring", { status: TASK_STATUS.CANCELED, completedAt: NOW - 90 * DAY }),
  ];
  const done = toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.STATUS, TASK_STATUS.DONE);

  expect(listed(tasks, { order: TASKS_ORDER.NAME }, done)).toEqual([
    [
      ["status", "done"],
      ["Shipped in spring", "Shipped Monday"],
    ],
  ]);
  const board = tasksBoardColumns(tasks, {
    filter: done,
    display: { ...DEFAULT_BOARD_DISPLAY, order: TASKS_ORDER.NAME, emptyGroups: false },
    readerId: DEAN,
    personName: () => "",
    members: [],
    now: NOW,
  }).map((column) => [headOf(column.head), column.tasks.map((each) => each.name), column.older]);
  expect(board).toEqual([[["status", "done"], ["Shipped in spring", "Shipped Monday"], undefined]]);
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

test("the List leads with the pins, then each section, one holding no task among them, a task in one group alone, and every group holds only the tasks that stand", () => {
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
        personName: () => "",
        members: [],
        now: NOW,
      }),
    );

  expect(groups(true)).toEqual([
    [[TASKS_GROUP.PINNED], ["Pinned"]],
    [["section", "launch"], ["Sectioned"]],
    [["section", "empty"], []],
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
        readerId: DEAN,
        personName: () => "",
        members: [],
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
      personName: () => "",
      members: [],
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
  const done = tasksBoardColumns(tasks, {
    filter,
    display: DEFAULT_BOARD_DISPLAY,
    readerId: DEAN,
    personName: () => "",
    members: [],
    now: NOW,
  }).find(
    (column) => column.head.kind === TASKS_GROUP.STATUS && column.head.status === TASK_STATUS.DONE,
  );

  expect([done?.tasks, done?.older]).toEqual([[], 1]);
});

test("a display kept before the completed window reads its Done and Canceled switches as the past week or none, and one kept since reads as kept", () => {
  expect(
    keptTasksDisplay({ done: true, canceled: false }, DEFAULT_LIST_DISPLAY, EARLIER_LIST_PROPERTIES)
      .completed,
  ).toBe(COMPLETED_WINDOW.PAST_WEEK);
  expect(
    keptTasksDisplay({ done: false, canceled: true }, DEFAULT_LIST_DISPLAY, EARLIER_LIST_PROPERTIES)
      .completed,
  ).toBe(COMPLETED_WINDOW.PAST_WEEK);
  expect(
    keptTasksDisplay(
      { done: false, canceled: false },
      DEFAULT_BOARD_DISPLAY,
      EARLIER_BOARD_PROPERTIES,
    ),
  ).toEqual({
    ...DEFAULT_BOARD_DISPLAY,
    completed: COMPLETED_WINDOW.NONE,
  });
  expect(
    keptTasksDisplay(
      { grouping: TASKS_GROUPING.PRIORITY, done: true },
      DEFAULT_BOARD_DISPLAY,
      EARLIER_BOARD_PROPERTIES,
    ),
  ).toEqual({
    ...DEFAULT_BOARD_DISPLAY,
    grouping: TASKS_GROUPING.PRIORITY,
    completed: COMPLETED_WINDOW.PAST_WEEK,
  });
  expect(keptTasksDisplay({}, DEFAULT_LIST_DISPLAY, EARLIER_LIST_PROPERTIES)).toEqual(
    DEFAULT_LIST_DISPLAY,
  );
  expect(keptTasksDisplay({}, DEFAULT_BOARD_DISPLAY, EARLIER_BOARD_PROPERTIES).completed).toBe(
    COMPLETED_WINDOW.PAST_WEEK,
  );
  expect(
    keptTasksDisplay(
      { completed: COMPLETED_WINDOW.ALL, done: false },
      DEFAULT_LIST_DISPLAY,
      EARLIER_LIST_PROPERTIES,
    ).completed,
  ).toBe(COMPLETED_WINDOW.ALL);
});
test("Made by keeps the tasks a person made by hand, those a coding agent made, or those Luke made on a call, a task from before origins as made by hand", () => {
  const tasks = [
    task("By hand"),
    { ...task("By an agent"), origin: { actor: PLAN_ACTOR.AGENT, agentId: "agent-1" } },
    { ...task("On a call"), origin: { actor: PLAN_ACTOR.NOTETAKER } },
  ];
  const byAgents = toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.MADE_BY, TASK_MAKER.AGENT);
  expect(listed(tasks, { grouping: TASKS_GROUPING.NONE }, byAgents)).toEqual([
    [["all"], ["By an agent"]],
  ]);
  const byPeople = toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.MADE_BY, TASK_MAKER.PERSON);
  expect(listed(tasks, { grouping: TASKS_GROUPING.NONE }, byPeople)).toEqual([
    [["all"], ["By hand"]],
  ]);
  expect([...valueCounts(tasks, TASKS_FILTER_FIELD.MADE_BY)]).toEqual([
    [TASK_MAKER.PERSON, 1],
    [TASK_MAKER.AGENT, 1],
    [TASK_MAKER.LUKE, 1],
  ]);
});

test("an Assignee filter keeps the tasks assigned to the members chosen, No assignee keeping those assigned to no one, whoever created them", () => {
  const tasks = [
    task("Maya's, made by Dean", { creator: DEAN, assignee: MAYA }),
    task("Dean's own", { creator: DEAN, assignee: DEAN }),
    task("Nobody's", { creator: MAYA }),
  ];
  const maya = toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.ASSIGNEE, MAYA);

  expect(listed(tasks, { grouping: TASKS_GROUPING.NONE }, maya)).toEqual([
    [["all"], ["Maya's, made by Dean"]],
  ]);
  expect(
    listed(
      tasks,
      { grouping: TASKS_GROUPING.NONE, order: TASKS_ORDER.NAME },
      toggledFilter(maya, TASKS_FILTER_FIELD.ASSIGNEE, null),
    ),
  ).toEqual([[["all"], ["Maya's, made by Dean", "Nobody's"]]]);
  expect([...valueCounts(tasks, TASKS_FILTER_FIELD.ASSIGNEE)]).toEqual([
    [MAYA, 1],
    [DEAN, 1],
    [null, 1],
  ]);
});

test("grouped by assignee the reader's own run first, then teammates' by name, then No assignee last; with empty groups every member and No assignee stand, narrowed to an Assignee filter", () => {
  const tasks = [
    task("Maya's", { assignee: MAYA }),
    task("Nobody's"),
    task("Arlo's", { assignee: ARLO }),
    task("Dean's", { assignee: DEAN, creator: MAYA }),
  ];
  const grouped = (display: Partial<TasksDisplay>, filter: TasksFilter = NO_TASKS_FILTER) =>
    drawn(
      tasksListGroups(tasks, {
        filter,
        display: { ...DEFAULT_LIST_DISPLAY, grouping: TASKS_GROUPING.ASSIGNEE, ...display },
        pinned: [],
        sections: [],
        readerId: DEAN,
        personName: (userId) => NAMES.get(userId) ?? "",
        members: [MAYA, DEAN, ZOE],
        now: NOW,
      }),
    );

  expect(grouped({})).toEqual([
    [["assignee", DEAN], ["Dean's"]],
    [["assignee", ARLO], ["Arlo's"]],
    [["assignee", MAYA], ["Maya's"]],
    [["assignee", null], ["Nobody's"]],
  ]);
  expect(grouped({ emptyGroups: true }).map(([head]) => head)).toEqual([
    ["assignee", DEAN],
    ["assignee", ARLO],
    ["assignee", MAYA],
    ["assignee", ZOE],
    ["assignee", null],
  ]);
  const mine = toggledFilter(NO_TASKS_FILTER, TASKS_FILTER_FIELD.ASSIGNEE, DEAN);
  expect(
    grouped({ emptyGroups: true }, toggledFilter(mine, TASKS_FILTER_FIELD.ASSIGNEE, null)),
  ).toEqual([
    [["assignee", DEAN], ["Dean's"]],
    [["assignee", null], ["Nobody's"]],
  ]);
});

test("the Board stands a column for each assignee where asked, the reader's first and No assignee last, an empty one for each member where empty columns stand", () => {
  const tasks = [task("Maya's", { assignee: MAYA }), task("Nobody's")];
  const board = (emptyGroups: boolean) =>
    drawn(
      tasksBoardColumns(tasks, {
        filter: NO_TASKS_FILTER,
        display: { ...DEFAULT_BOARD_DISPLAY, grouping: TASKS_GROUPING.ASSIGNEE, emptyGroups },
        readerId: DEAN,
        personName: (userId) => NAMES.get(userId) ?? "",
        members: [DEAN, MAYA],
        now: NOW,
      }),
    );

  expect(board(false)).toEqual([
    [["assignee", MAYA], ["Maya's"]],
    [["assignee", null], ["Nobody's"]],
  ]);
  expect(board(true)).toEqual([
    [["assignee", DEAN], []],
    [["assignee", MAYA], ["Maya's"]],
    [["assignee", null], ["Nobody's"]],
  ]);
});

test("the List and the Board draw each task's assignee at first and not its creator", () => {
  for (const display of [DEFAULT_LIST_DISPLAY, DEFAULT_BOARD_DISPLAY]) {
    expect(display.properties).toContain(TASK_PROPERTY.ASSIGNEE);
    expect(display.properties).not.toContain(TASK_PROPERTY.CREATOR);
  }
});

test("a display kept before rows offered the assignee draws it, and keeps its creator as it was kept, on or off", () => {
  const without = (left: readonly TaskProperty[], ...out: TaskProperty[]) =>
    left.filter((property) => !out.includes(property));
  const listKept = without(EARLIER_LIST_PROPERTIES, TASK_PROPERTY.UPDATED);
  const boardKept = without(EARLIER_BOARD_PROPERTIES, TASK_PROPERTY.STATUS);

  // A List display kept by a build that said what it offered, and one kept before builds said so.
  for (const offered of [EARLIER_LIST_PROPERTIES, undefined]) {
    const kept = keptTasksDisplay(
      { properties: listKept, ...(offered === undefined ? {} : { offered }) },
      DEFAULT_LIST_DISPLAY,
      EARLIER_LIST_PROPERTIES,
    ).properties;
    expect(kept).toContain(TASK_PROPERTY.ASSIGNEE);
    expect(kept).toContain(TASK_PROPERTY.CREATOR);
    expect(kept).not.toContain(TASK_PROPERTY.UPDATED);
  }
  const board = keptTasksDisplay(
    { properties: boardKept },
    DEFAULT_BOARD_DISPLAY,
    EARLIER_BOARD_PROPERTIES,
  ).properties;
  expect(board).toContain(TASK_PROPERTY.ASSIGNEE);
  expect(board).toContain(TASK_PROPERTY.CREATOR);
  expect(board).not.toContain(TASK_PROPERTY.STATUS);
  const creatorOff = keptTasksDisplay(
    { properties: without(listKept, TASK_PROPERTY.CREATOR), offered: EARLIER_LIST_PROPERTIES },
    DEFAULT_LIST_DISPLAY,
    EARLIER_LIST_PROPERTIES,
  ).properties;
  expect(creatorOff).toContain(TASK_PROPERTY.ASSIGNEE);
  expect(creatorOff).not.toContain(TASK_PROPERTY.CREATOR);
});

test("a display kept since rows offered the assignee keeps it off where its reader turned it off", () => {
  const offAgain = keptTasksDisplay(
    {
      properties: DEFAULT_LIST_DISPLAY.properties.filter(
        (property) => property !== TASK_PROPERTY.ASSIGNEE,
      ),
      offered: DEFAULT_LIST_DISPLAY.properties.concat(TASK_PROPERTY.CREATOR),
    },
    DEFAULT_LIST_DISPLAY,
    EARLIER_LIST_PROPERTIES,
  ).properties;

  expect(offAgain).not.toContain(TASK_PROPERTY.ASSIGNEE);
});
